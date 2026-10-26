import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  releaseFrameQaBudgetSlot,
  reserveFrameQaBudgetSlot,
} from "@/lib/services/frame-qa-gate";
import { mergeQaReviewAiFields } from "@/lib/services/qa-review-merge";
import {
  FINAL_FRAME_QA_KEY,
  readFinalFrameQaMark,
  type FinalFrameQaMark,
} from "@/lib/video-generation/final-frame-qa-mark";
import {
  finalFrameQaMarkFromResult,
  runFinalFrameQa,
  skippedFinalFrameVerdict,
  type FinalFrameQaResult,
} from "@/lib/video-generation/final-frame-qa";
import { isFrameQaEnabled } from "@/lib/video-generation/frame-qa";

/**
 * 成片级复检消费者（P01-E，影子）。poll-videos cron 每次最多取 FINAL_FRAME_QA_BATCH 条
 * `aiScoreBreakdown.finalFrameQa.status = "pending"` 的 QAReview，在既有帧质检预算里跑复检
 * （段级门禁先用预算，复检吃剩下的；预算不够就留到下一轮）。
 *
 *   - 认领：CAS pending → checking（checkingAtMs 租期过了别的调用可接手），重叠的 cron 不会重复跑；
 *   - 结论用合并写落回（P01-E1），不覆盖 8 维打分；问题以「[成片复检] …」追加进 aiIssues；
 *   - vision 不可用：直接记 skipped + 原因，不占预算；
 *   - 影子：不改 QAReview.status、不改 brief 状态。
 *
 * Vercel 函数里不 await 的异步会被冻结，所以这里全部 await，由调用方放进 allSettled。
 */
export const FINAL_FRAME_QA_BATCH = 2;
/// 认领租期：远大于单次复检最坏耗时（45s 超时）
export const FINAL_FRAME_QA_CLAIM_LEASE_MS = 5 * 60_000;
const ISSUE_PREFIX = "[成片复检]";

export interface PendingFinalFrameQaRow {
  id: string;
  aiScoreBreakdown: unknown;
  aiIssues: unknown;
  videoBrief: {
    finalVideoUrl: string | null;
    videoGenerationPlan: unknown;
    finalVideo: { stitchedVideoUrl: string | null } | null;
  } | null;
}

export interface FinalFrameQaSweep {
  scanned: number;
  checked: number;
  issues: number;
  skipped: number;
  deferred: number;
}

export interface FinalFrameQaServiceDeps {
  findPending: (limit: number, now: Date) => Promise<PendingFinalFrameQaRow[]>;
  claim: (row: PendingFinalFrameQaRow, now: Date) => Promise<boolean>;
  save: (row: PendingFinalFrameQaRow, result: FinalFrameQaResult) => Promise<void>;
  run: typeof runFinalFrameQa;
  isVisionAvailable: () => boolean;
  reserve: () => { ok: true; label: string } | { ok: false; reason: string };
  release: () => void;
  now: () => Date;
}

/** 待复检：pending，或 checking 但租期已过（持有者被平台杀掉） */
export function pendingFinalFrameQaWhere(now: Date): Prisma.QAReviewWhereInput {
  return {
    status: "PENDING",
    OR: [
      { aiScoreBreakdown: { path: [FINAL_FRAME_QA_KEY, "status"], equals: "pending" } },
      {
        AND: [
          { aiScoreBreakdown: { path: [FINAL_FRAME_QA_KEY, "status"], equals: "checking" } },
          {
            aiScoreBreakdown: {
              path: [FINAL_FRAME_QA_KEY, "checkingAtMs"],
              lt: now.getTime() - FINAL_FRAME_QA_CLAIM_LEASE_MS,
            },
          },
        ],
      },
    ],
  };
}

/** 商品参考图：unified plan 里的 product_image（用户指定角色优先），没有就 null。 */
export function referenceImageFromPlan(plan: unknown): string | null {
  const assets = (plan as { classifiedAssets?: unknown } | null)?.classifiedAssets;
  if (!Array.isArray(assets)) return null;
  for (const asset of assets as Array<Record<string, unknown>>) {
    const role = asset.userAssignedRole ?? asset.inferredRole;
    if (role === "product_image" && typeof asset.url === "string" && /^https?:\/\//.test(asset.url)) {
      return asset.url;
    }
  }
  return null;
}

function markPatch(row: PendingFinalFrameQaRow, next: FinalFrameQaMark): Record<string, unknown> {
  const prior = readFinalFrameQaMark(row.aiScoreBreakdown);
  return {
    [FINAL_FRAME_QA_KEY]: {
      ...(prior?.requestedAt ? { requestedAt: prior.requestedAt } : {}),
      ...next,
    },
  };
}

const defaultDeps: FinalFrameQaServiceDeps = {
  findPending: (limit, now) =>
    db.qAReview.findMany({
      where: pendingFinalFrameQaWhere(now),
      orderBy: { createdAt: "asc" },
      take: limit,
      select: {
        id: true,
        aiScoreBreakdown: true,
        aiIssues: true,
        videoBrief: {
          select: {
            finalVideoUrl: true,
            videoGenerationPlan: true,
            finalVideo: { select: { stitchedVideoUrl: true } },
          },
        },
      },
    }) as unknown as Promise<PendingFinalFrameQaRow[]>,
  claim: async (row, now) => {
    const prior = readFinalFrameQaMark(row.aiScoreBreakdown);
    const claimed = await db.qAReview.updateMany({
      where: {
        id: row.id,
        aiScoreBreakdown: {
          path: [FINAL_FRAME_QA_KEY, "status"],
          equals: prior?.status === "checking" ? "checking" : "pending",
        },
        ...(prior?.status === "checking"
          ? {
              AND: [{
                aiScoreBreakdown: {
                  path: [FINAL_FRAME_QA_KEY, "checkingAtMs"],
                  lt: now.getTime() - FINAL_FRAME_QA_CLAIM_LEASE_MS,
                },
              }],
            }
          : {}),
      },
      data: mergeQaReviewAiFields(row, {
        breakdown: markPatch(row, { status: "checking", checkingAtMs: now.getTime() }),
      }),
    });
    return claimed.count === 1;
  },
  save: async (row, result) => {
    await db.qAReview.update({
      where: { id: row.id },
      data: mergeQaReviewAiFields(row, {
        breakdown: markPatch(row, finalFrameQaMarkFromResult(result)),
        issues: result.issues.map((issue) => `${ISSUE_PREFIX} 第${issue.frameIndex + 1}帧 ${issue.detail}`),
      }),
    });
  },
  run: runFinalFrameQa,
  isVisionAvailable: isFrameQaEnabled,
  reserve: () => reserveFrameQaBudgetSlot(),
  release: releaseFrameQaBudgetSlot,
  now: () => new Date(),
};

export function finalVideoUrlOf(row: PendingFinalFrameQaRow): string | null {
  return row.videoBrief?.finalVideo?.stitchedVideoUrl ?? row.videoBrief?.finalVideoUrl ?? null;
}

export async function runPendingFinalFrameQa(
  limit = FINAL_FRAME_QA_BATCH,
  overrides: Partial<FinalFrameQaServiceDeps> = {},
): Promise<FinalFrameQaSweep> {
  const deps = { ...defaultDeps, ...overrides };
  const batch = Math.max(1, Math.min(limit, FINAL_FRAME_QA_BATCH));
  const now = deps.now();
  const rows = (await deps.findPending(batch, now)).slice(0, batch);
  const sweep: FinalFrameQaSweep = { scanned: rows.length, checked: 0, issues: 0, skipped: 0, deferred: 0 };

  for (const row of rows) {
    const videoUrl = finalVideoUrlOf(row);
    if (!videoUrl) {
      await deps.save(row, skippedFinalFrameVerdict("成片没有可下载的 URL", deps.now()));
      sweep.skipped += 1;
      continue;
    }
    /// vision 不可用：记 skipped + 原因，不占预算、不认领（结论是确定的）
    if (!deps.isVisionAvailable()) {
      await deps.save(row, skippedFinalFrameVerdict("vision 不可用（未配置 / mock 模式 / FRAME_QA_DISABLED）", deps.now()));
      sweep.skipped += 1;
      continue;
    }
    const reservation = deps.reserve();
    if (!reservation.ok) {
      /// 本轮预算用完：剩下的留在 pending，下一轮再来
      sweep.deferred += rows.length - sweep.checked - sweep.skipped - sweep.deferred;
      break;
    }
    if (!(await deps.claim(row, deps.now()))) {
      deps.release();
      sweep.deferred += 1;
      continue;
    }
    const result = await deps.run(videoUrl, {
      firstFrameRef: referenceImageFromPlan(row.videoBrief?.videoGenerationPlan),
    });
    await deps.save(row, result);
    if (result.status === "skipped") sweep.skipped += 1;
    else {
      sweep.checked += 1;
      if (result.status === "issues") sweep.issues += 1;
    }
    if (result.status !== "ok") {
      console.warn(`[final-frame-qa] review ${row.id}: ${result.status}`, {
        issues: result.issues.length,
        skipReason: result.skipReason,
      });
    }
  }
  return sweep;
}
