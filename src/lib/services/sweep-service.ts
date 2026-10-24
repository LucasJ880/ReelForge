import {
  BatchJobStatus,
  FinalVideoStatus,
  Prisma,
  ProviderSubmissionState,
  VideoBriefStatus,
  VideoDispatchRequestState,
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
 *     → 已提交给合作方的任务（externalJobId 非空）**先走 reconcileVideoJob
 *       按真实状态收敛**：还在渲染就保活、成了就收割、供应商不可达才判死。
 *       0803-04 真机取证：波内 deadline 翻页会把已提交仍在渲染的任务孤儿化，
 *       此前的盲判 FAILED 会推翻 watchdog 的保活决定，「供应商还在渲染却被扫
 *       成失败」。未提交的行保持零外呼盲判。两类都受绝对上限兜底：超过
 *       SWEEP_JOB_ABSOLUTE_MAX_MIN 的任务无条件失败化，「任何任务不允许永远
 *       进行中」不豁免。
 *     → FAILED + userSafeError。用户点「重试」时 retryFailedVideoJob 会先查
 *       Provider 真实状态：若其实已成功则直接翻正、不重复扣费（既有双保险）。
 *     → 例外：批次里排队等槽位的行（QUEUED + 未提交 + 批次仍活跃）不吃
 *       createdAt 兜底——大批次低并发下队尾等一小时是健康状态，0803 v2 轮
 *       19 条零提交阵亡即此误判。它们的生命周期归 processBatchTick 管
 *       （故事板死局落地 / 熔断 / 取消），绝对上限仍然兜底。
 *     → 排队豁免、timeoutAt 缺失兜底、绝对上限、「已提交先对账」闸门一律按
 *       这一轮起点 COALESCE(availableAt, createdAt) 计时：重试只刷新 availableAt，
 *       老批次「重试全部」后的第 2、3 波不能按首轮 createdAt 一出生就被判死。
 *
 *  2. FinalVideo 卡在 STITCHING —— runner 领取后崩溃/失联，超过 stitch 超时。
 *     → stitchAttempts+1；未达上限转回 PENDING（可被 runner 重新领取，续跑），
 *       达上限转 FAILED（UI 暴露重试）。
 *
 *  3. FinalVideo 卡在「等待合成」—— PENDING + 所有段 SUCCEEDED，但自最后一段
 *     完成起超过等待超时仍没被任何 worker 领取（本次事故的形态）。
 *     → FAILED + 人话 ffmpegError。重试走 retryStitch 续跑（复用已付费段）。
 *     没有 brief 也没有段、超过一天的 PENDING 孤儿只改状态归档为 FAILED。
 *
 *  4. 自助派发中途异常留下的「无任务 brief」—— 严格限定范围，见
 *     sweepJoblessSelfServeBriefs；内部代运营流程的 brief 不受影响。
 *
 * FinalVideo 判 FAILED 后会同步 brief → RENDER_FAILED + errorMessage，
 * 保证列表页/详情页立即可见。
 *
 * 时长通过环境变量可调（分钟）：
 *   SWEEP_JOB_GRACE_MIN            job 超过 timeoutAt 后的宽限，默认 10
 *   SWEEP_JOB_NO_TIMEOUT_MAX_MIN   timeoutAt 缺失时按 createdAt 兜底，默认 60
 *   SWEEP_JOB_ABSOLUTE_MAX_MIN     任何 RUNNING/QUEUED 行的绝对寿命上限，默认 720
 *   SWEEP_STITCH_TIMEOUT_MIN       STITCHING 最大时长，默认 30
 *   SWEEP_AWAIT_STITCH_TIMEOUT_MIN 等待合成最大时长，默认 45
 *   SWEEP_ORPHAN_FINAL_VIDEO_MIN   孤儿 FinalVideo 归档前的最短寿命，默认 1440
 *   SWEEP_JOBLESS_BRIEF_ROUTE_BOUND_SEC 派发路由执行上界（秒），默认 900
 */

const JOB_GRACE_MIN = () => Number(process.env.SWEEP_JOB_GRACE_MIN ?? "10");
const JOB_NO_TIMEOUT_MAX_MIN = () =>
  Number(process.env.SWEEP_JOB_NO_TIMEOUT_MAX_MIN ?? "60");
const JOB_ABSOLUTE_MAX_MIN = () =>
  Number(process.env.SWEEP_JOB_ABSOLUTE_MAX_MIN ?? "720");
const STITCH_TIMEOUT_MIN = () =>
  Number(process.env.SWEEP_STITCH_TIMEOUT_MIN ?? "30");
const AWAIT_STITCH_TIMEOUT_MIN = () =>
  Number(process.env.SWEEP_AWAIT_STITCH_TIMEOUT_MIN ?? "45");
const ORPHAN_FINAL_VIDEO_MIN = () =>
  Number(process.env.SWEEP_ORPHAN_FINAL_VIDEO_MIN ?? "1440");

/// 无任务 brief 看门狗只处理本轮（2026-10-25）上线之后创建的 brief，历史不追溯。
const JOBLESS_BRIEF_SWEEP_SINCE = new Date("2026-10-25T00:00:00.000Z");
/// 派发路由执行时长的上界：Vercel 函数可配置的最长 800s + 100s 余量。
/// brief 比它还老，创建它的请求必然已经结束或被平台杀掉。
const JOBLESS_BRIEF_ROUTE_BOUND_MS = () =>
  Number(process.env.SWEEP_JOBLESS_BRIEF_ROUTE_BOUND_SEC ?? "900") * 1000;
/// 请求已写回终态时也留 2 分钟余量，避开「刚建 brief、正要建任务」的窗口。
const JOBLESS_BRIEF_SETTLED_GRACE_MS = 2 * 60_000;

const JOB_TIMEOUT_USER_ERROR =
  "视频生成超时，已自动停止。点击「重试」可继续（不会重复扣费）。";
const STITCH_TIMEOUT_ERROR =
  "合成超时，已自动停止。点击「重试」将从已完成的片段继续合成。";
const AWAIT_STITCH_TIMEOUT_ERROR =
  "合成排队超时，请点击「重试」从已完成的片段继续合成。";
const BRIEF_STITCH_FAILED_MESSAGE =
  "视频片段已生成，但最终合成未完成。点击「重试」可从已有片段继续，不会重新生成。";
/// 孤儿 FinalVideo 没有 brief，这段只进运维字段，客户看不到。
const ORPHAN_FINAL_VIDEO_ERROR =
  "sweep: orphan FinalVideo (no brief, no segments) archived as FAILED";
const JOBLESS_BRIEF_FAILED_MESSAGE =
  "这条视频在开始生成前中断了，没有提交给生成服务。请重新发起一次；如果反复出现，请联系支持。";

export interface SweepResult {
  timedOutJobs: string[];
  /// 已提交给合作方、超时后改由 reconcileVideoJob 按真实状态收敛的 job
  /// （保活 / 收割 / 判死由 reconcile 决定，sweep 不再盲判）
  reconciledJobs: string[];
  /// STITCHING 超时 → 转回 PENDING 续跑的 FinalVideo
  requeuedStitching: string[];
  /// STITCHING 超时且重试耗尽 → FAILED 的 FinalVideo
  failedStitching: string[];
  /// 等待合成超时 → FAILED 的 FinalVideo
  failedAwaitingStitch: string[];
  /// 没有 brief 也没有分段的 PENDING 孤儿 → 归档为 FAILED（只改状态）
  failedOrphanFinalVideos: string[];
  /// 自助派发中途异常、一个任务都没建出来的 brief → RENDER_FAILED
  failedJoblessBriefs: string[];
}

export async function sweepStuckTasks(now = new Date()): Promise<SweepResult> {
  const result: SweepResult = {
    timedOutJobs: [],
    reconciledJobs: [],
    requeuedStitching: [],
    failedStitching: [],
    failedAwaitingStitch: [],
    failedOrphanFinalVideos: [],
    failedJoblessBriefs: [],
  };

  await sweepTimedOutJobs(now, result);
  await sweepStuckStitching(now, result);
  await sweepAwaitingStitchTimeout(now, result);
  /// 两段新清扫各自兜住异常：它们出错不能拖垮上面三段既有的收口。
  await sweepOrphanFinalVideos(now, result).catch((err) =>
    console.warn("[sweep] orphan FinalVideo sweep failed:", (err as Error).message),
  );
  await sweepJoblessSelfServeBriefs(now, result).catch((err) =>
    console.warn("[sweep] jobless brief sweep failed:", (err as Error).message),
  );
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

/**
 * 任务「这一轮」的起点：COALESCE(availableAt, createdAt)。
 *
 * 批量重试（全部 / 单条）、租约回收、熔断恢复都会把 availableAt 刷成当下，
 * 但 createdAt 永远是首轮的创建时刻。de8f698 只修了首次排队：13 小时前建的
 * 批次点「重试全部」，第 2、3 波按 createdAt 计时一出生就越过绝对上限，
 * 下一分钟就被扫成「生成超时」。排队豁免、绝对上限、提交后先对账的闸门
 * 都必须按这一轮的起点计时。单条任务从不写 availableAt，自然回落到 createdAt。
 *
 * 每个分支都显式写 availableAt 非空 / 为空：这段条件会被放进 NOT(...)，
 * 「availableAt >= x」遇到 NULL 是 SQL 的 unknown，NOT(unknown) 仍是 unknown，
 * 行会被静默漏掉——必须让每个分支只取 true / false。
 */
function roundStartedOnOrAfter(cutoff: Date): Prisma.VideoJobWhereInput {
  return {
    OR: [
      { availableAt: { not: null, gte: cutoff } },
      { availableAt: null, createdAt: { gte: cutoff } },
    ],
  };
}

function roundStartedBefore(cutoff: Date): Prisma.VideoJobWhereInput {
  return {
    OR: [
      { availableAt: { not: null, lt: cutoff } },
      { availableAt: null, createdAt: { lt: cutoff } },
    ],
  };
}

function roundStartedAt(job: { availableAt: Date | null; createdAt: Date }): Date {
  return job.availableAt ?? job.createdAt;
}

/// 排队等槽位的批次行：QUEUED、从未开始提交、批次仍活跃。这是健康状态而不是
/// 孤儿——它们的生命周期归 processBatchTick 管，sweep 只在绝对上限后兜底。
/// 显式判 batchJobId 非空：关系过滤是 LEFT JOIN，单条任务那一侧全是 NULL；
/// 不依赖 Prisma 关系过滤的 SQL 细节，整段条件对单条任务也确定为 false，
/// 套进 NOT 之后确定为 true（单条任务照常吃超时兜底）。
function activeBatchQueueWhere(
  absoluteCutoff: Date,
): Prisma.VideoJobWhereInput {
  return {
    status: VideoJobStatus.QUEUED,
    submissionState: ProviderSubmissionState.NOT_STARTED,
    externalJobId: null,
    batchJobId: { not: null },
    ...roundStartedOnOrAfter(absoluteCutoff),
    batchJob: {
      is: {
        status: {
          in: [
            BatchJobStatus.EXPANDING,
            BatchJobStatus.RUNNING,
            BatchJobStatus.PAUSED,
          ],
        },
      },
    },
  };
}

/// 1. VideoJob 超时
function timedOutJobCutoffs(now: Date) {
  return {
    cutoff: new Date(now.getTime() - JOB_GRACE_MIN() * 60_000),
    /// timeoutAt 缺失（如 FFMPEG_EDIT 本地任务、提交失败半途的行）按这一轮起点兜底，
    /// 保证「任何任务都不会永远进行中」没有豁免通道
    noTimeoutCutoff: new Date(
      now.getTime() - JOB_NO_TIMEOUT_MAX_MIN() * 60_000,
    ),
    /// 绝对寿命上限：超过它的行无条件失败化，不再问供应商也不再豁免排队行。
    /// 这是「先按真实状态收敛」引入的保活路径的总兜底。
    absoluteCutoff: new Date(
      now.getTime() - JOB_ABSOLUTE_MAX_MIN() * 60_000,
    ),
  };
}

/// 超时候选的查询条件（抽出来便于对真实 Postgres 校验 NULL 语义）。
function timedOutJobsWhere(
  now: Date,
  dispatchEligibility: Prisma.VideoJobWhereInput = videoJobSweepEligibilityWhere(),
): Prisma.VideoJobWhereInput {
  const { cutoff, noTimeoutCutoff, absoluteCutoff } = timedOutJobCutoffs(now);
  return {
    status: { in: [VideoJobStatus.RUNNING, VideoJobStatus.QUEUED] },
    AND: [dispatchEligibility],
    OR: [
      { timeoutAt: { not: null, lt: cutoff } },
      /// timeoutAt 缺失的兜底同样按「这一轮」起点计时：批量重试后的行
      /// 不能因为首轮建得早就被立刻兜底扫掉。
      { timeoutAt: null, ...roundStartedBefore(noTimeoutCutoff) },
    ],
    NOT: activeBatchQueueWhere(absoluteCutoff),
  };
}

async function sweepTimedOutJobs(now: Date, result: SweepResult) {
  const { absoluteCutoff } = timedOutJobCutoffs(now);
  const dispatchEligibility = videoJobSweepEligibilityWhere();
  const stuckJobs = await db.videoJob.findMany({
    where: timedOutJobsWhere(now, dispatchEligibility),
    select: {
      id: true,
      videoBriefId: true,
      createdAt: true,
      availableAt: true,
      externalJobId: true,
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

    /// 绝对上限按「这一轮」起点算：重试过的行从重试那一刻重新计寿命。
    const beyondAbsoluteCap = roundStartedAt(job) < absoluteCutoff;

    /// 已提交给合作方且未超绝对上限：判死前必须问一次真实状态。
    /// reconcileVideoJob 内联了 watchdog 双信号——还在渲染就保活（供应商还在
    /// 干活的付费任务绝不丢弃）、完成就收割、供应商不可达才 FAILED。
    if (job.externalJobId && !beyondAbsoluteCap) {
      try {
        const { reconcileVideoJob } = await import("./video-service");
        await reconcileVideoJob(job.id);
        result.reconciledJobs.push(job.id);
        if (job.videoBriefId) briefIds.add(job.videoBriefId);
      } catch (err) {
        /// reconcile 本身异常（非供应商不可达）：留给下一轮，绝对上限兜底。
        console.warn(
          `[sweep] reconcileVideoJob(${job.id}) failed:`,
          (err as Error).message,
        );
      }
      continue;
    }

    /// CAS：仍在 RUNNING/QUEUED 才失败化，避免与并发的 reconcile 冲突；
    /// availableAt 一并比对——读取之后若被重试刷新过，这一轮是新的，不许按旧钟判死。
    const updated = await db.videoJob.updateMany({
      where: {
        id: job.id,
        status: { in: [VideoJobStatus.RUNNING, VideoJobStatus.QUEUED] },
        createdAt: job.createdAt,
        availableAt: job.availableAt,
        dispatchQuarantineDecision: job.dispatchQuarantineDecision,
        AND: [dispatchEligibility],
      },
      data: {
        status: VideoJobStatus.FAILED,
        userSafeError: JOB_TIMEOUT_USER_ERROR,
        errorMessage:
          beyondAbsoluteCap
            ? `sweep: job exceeded absolute lifetime cap (${JOB_ABSOLUTE_MAX_MIN()}min)`
            : `sweep: job timed out (timeoutAt + ${JOB_GRACE_MIN()}min grace)`,
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
        where: {
          id: fv.id,
          status: FinalVideoStatus.STITCHING,
          stitchAttemptToken: fv.stitchAttemptToken,
        },
        data: {
          status: FinalVideoStatus.PENDING,
          stitchAttempts: attempts,
          stitchAttemptToken: null,
          startedAt: null,
          ffmpegError: `sweep: stitching timed out after ${STITCH_TIMEOUT_MIN()}min, requeued (attempt ${attempts}/${MAX_STITCH_ATTEMPTS})`,
        },
      });
      if (updated.count > 0) result.requeuedStitching.push(fv.id);
    } else {
      const updated = await db.finalVideo.updateMany({
        where: {
          id: fv.id,
          status: FinalVideoStatus.STITCHING,
          stitchAttemptToken: fv.stitchAttemptToken,
        },
        data: {
          status: FinalVideoStatus.FAILED,
          stitchAttempts: attempts,
          stitchAttemptToken: null,
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
///
/// 候选直接在查询里筛「至少一段且所有段 SUCCEEDED」并按创建时间排序：
/// 此前 take 50 不排序、在内存里才筛，生产上 10 条永远凑不齐段的
/// PENDING 孤儿会占住窗口，真正该收口的候选超过 50 条后被饿死。
async function sweepAwaitingStitchTimeout(now: Date, result: SweepResult) {
  const timeoutMs = AWAIT_STITCH_TIMEOUT_MIN() * 60_000;
  const candidates = await db.finalVideo.findMany({
    where: awaitingStitchCandidateWhere(),
    include: {
      brief: { select: { id: true } },
      segments: { select: { status: true, finishedAt: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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
        stitchAttemptToken: null,
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

/// 3b. FinalVideo 孤儿：PENDING、没有 brief 也没有任何分段，且建好超过一天。
/// 生产上 9 条这样的行停在 PENDING 九十多天——没有段可合成、没有 brief 可展示，
/// 只会永远占着「等待合成」。只改状态归档为 FAILED，不删任何行（铁律 §4.2）。
function orphanFinalVideoWhere(): Prisma.FinalVideoWhereInput {
  return {
    status: FinalVideoStatus.PENDING,
    brief: { is: null },
    segments: { none: {} },
  };
}

/// 等待合成的候选：至少一段且所有段都 SUCCEEDED（段数是否齐全仍在内存里核对）。
function awaitingStitchCandidateWhere(): Prisma.FinalVideoWhereInput {
  return {
    status: FinalVideoStatus.PENDING,
    segments: {
      some: {},
      every: { status: VideoJobStatus.SUCCEEDED },
    },
  };
}

async function sweepOrphanFinalVideos(now: Date, result: SweepResult) {
  const cutoff = new Date(now.getTime() - ORPHAN_FINAL_VIDEO_MIN() * 60_000);
  const orphanWhere = orphanFinalVideoWhere();
  const orphans = await db.finalVideo.findMany({
    where: { ...orphanWhere, createdAt: { lt: cutoff } },
    select: {
      id: true,
      createdAt: true,
      brief: { select: { id: true } },
      segments: { select: { id: true }, take: 1 },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 50,
  });
  for (const fv of orphans) {
    /// 纵深防御：查询条件将来被改坏时，有 brief 或有段的行绝不按孤儿处理。
    if (fv.brief || fv.segments.length > 0 || fv.createdAt >= cutoff) continue;
    const updated = await db.finalVideo.updateMany({
      where: { id: fv.id, ...orphanWhere },
      data: {
        status: FinalVideoStatus.FAILED,
        stitchAttemptToken: null,
        finishedAt: now,
        ffmpegError: ORPHAN_FINAL_VIDEO_ERROR,
      },
    });
    if (updated.count > 0) result.failedOrphanFinalVideos.push(fv.id);
  }
}

/**
 * 4. 单条派发中途异常留下的「无任务 brief」看门狗。
 *
 * 形态（生产 1 行、30 天+）：dispatch 路由先建订单与 brief，再调派发；派发在
 * 创建任何 VideoJob 之前抛错，brief 永远停在 SCENE_PROMPT_READY / RENDER_QUEUED，
 * 成品库一直显示「准备中」，不能重试也不能取消。
 *
 * 只收严格限定的一类，其余一律不碰：
 *  - 自助派发产生的：订单 productInput.source=unified_input 且 requestOrigin=web_app。
 *    内部代运营流程的 brief 停在 SCENE_PROMPT_READY 是正常的「等操作员派发」，
 *    绝不能被扫成失败。
 *  - 本轮上线之后创建的（JOBLESS_BRIEF_SWEEP_SINCE）：历史行不追溯，留给人工。
 *  - 创建它的那次派发请求已经不可能还在跑：要么 brief 本身已比路由最长执行时间
 *    再加余量还老（请求一定先于 brief 创建），要么该用户在 brief 创建前的那段
 *    窗口里已没有 PROCESSING 的派发请求（请求已写回终态）。
 *  - 写入时 CAS：状态没变且仍然没有任何任务，才改 RENDER_FAILED。
 *
 * 只改 brief 状态与人话原因；额度返还由对账函数按 D1 处理，不在这里做。
 */
async function sweepJoblessSelfServeBriefs(now: Date, result: SweepResult) {
  const routeBoundCutoff = new Date(now.getTime() - JOBLESS_BRIEF_ROUTE_BOUND_MS());
  const settledGraceCutoff = new Date(now.getTime() - JOBLESS_BRIEF_SETTLED_GRACE_MS);
  const candidates = await db.videoBrief.findMany({
    where: {
      ...joblessSelfServeBriefWhere(),
      createdAt: { gt: JOBLESS_BRIEF_SWEEP_SINCE, lt: settledGraceCutoff },
    },
    select: {
      id: true,
      createdAt: true,
      contentAngle: {
        select: {
          round: { select: { deliveryOrder: { select: { createdById: true } } } },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 20,
  });

  for (const brief of candidates) {
    const ownerId = brief.contentAngle.round.deliveryOrder.createdById;
    if (!ownerId) continue;
    if (brief.createdAt >= routeBoundCutoff) {
      /// 还没老过路由执行上限：只有确认创建它的请求已经结束才处理。
      const inflight = await db.videoDispatchRequest.count({
        where: {
          userId: ownerId,
          state: VideoDispatchRequestState.PROCESSING,
          createdAt: {
            gte: new Date(brief.createdAt.getTime() - JOBLESS_BRIEF_ROUTE_BOUND_MS()),
            lte: brief.createdAt,
          },
        },
      });
      if (inflight > 0) continue;
    }
    const updated = await db.videoBrief.updateMany({
      where: { id: brief.id, ...joblessSelfServeBriefWhere() },
      data: {
        status: VideoBriefStatus.RENDER_FAILED,
        errorMessage: JOBLESS_BRIEF_FAILED_MESSAGE,
      },
    });
    if (updated.count > 0) result.failedJoblessBriefs.push(brief.id);
  }
}

function joblessSelfServeBriefWhere(): Prisma.VideoBriefWhereInput {
  return {
    status: {
      in: [VideoBriefStatus.SCENE_PROMPT_READY, VideoBriefStatus.RENDER_QUEUED],
    },
    videoJobs: { none: {} },
    contentAngle: {
      round: {
        deliveryOrder: {
          AND: [
            { productInput: { path: ["source"], equals: "unified_input" } },
            { productInput: { path: ["requestOrigin"], equals: "web_app" } },
          ],
        },
      },
    },
  };
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
  JOBLESS_BRIEF_FAILED_MESSAGE,
  JOBLESS_BRIEF_SWEEP_SINCE,
  videoJobSweepEligibilityWhere,
  activeBatchQueueWhere,
  timedOutJobsWhere,
  orphanFinalVideoWhere,
  awaitingStitchCandidateWhere,
  joblessSelfServeBriefWhere,
};
