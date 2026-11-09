import { Prisma, VideoJobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  FRAME_QA_FREE_RETRY_CAP,
  FRAME_QA_STATUS,
  frameQaBudgetUsage,
  isFrameQaInfraFailure,
  readFrameQaBlockCount,
  releaseFrameQaBudgetSlot,
  reserveFrameQaBudgetSlot,
  type FrameQaDetail,
} from "@/lib/services/frame-qa-gate";
import { isFrameQaEnabled, runFrameTextQa, type FrameQaVerdict } from "@/lib/video-generation/frame-qa";

/**
 * 交付后补检（2026-11-09）：把「没检成就交付了」的成片在质检恢复后补上结论。
 *
 * 帧质检自己坏掉（vision 欠费 / 超时 / 抽帧异常）时门禁放行并落 UNVERIFIED（见 frame-qa-gate）。
 * 10 月 OpenAI 欠费期间 20/24 条成片就是这样交付的，之后额度恢复了也没有任何东西回头再看它们。
 * poll-videos cron 每轮在既有帧质检预算里补检最多 FRAME_QA_RECHECK_BATCH 条：
 *
 *   - 只碰 SUCCEEDED + UNVERIFIED、成片 7 天内、距上次尝试满 30 分钟的行；
 *   - 让路：本轮段级门禁有 deferred 或 vision 报错（服务多半还没恢复）就整轮跳过，不白花下载与抽帧；
 *   - 认领：CAS 把 frameQaCheckedAt 推到现在（别的重叠调用按 30 分钟间隔自然避开），落库再 CAS 一次；
 *   - 结论：没检出 → PASSED；检出画面文字 → WOULD_BLOCK（片子已经交付，拦不回来，只能标出来给人复核并告警）；
 *     还是没检成 → 保持 UNVERIFIED、recheckCount+1，满 FRAME_QA_RECHECK_MAX_ATTEMPTS 次改记 SKIPPED 收口；
 *   - 永不改 VideoJob.status、不触发重抽、不扣费、不动成片地址。
 *
 * Vercel 函数里不 await 的异步会被冻结，所以全部 await，由调用方放进 allSettled。
 */
export const FRAME_QA_RECHECK_BATCH = 2;
export const FRAME_QA_RECHECK_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const FRAME_QA_RECHECK_MIN_INTERVAL_MS = 30 * 60_000;
export const FRAME_QA_RECHECK_MAX_ATTEMPTS = 6;

export interface FrameQaRecheckRow {
  id: string;
  outputVideoUrl: string | null;
  frameQaCheckedAt: Date | null;
  frameQaDetail: unknown;
}

export interface FrameQaRecheckSweep {
  scanned: number;
  passed: number;
  /** 补检检出画面文字（片子已交付，标 WOULD_BLOCK 待人工复核） */
  flagged: number;
  /** 这次还是没检成，留着下次再试 */
  stillUnverified: number;
  /** 补检次数用满，改记 SKIPPED 收口 */
  gaveUp: number;
  deferred: number;
  skippedRound?: "disabled" | "segment_gate_deferred" | "segment_gate_vision_failed";
}

export interface FrameQaRecheckDeps {
  isFrameQaEnabled: () => boolean;
  findCandidates: (now: Date, limit: number) => Promise<FrameQaRecheckRow[]>;
  /** CAS 认领：frameQaCheckedAt 仍是读到的值才推到 now */
  claim: (row: FrameQaRecheckRow, now: Date) => Promise<boolean>;
  /** CAS 落库：仍是本次认领（UNVERIFIED + frameQaCheckedAt = claimedAt）才写 */
  save: (id: string, claimedAt: Date, status: string, detail: FrameQaDetail, checkedAt: Date) => Promise<boolean>;
  runFrameTextQa: (videoUrl: string) => Promise<FrameQaVerdict>;
  reserveSlot: () => { ok: boolean };
  releaseSlot: () => void;
  budgetUsage: () => { deferred: number; visionFailures: number } | null;
  alertFlagged: (jobId: string, summary: string) => Promise<void>;
  now: () => Date;
}

function readRecheckCount(detail: unknown): number {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return 0;
  const raw = (detail as { recheckCount?: unknown }).recheckCount;
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : 0;
}

/**
 * 纯决策：补检结论 + 这条的历史 → 要落库的状态与明细。
 * 交付后的补检永远不产出 BLOCKED（片子已经在商家手里）：检出就是 WOULD_BLOCK。
 */
export function decideFrameQaRecheck(args: {
  verdict: FrameQaVerdict;
  priorDetail: unknown;
  checkedAt: Date;
}): { status: string; detail: FrameQaDetail; outcome: "passed" | "flagged" | "still_unverified" | "gave_up" } {
  const { verdict, priorDetail, checkedAt } = args;
  const recheckCount = readRecheckCount(priorDetail) + 1;
  const blockCount = readFrameQaBlockCount(priorDetail);
  const common = {
    v: 1 as const,
    frameCount: verdict.frameCount,
    issues: verdict.issues,
    blockCount,
    freeRetryCap: FRAME_QA_FREE_RETRY_CAP,
    ...(verdict.shadow ? { shadow: verdict.shadow } : {}),
    budget: "recheck",
    recheckCount,
    checkedAt: checkedAt.toISOString(),
  };
  if (!verdict.checked) {
    const reason = verdict.skipReason ?? "门禁未执行";
    /// 「本来就不该检」（门禁被关了）或补检次数用满：收口成 SKIPPED，不再反复重试
    const exhausted = recheckCount >= FRAME_QA_RECHECK_MAX_ATTEMPTS || !isFrameQaInfraFailure(reason);
    const status = exhausted ? FRAME_QA_STATUS.SKIPPED : FRAME_QA_STATUS.UNVERIFIED;
    return {
      status,
      outcome: exhausted ? "gave_up" : "still_unverified",
      detail: {
        ...common,
        status,
        checked: false,
        summary: exhausted
          ? `交付后补检 ${recheckCount} 次仍未检成，不再重试：${reason}`
          : `交付后补检未检成（第 ${recheckCount} 次）：${reason}`,
        skipReason: reason,
      },
    };
  }
  if (verdict.ok) {
    return {
      status: FRAME_QA_STATUS.PASSED,
      outcome: "passed",
      detail: { ...common, status: FRAME_QA_STATUS.PASSED, checked: true, summary: `交付后补检通过：${verdict.summary}` },
    };
  }
  return {
    status: FRAME_QA_STATUS.WOULD_BLOCK,
    outcome: "flagged",
    detail: {
      ...common,
      status: FRAME_QA_STATUS.WOULD_BLOCK,
      checked: true,
      summary: verdict.summary,
      warning: "这条成片交付时质检没跑成，交付后补检检出画面文字；片子已在商家手里，需人工复核",
    },
  };
}

export function frameQaRecheckWhere(now: Date): Prisma.VideoJobWhereInput {
  return {
    status: VideoJobStatus.SUCCEEDED,
    frameQaStatus: FRAME_QA_STATUS.UNVERIFIED,
    outputVideoUrl: { not: null },
    supersededAt: null,
    finishedAt: { gte: new Date(now.getTime() - FRAME_QA_RECHECK_WINDOW_MS) },
    OR: [
      { frameQaCheckedAt: null },
      { frameQaCheckedAt: { lt: new Date(now.getTime() - FRAME_QA_RECHECK_MIN_INTERVAL_MS) } },
    ],
  };
}

async function alertRecheckFlagged(jobId: string, summary: string): Promise<void> {
  try {
    const { sendOpsAlert } = await import("@/lib/services/ops-alert-service");
    await sendOpsAlert({
      kind: "frame_qa_unverified",
      dedupeKey: `frame-qa-recheck-flagged:${jobId}`,
      window: "day",
      title: "已交付的成片补检检出画面文字",
      lines: [`任务 ${jobId}`, summary, "交付时质检没跑成；请人工复核，必要时联系商家重出"],
    });
  } catch (error) {
    console.warn(`[frame-qa-recheck] job ${jobId} 告警失败（已忽略）:`, (error as Error).message);
  }
}

const defaultDeps: FrameQaRecheckDeps = {
  isFrameQaEnabled,
  findCandidates: (now, limit) =>
    db.videoJob.findMany({
      where: frameQaRecheckWhere(now),
      orderBy: [{ frameQaCheckedAt: "asc" }],
      take: limit,
      select: { id: true, outputVideoUrl: true, frameQaCheckedAt: true, frameQaDetail: true },
    }),
  claim: async (row, now) => {
    const claimed = await db.videoJob.updateMany({
      where: {
        id: row.id,
        status: VideoJobStatus.SUCCEEDED,
        frameQaStatus: FRAME_QA_STATUS.UNVERIFIED,
        frameQaCheckedAt: row.frameQaCheckedAt,
      },
      data: { frameQaCheckedAt: now },
    });
    return claimed.count === 1;
  },
  save: async (id, claimedAt, status, detail, checkedAt) => {
    const saved = await db.videoJob.updateMany({
      where: {
        id,
        status: VideoJobStatus.SUCCEEDED,
        frameQaStatus: FRAME_QA_STATUS.UNVERIFIED,
        frameQaCheckedAt: claimedAt,
      },
      data: {
        frameQaStatus: status,
        frameQaCheckedAt: checkedAt,
        frameQaDetail: detail as unknown as Prisma.InputJsonValue,
      },
    });
    return saved.count === 1;
  },
  runFrameTextQa: (videoUrl) => runFrameTextQa(videoUrl),
  reserveSlot: () => reserveFrameQaBudgetSlot(),
  releaseSlot: releaseFrameQaBudgetSlot,
  budgetUsage: frameQaBudgetUsage,
  alertFlagged: alertRecheckFlagged,
  now: () => new Date(),
};

export async function runPendingFrameQaRechecks(
  limit: number = FRAME_QA_RECHECK_BATCH,
  overrides: Partial<FrameQaRecheckDeps> = {},
): Promise<FrameQaRecheckSweep> {
  const deps = { ...defaultDeps, ...overrides };
  const sweep: FrameQaRecheckSweep = { scanned: 0, passed: 0, flagged: 0, stillUnverified: 0, gaveUp: 0, deferred: 0 };
  if (!deps.isFrameQaEnabled()) return { ...sweep, skippedRound: "disabled" };

  /// 段级门禁先用预算：它这一轮有排队的、或 vision 刚报过错，补检整轮让路
  const usage = deps.budgetUsage();
  if (usage && usage.visionFailures > 0) return { ...sweep, skippedRound: "segment_gate_vision_failed" };
  if (usage && usage.deferred > 0) return { ...sweep, skippedRound: "segment_gate_deferred" };

  const rows = await deps.findCandidates(deps.now(), limit);
  sweep.scanned = rows.length;
  for (const row of rows) {
    if (!row.outputVideoUrl) continue;
    if (!deps.reserveSlot().ok) {
      sweep.deferred += 1;
      break;
    }
    const claimedAt = deps.now();
    if (!(await deps.claim(row, claimedAt))) {
      deps.releaseSlot();
      continue;
    }
    const verdict = await deps.runFrameTextQa(row.outputVideoUrl);
    const decision = decideFrameQaRecheck({ verdict, priorDetail: row.frameQaDetail, checkedAt: deps.now() });
    /// 还是没检成：把 frameQaCheckedAt 留在认领时刻，30 分钟后才会再被拿到
    const checkedAt = decision.outcome === "still_unverified" ? claimedAt : deps.now();
    const saved = await deps.save(row.id, claimedAt, decision.status, decision.detail, checkedAt);
    if (!saved) continue;
    if (decision.outcome === "passed") sweep.passed += 1;
    else if (decision.outcome === "flagged") {
      sweep.flagged += 1;
      await deps.alertFlagged(row.id, decision.detail.summary);
    } else if (decision.outcome === "gave_up") sweep.gaveUp += 1;
    else {
      sweep.stillUnverified += 1;
      /// vision 多半还没恢复：这一轮不再往下试
      break;
    }
  }
  return sweep;
}
