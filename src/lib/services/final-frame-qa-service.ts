import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  frameQaBudgetUsage,
  releaseFrameQaBudgetSlot,
  reserveFrameQaBudgetSlot,
} from "@/lib/services/frame-qa-gate";
import { mergeFinalFrameQaReview } from "@/lib/services/qa-review-merge";
import { writeQaReview } from "@/lib/services/qa-review-write";
import {
  FINAL_FRAME_QA_KEY,
  newPendingFinalFrameQa,
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
 * `aiScoreBreakdown.finalFrameQa.status = "pending"` 的 QAReview，在既有帧质检预算里跑复检。
 *
 *   - 开关 FINAL_FRAME_QA_MODE=off|shadow，默认 off（生产 OpenAI 额度紧张时影子不能挤真实门禁配额）；
 *   - 让路：本轮段级门禁有 deferred 或 vision 报错时整轮跳过（段级门禁先用预算，复检吃剩下的）；
 *   - 认领：CAS pending → checking（checkingAtMs 租期过了别的调用可接手），重叠的 cron 不会重复跑；
 *   - 落库原子：save 在事务里重读行，确认仍是本次认领（checking + 同一 checkingAtMs）且成片 URL 没变
 *     （只重拼换片后会重新挂 pending），再按归属合并写回（不覆盖 8 维打分）；
 *   - 超时是瞬时原因：重排 pending（attempts+1），到 FINAL_FRAME_QA_MAX_ATTEMPTS 改记 skipped；
 *   - vision 不可用：直接记 skipped + 原因，不占预算；
 *   - 影子：不改 QAReview.status、不改 brief 状态。
 *
 * Vercel 函数里不 await 的异步会被冻结，所以这里全部 await，由调用方放进 allSettled。
 */
export const FINAL_FRAME_QA_BATCH = 2;
export const FINAL_FRAME_QA_MAX_ATTEMPTS = 3;
/// 认领租期：远大于单次复检最坏耗时（45s 超时）
export const FINAL_FRAME_QA_CLAIM_LEASE_MS = 5 * 60_000;

export type FinalFrameQaMode = "off" | "shadow";

export function finalFrameQaMode(env: Record<string, string | undefined> = process.env): FinalFrameQaMode {
  return env.FINAL_FRAME_QA_MODE?.trim().toLowerCase() === "shadow" ? "shadow" : "off";
}

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

export interface FinalFrameQaClaim {
  checkingAtMs: number;
  videoUrl: string;
}

export interface FinalFrameQaSweep {
  mode: FinalFrameQaMode;
  scanned: number;
  checked: number;
  issues: number;
  skipped: number;
  deferred: number;
  /// 超时重排回 pending 的条数
  requeued: number;
  /// 整轮让路的原因（段级门禁有 deferred / vision 报错）
  skippedRound?: "segment_gate_deferred" | "segment_gate_vision_failed";
}

export type FinalFrameQaWrite = { mark: FinalFrameQaMark; issues: string[] };

export interface FinalFrameQaServiceDeps {
  mode: () => FinalFrameQaMode;
  budgetUsage: () => { deferred: number; visionFailures: number } | null;
  findPending: (limit: number, now: Date) => Promise<PendingFinalFrameQaRow[]>;
  /** CAS pending（或过期 checking）→ checking；抢到返回认领凭证 */
  claim: (row: PendingFinalFrameQaRow, now: Date) => Promise<FinalFrameQaClaim | null>;
  /** 认领后的落库：事务里重读、核对认领凭证与成片 URL，再按归属合并写回；凭证不对返回 false */
  saveClaimed: (
    row: PendingFinalFrameQaRow,
    claim: FinalFrameQaClaim,
    build: (prior: FinalFrameQaMark | null) => FinalFrameQaWrite,
  ) => Promise<boolean>;
  /** 没认领的落库（vision 不可用 / 没有 URL）：CAS 仍为 pending 才写 */
  saveUnclaimed: (row: PendingFinalFrameQaRow, write: FinalFrameQaWrite) => Promise<boolean>;
  run: typeof runFinalFrameQa;
  isVisionAvailable: () => boolean;
  reserve: () => { ok: true; label: string } | { ok: false; reason: string };
  release: () => void;
  now: () => Date;
}

/** 待复检：pending，或 checking 但租期已过（持有者被平台杀掉）。不限 QAReview.status——已交付 brief 的标记挂在 APPROVED 行上。 */
export function pendingFinalFrameQaWhere(now: Date): Prisma.QAReviewWhereInput {
  return {
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

export function finalVideoUrlOf(row: Pick<PendingFinalFrameQaRow, "videoBrief">): string | null {
  return row.videoBrief?.finalVideo?.stitchedVideoUrl ?? row.videoBrief?.finalVideoUrl ?? null;
}

/** Recheck the effective URL in the same UPDATE as the JSON CAS. */
function videoUrlGuard(videoUrl: string | null): Prisma.QAReviewWhereInput {
  return {
    videoBrief: { is: {
        OR: [
          ...(videoUrl === null ? [] : [{ finalVideo: { is: { stitchedVideoUrl: videoUrl } } }]),
          {
            finalVideoUrl: videoUrl,
            OR: [{ finalVideo: { is: null } }, { finalVideo: { is: { stitchedVideoUrl: null } } }],
          },
        ],
    } },
  };
}

/** 结论 → 这一行要写的标记与问题（纯函数）：超时在次数内重排 pending，否则按结论落。 */
export function buildFinalFrameQaWrite(
  prior: FinalFrameQaMark | null,
  result: FinalFrameQaResult,
  now: Date,
): FinalFrameQaWrite & { requeued: boolean } {
  const attempts = (prior?.attempts ?? 0) + 1;
  if (result.status === "skipped" && result.retryable && attempts < FINAL_FRAME_QA_MAX_ATTEMPTS) {
    const requeued = newPendingFinalFrameQa(now, attempts);
    return {
      mark: { ...requeued, ...(prior?.requestedAt ? { requestedAt: prior.requestedAt } : {}) },
      issues: [],
      requeued: true,
    };
  }
  const base = finalFrameQaMarkFromResult(result, prior);
  const mark: FinalFrameQaMark =
    result.status === "skipped" && result.retryable
      ? { ...base, attempts, skipReason: `${result.skipReason ?? "复检超时"}（已重试 ${attempts} 次，放弃）` }
      : base;
  return {
    mark,
    issues: result.issues.map((issue) => `第${issue.frameIndex + 1}帧 ${issue.detail}`),
    requeued: false,
  };
}

const pendingRowSelect = {
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
} as const;

const defaultDeps: FinalFrameQaServiceDeps = {
  mode: () => finalFrameQaMode(),
  budgetUsage: () => {
    const usage = frameQaBudgetUsage();
    return usage ? { deferred: usage.deferred, visionFailures: usage.visionFailures } : null;
  },
  findPending: (limit, now) =>
    db.qAReview.findMany({
      where: pendingFinalFrameQaWhere(now),
      orderBy: { createdAt: "asc" },
      take: limit,
      select: pendingRowSelect,
    }) as unknown as Promise<PendingFinalFrameQaRow[]>,
  claim: (row, now) => writeQaReview(
    (tx) => tx.qAReview.findUnique({ where: { id: row.id }, select: pendingRowSelect }),
    (fresh) => {
      const prior = readFinalFrameQaMark(fresh.aiScoreBreakdown);
      const videoUrl = finalVideoUrlOf(fresh);
      const checkingAtMs = now.getTime();
      const eligible = prior?.status === "pending" ||
        (prior?.status === "checking" && prior.checkingAtMs != null &&
          prior.checkingAtMs < checkingAtMs - FINAL_FRAME_QA_CLAIM_LEASE_MS);
      if (!videoUrl || !eligible) return null;
      return {
        where: videoUrlGuard(videoUrl),
        data: mergeFinalFrameQaReview(fresh, {
          mark: {
            status: "checking", checkingAtMs,
            ...(prior?.requestedAt ? { requestedAt: prior.requestedAt } : {}),
            ...(prior?.attempts ? { attempts: prior.attempts } : {}),
          },
          issues: ((Array.isArray(fresh.aiIssues) ? fresh.aiIssues : []) as unknown[])
            .filter((issue): issue is string => typeof issue === "string" && issue.startsWith("[成片复检]")),
        }),
        result: { checkingAtMs, videoUrl },
      };
    },
  ),
  saveClaimed: async (row, claim, build) => Boolean(await writeQaReview(
    (tx) => tx.qAReview.findUnique({ where: { id: row.id }, select: pendingRowSelect }),
    (fresh) => {
      const mark = readFinalFrameQaMark(fresh.aiScoreBreakdown);
      if (mark?.status !== "checking" || mark.checkingAtMs !== claim.checkingAtMs) return null;
      if (finalVideoUrlOf(fresh) !== claim.videoUrl) return null;
      return {
        where: videoUrlGuard(claim.videoUrl),
        data: mergeFinalFrameQaReview(fresh, build(mark)),
        result: true,
      };
    },
  )),
  saveUnclaimed: async (row, write) => Boolean(await writeQaReview(
    (tx) => tx.qAReview.findUnique({ where: { id: row.id }, select: pendingRowSelect }),
    (fresh) => {
      const prior = readFinalFrameQaMark(fresh.aiScoreBreakdown);
      // The decision used the scanned version: a newer restitch must keep its marker.
      if (prior?.status !== "pending" || prior.requestedAt !== readFinalFrameQaMark(row.aiScoreBreakdown)?.requestedAt ||
          finalVideoUrlOf(fresh) !== finalVideoUrlOf(row)) return null;
      return {
        where: videoUrlGuard(finalVideoUrlOf(row)),
        data: mergeFinalFrameQaReview(fresh, write),
        result: true,
      };
    },
  )),
  run: runFinalFrameQa,
  isVisionAvailable: isFrameQaEnabled,
  reserve: () => reserveFrameQaBudgetSlot(),
  release: releaseFrameQaBudgetSlot,
  now: () => new Date(),
};

export async function runPendingFinalFrameQa(
  limit = FINAL_FRAME_QA_BATCH,
  overrides: Partial<FinalFrameQaServiceDeps> = {},
): Promise<FinalFrameQaSweep> {
  const deps = { ...defaultDeps, ...overrides };
  const mode = deps.mode();
  const sweep: FinalFrameQaSweep = { mode, scanned: 0, checked: 0, issues: 0, skipped: 0, deferred: 0, requeued: 0 };
  if (mode === "off") return sweep;

  /// 让路：段级门禁这一轮没跑完（预算不够）或 vision 在报错，影子复检不再添乱
  const usage = deps.budgetUsage();
  if (usage && usage.deferred > 0) return { ...sweep, skippedRound: "segment_gate_deferred" };
  if (usage && usage.visionFailures > 0) return { ...sweep, skippedRound: "segment_gate_vision_failed" };

  const batch = Math.max(1, Math.min(limit, FINAL_FRAME_QA_BATCH));
  const now = deps.now();
  const rows = (await deps.findPending(batch, now)).slice(0, batch);
  sweep.scanned = rows.length;

  for (const [index, row] of rows.entries()) {
    const prior = readFinalFrameQaMark(row.aiScoreBreakdown);
    const videoUrl = finalVideoUrlOf(row);
    if (!videoUrl) {
      const write = buildFinalFrameQaWrite(prior, skippedFinalFrameVerdict("成片没有可下载的 URL", deps.now()), deps.now());
      if (await deps.saveUnclaimed(row, write)) sweep.skipped += 1;
      else sweep.deferred += 1;
      continue;
    }
    /// vision 不可用：记 skipped + 原因，不占预算、不认领（结论是确定的）
    if (!deps.isVisionAvailable()) {
      const write = buildFinalFrameQaWrite(
        prior,
        skippedFinalFrameVerdict("vision 不可用（未配置 / mock 模式 / FRAME_QA_DISABLED）", deps.now()),
        deps.now(),
      );
      if (await deps.saveUnclaimed(row, write)) sweep.skipped += 1;
      else sweep.deferred += 1;
      continue;
    }
    const reservation = deps.reserve();
    if (!reservation.ok) {
      /// 本轮预算用完：这一条和后面的都留在 pending，下一轮再来
      sweep.deferred += rows.length - index;
      break;
    }
    const claim = await deps.claim(row, deps.now());
    if (!claim) {
      deps.release();
      sweep.deferred += 1;
      continue;
    }
    const result = await deps.run(claim.videoUrl, {
      firstFrameRef: referenceImageFromPlan(row.videoBrief?.videoGenerationPlan),
    });
    let requeued = false;
    const saved = await deps.saveClaimed(row, claim, (fresh) => {
      const write = buildFinalFrameQaWrite(fresh, result, deps.now());
      requeued = write.requeued;
      return { mark: write.mark, issues: write.issues };
    });
    if (!saved) {
      sweep.deferred += 1;
      continue;
    }
    if (requeued) sweep.requeued += 1;
    else if (result.status === "skipped") sweep.skipped += 1;
    else {
      sweep.checked += 1;
      if (result.status === "issues") sweep.issues += 1;
    }
    if (result.status !== "ok") {
      console.warn(`[final-frame-qa] review ${row.id}: ${result.status}${requeued ? " (requeued)" : ""}`, {
        issues: result.issues.length,
        skipReason: result.skipReason,
      });
    }
  }
  return sweep;
}
