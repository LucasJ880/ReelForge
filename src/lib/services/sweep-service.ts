import {
  FinalVideoStatus,
  Prisma,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  HISTORICAL_DISPATCH_CUTOFF,
  QUARANTINE_RELEASED,
  isHistoricalDispatchQuarantined,
  isRealVideoDispatchMode,
} from "./historical-dispatch-quarantine";
import { MAX_STITCH_ATTEMPTS } from "./stitch-service";

/**
 * Sweep Service —— 孤儿/超时任务清扫器。
 *
 * 原则：任何任务不允许永远处于「进行中」。每个异步环节有最大时长，
 * 超时后转为**用户可见的失败状态**（UI 有人话错误 + 重试按钮），绝不静默挂起。
 * 清扫本身零计费：只做 DB 状态迁移，不调任何外部生成 API。
 *
 * 三类清扫目标：
 *
 *  1. VideoJob 超时 —— RUNNING/QUEUED 且超过 timeoutAt + 宽限期；
 *     或 timeoutAt 为 null（部分创建路径提交前不设）且 createdAt 超过兜底时长。
 *     → FAILED + userSafeError。用户点「重试」时 retryFailedVideoJob 会先查
 *       Provider 真实状态：若其实已成功则直接翻正、不重复扣费（既有双保险）。
 *
 *  2. FinalVideo 卡在 STITCHING —— runner 领取后崩溃/失联，超过 stitch 超时。
 *     → stitchAttempts+1；未达上限转回 PENDING（可被 runner 重新领取，续跑），
 *       达上限转 FAILED（UI 暴露重试）。
 *
 *  3. FinalVideo 卡在「等待合成」—— PENDING + 所有段 SUCCEEDED，但自最后一段
 *     完成起超过等待超时仍没被任何 worker 领取（本次事故的形态）。
 *     → FAILED + 人话 ffmpegError。重试走 retryStitch 续跑（复用已付费段）。
 *
 * FinalVideo 判 FAILED 后会同步 brief → RENDER_FAILED + errorMessage，
 * 保证列表页/详情页立即可见。
 *
 * 时长通过环境变量可调（分钟）：
 *   SWEEP_JOB_GRACE_MIN            job 超过 timeoutAt 后的宽限，默认 10
 *   SWEEP_JOB_NO_TIMEOUT_MAX_MIN   timeoutAt 缺失时按 createdAt 兜底，默认 60
 *   SWEEP_STITCH_TIMEOUT_MIN       STITCHING 最大时长，默认 30
 *   SWEEP_AWAIT_STITCH_TIMEOUT_MIN 等待合成最大时长，默认 45
 */

const JOB_GRACE_MIN = () => Number(process.env.SWEEP_JOB_GRACE_MIN ?? "10");
const JOB_NO_TIMEOUT_MAX_MIN = () =>
  Number(process.env.SWEEP_JOB_NO_TIMEOUT_MAX_MIN ?? "60");
const STITCH_TIMEOUT_MIN = () =>
  Number(process.env.SWEEP_STITCH_TIMEOUT_MIN ?? "30");
const AWAIT_STITCH_TIMEOUT_MIN = () =>
  Number(process.env.SWEEP_AWAIT_STITCH_TIMEOUT_MIN ?? "45");

const JOB_TIMEOUT_USER_ERROR =
  "视频生成超时，已自动停止。点击「重试」可继续（不会重复扣费）。";
const STITCH_TIMEOUT_ERROR =
  "合成超时，已自动停止。点击「重试」将从已完成的片段继续合成。";
const AWAIT_STITCH_TIMEOUT_ERROR =
  "合成排队超时，请点击「重试」从已完成的片段继续合成。";
const BRIEF_STITCH_FAILED_MESSAGE =
  "视频片段已生成，但最终合成未完成。点击「重试」可从已有片段继续，不会重新生成。";

export interface SweepResult {
  timedOutJobs: string[];
  /// STITCHING 超时 → 转回 PENDING 续跑的 FinalVideo
  requeuedStitching: string[];
  /// STITCHING 超时且重试耗尽 → FAILED 的 FinalVideo
  failedStitching: string[];
  /// 等待合成超时 → FAILED 的 FinalVideo
  failedAwaitingStitch: string[];
}

export async function sweepStuckTasks(now = new Date()): Promise<SweepResult> {
  const result: SweepResult = {
    timedOutJobs: [],
    requeuedStitching: [],
    failedStitching: [],
    failedAwaitingStitch: [],
  };

  await sweepTimedOutJobs(now, result);
  await sweepStuckStitching(now, result);
  await sweepAwaitingStitchTimeout(now, result);
  return result;
}

/**
 * Sweeper eligibility mirrors the provider-dispatch quarantine. In real mode,
 * a historical undecided row must remain untouched until an operator performs
 * the RELEASED/EXPIRED compare-and-swap. EXPIRED rows are terminally excluded
 * in every mode.
 */
function videoJobSweepEligibilityWhere(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Prisma.VideoJobWhereInput {
  const undecided: Prisma.VideoJobWhereInput = isRealVideoDispatchMode(env)
    ? {
        dispatchQuarantineDecision: null,
        createdAt: { gt: HISTORICAL_DISPATCH_CUTOFF },
      }
    : { dispatchQuarantineDecision: null };

  return {
    OR: [
      { dispatchQuarantineDecision: QUARANTINE_RELEASED },
      undecided,
    ],
  };
}

/// 1. VideoJob 超时
async function sweepTimedOutJobs(now: Date, result: SweepResult) {
  const cutoff = new Date(now.getTime() - JOB_GRACE_MIN() * 60_000);
  /// timeoutAt 缺失（如 FFMPEG_EDIT 本地任务、提交失败半途的行）按 createdAt 兜底，
  /// 保证「任何任务都不会永远进行中」没有豁免通道
  const noTimeoutCutoff = new Date(
    now.getTime() - JOB_NO_TIMEOUT_MAX_MIN() * 60_000,
  );
  const dispatchEligibility = videoJobSweepEligibilityWhere();
  const stuckJobs = await db.videoJob.findMany({
    where: {
      status: { in: [VideoJobStatus.RUNNING, VideoJobStatus.QUEUED] },
      AND: [dispatchEligibility],
      OR: [
        { timeoutAt: { not: null, lt: cutoff } },
        { timeoutAt: null, createdAt: { lt: noTimeoutCutoff } },
      ],
    },
    select: {
      id: true,
      videoBriefId: true,
      createdAt: true,
      dispatchQuarantineDecision: true,
    },
    take: 50,
  });
  if (stuckJobs.length === 0) return;

  const briefIds = new Set<string>();
  for (const job of stuckJobs) {
    /// Defense in depth：即使查询条件未来被改坏或行在读取后被人工 EXPIRED，
    /// 仍不能把隔离任务改成 FAILED 后送进 retry 重提路径。
    if (isHistoricalDispatchQuarantined(job)) continue;

    /// CAS：仍在 RUNNING/QUEUED 才失败化，避免与并发的 reconcile 冲突
    const updated = await db.videoJob.updateMany({
      where: {
        id: job.id,
        status: { in: [VideoJobStatus.RUNNING, VideoJobStatus.QUEUED] },
        createdAt: job.createdAt,
        dispatchQuarantineDecision: job.dispatchQuarantineDecision,
        AND: [dispatchEligibility],
      },
      data: {
        status: VideoJobStatus.FAILED,
        userSafeError: JOB_TIMEOUT_USER_ERROR,
        errorMessage: `sweep: job timed out (timeoutAt + ${JOB_GRACE_MIN()}min grace)`,
        finishedAt: now,
      },
    });
    if (updated.count > 0) {
      result.timedOutJobs.push(job.id);
      if (job.videoBriefId) briefIds.add(job.videoBriefId);
    }
  }

  /// 聚合回 brief（RENDER_FAILED + errorMessage 人话）—— 复用 video-service 逻辑
  const { syncBriefStatus } = await import("./video-service");
  for (const briefId of briefIds) {
    await syncBriefStatus(briefId).catch((err) =>
      console.warn(`[sweep] syncBriefStatus(${briefId}) failed:`, (err as Error).message),
    );
  }
}

/// 2. FinalVideo 卡 STITCHING（runner 失联）
async function sweepStuckStitching(now: Date, result: SweepResult) {
  const cutoff = new Date(now.getTime() - STITCH_TIMEOUT_MIN() * 60_000);
  const stuck = await db.finalVideo.findMany({
    where: {
      status: FinalVideoStatus.STITCHING,
      OR: [
        { startedAt: { lt: cutoff } },
        { startedAt: null, updatedAt: { lt: cutoff } },
      ],
    },
    include: { brief: { select: { id: true } } },
    take: 20,
  });

  for (const fv of stuck) {
    const attempts = fv.stitchAttempts + 1;
    if (attempts < MAX_STITCH_ATTEMPTS) {
      /// 续跑：转回 PENDING，等 runner 重新领取（段都在，不重新生成）
      const updated = await db.finalVideo.updateMany({
        where: { id: fv.id, status: FinalVideoStatus.STITCHING },
        data: {
          status: FinalVideoStatus.PENDING,
          stitchAttempts: attempts,
          startedAt: null,
          ffmpegError: `sweep: stitching timed out after ${STITCH_TIMEOUT_MIN()}min, requeued (attempt ${attempts}/${MAX_STITCH_ATTEMPTS})`,
        },
      });
      if (updated.count > 0) result.requeuedStitching.push(fv.id);
    } else {
      const updated = await db.finalVideo.updateMany({
        where: { id: fv.id, status: FinalVideoStatus.STITCHING },
        data: {
          status: FinalVideoStatus.FAILED,
          stitchAttempts: attempts,
          finishedAt: now,
          ffmpegError: STITCH_TIMEOUT_ERROR,
        },
      });
      if (updated.count > 0) {
        result.failedStitching.push(fv.id);
        if (fv.brief?.id) await markBriefStitchFailed(fv.brief.id);
      }
    }
  }
}

/// 3. FinalVideo 卡「等待合成」（本次事故形态：段全成功但没人领取）
async function sweepAwaitingStitchTimeout(now: Date, result: SweepResult) {
  const timeoutMs = AWAIT_STITCH_TIMEOUT_MIN() * 60_000;
  const candidates = await db.finalVideo.findMany({
    where: { status: FinalVideoStatus.PENDING },
    include: {
      brief: { select: { id: true } },
      segments: { select: { status: true, finishedAt: true } },
    },
    take: 50,
  });

  for (const fv of candidates) {
    const allSucceeded =
      fv.segments.length === fv.segmentCount &&
      fv.segments.every((s) => s.status === VideoJobStatus.SUCCEEDED);
    if (!allSucceeded) continue;

    /// 锚点用「最后一段完成时间」——updatedAt 会被前端轮询不断刷新，不可靠
    const lastFinished = fv.segments.reduce<number>(
      (max, s) => Math.max(max, s.finishedAt?.getTime() ?? 0),
      0,
    );
    const anchor = lastFinished || fv.createdAt.getTime();
    if (now.getTime() - anchor < timeoutMs) continue;

    const updated = await db.finalVideo.updateMany({
      where: { id: fv.id, status: FinalVideoStatus.PENDING },
      data: {
        status: FinalVideoStatus.FAILED,
        finishedAt: now,
        ffmpegError: AWAIT_STITCH_TIMEOUT_ERROR,
      },
    });
    if (updated.count > 0) {
      result.failedAwaitingStitch.push(fv.id);
      if (fv.brief?.id) await markBriefStitchFailed(fv.brief.id);
    }
  }
}

async function markBriefStitchFailed(briefId: string) {
  await db.videoBrief
    .update({
      where: { id: briefId },
      data: {
        status: VideoBriefStatus.RENDER_FAILED,
        errorMessage: BRIEF_STITCH_FAILED_MESSAGE,
      },
    })
    .catch((err) =>
      console.warn(`[sweep] markBriefStitchFailed(${briefId}) failed:`, (err as Error).message),
    );
}

export const __test__ = {
  JOB_TIMEOUT_USER_ERROR,
  STITCH_TIMEOUT_ERROR,
  AWAIT_STITCH_TIMEOUT_ERROR,
  BRIEF_STITCH_FAILED_MESSAGE,
  videoJobSweepEligibilityWhere,
};
