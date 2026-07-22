import { randomUUID } from "node:crypto";
import {
  FinalVideoStatus,
  Prisma,
  ProviderSubmissionState,
  VideoBriefStatus,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  classifyCustomerGenerationError,
  SubmissionReconciliationRequiredError,
  type CustomerGenerationError,
} from "@/lib/api/customer-generation-error";
import { isMockVideoRuntime } from "@/lib/config/env";
import { processReferenceImages } from "@/lib/providers/remove-bg";
import {
  parseDirectorPlan,
  type DirectorPlan,
  type SegmentPlan,
} from "@/lib/schemas/director-plan";
import {
  FRAME_QA_ERROR_PREFIX,
  runFrameTextQa,
} from "@/lib/video-generation/frame-qa";
import {
  createVideoProviderByRouteSnapshot,
} from "@/lib/video-generation/providers";
import type {
  CreateVideoJobOptions,
  VideoJobStatusResult,
} from "@/lib/video-generation/providers/types";
import {
  asProviderSubmissionError,
  type ProviderSubmissionError,
} from "@/lib/video-generation/providers/submission-error";
import {
  createVideoRouteSnapshot,
  readVideoRouteSnapshot,
  type PersistedVideoRouteSnapshotInput,
  type VideoRouteSnapshot,
} from "@/lib/video-generation/video-route-registry";
import {
  WATCHDOG_STALLED_PREFIX,
  WATCHDOG_STALLED_USER_ERROR,
  WATCHDOG_TIMEOUT_PREFIX,
  WATCHDOG_TIMEOUT_USER_ERROR,
  detectProviderStall,
  isPastHardDeadline,
  logStatusTransition,
  videoJobDeadlineMin,
  watchdogGraceMin,
} from "./video-watchdog";
import { isHistoricalDispatchQuarantined } from "./historical-dispatch-quarantine";
import { requireApprovedStoryboardForBrief } from "@/lib/video-generation/storyboard-service";
const I2V_MODEL_OVERRIDE = process.env.ARK_VIDEO_I2V_MODEL || undefined;

/// Provider 状态查询的可注入 seam；null 时按 VideoJob.provider 路由。
/// 故障注入测试（AC-1/AC-3/AC-6）通过 __setStatusFetcherForTests 替换。
type DirectProviderStatus = {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  rawProviderStatus: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  lastFrameUrl?: string;
  errorMessage?: string;
  progress?: number;
  rawProviderResponse?: unknown;
};

type DirectSubmitterOverride = (
  options: CreateVideoJobOptions,
) => Promise<{ jobId?: string; providerJobId?: string }>;
let statusFetcherOverride:
  | ((providerJobId: string) => Promise<DirectProviderStatus>)
  | null = null;
let submitterOverride: DirectSubmitterOverride | null = null;

export class HistoricalVideoRouteUnknownError extends Error {
  constructor() {
    super(
      "历史视频任务缺少不可变线路快照；已禁止 provider 调用，请转人工对账",
    );
    this.name = "HistoricalVideoRouteUnknownError";
  }
}

function requiredVideoRouteSnapshot(
  input: PersistedVideoRouteSnapshotInput,
): VideoRouteSnapshot {
  const read = readVideoRouteSnapshot(input);
  if (read.state === "historical_unknown") {
    throw new HistoricalVideoRouteUnknownError();
  }
  if (!read.route.enabled) {
    throw new Error("持久化视频线路尚未启用，拒绝 provider 调用");
  }
  const expectedAdapter =
    read.videoRouteSnapshot === "mock"
      ? "mock"
      : read.videoRouteSnapshot === "buddy"
        ? "shuyu"
        : "byteplus";
  if (read.videoProviderAdapterSnapshot !== expectedAdapter) {
    throw new Error("持久化视频线路与 adapter 快照不一致，拒绝 provider 调用");
  }
  return {
    videoRouteSnapshot: read.videoRouteSnapshot,
    videoModelSnapshot: read.videoModelSnapshot,
    videoProviderAdapterSnapshot: read.videoProviderAdapterSnapshot,
  };
}

function requiredJobVideoRouteSnapshot(
  job: PersistedVideoRouteSnapshotInput & { provider: VideoProvider },
): VideoRouteSnapshot {
  const read = readVideoRouteSnapshot(job);
  if (read.state === "historical_unknown" && job.provider === VideoProvider.MOCK) {
    return createVideoRouteSnapshot("mock");
  }
  return requiredVideoRouteSnapshot(job);
}

async function submitVideoJob(
  options: CreateVideoJobOptions,
  persistedRoute: PersistedVideoRouteSnapshotInput,
): Promise<{ jobId: string }> {
  if (submitterOverride) {
    const overridden = await submitterOverride(options);
    const jobId = overridden.jobId ?? overridden.providerJobId;
    if (!jobId) throw new Error("test submitter returned no provider job id");
    return { jobId };
  }
  const snapshot = requiredVideoRouteSnapshot(persistedRoute);
  if (snapshot.videoRouteSnapshot === "mock") {
    if (!isMockVideoRuntime()) {
      throw new Error("持久化 mock 线路不能在真实 provider 模式下提交");
    }
  }
  const result = await createVideoProviderByRouteSnapshot(
    snapshot,
  ).createVideoJob(options);
  return { jobId: result.providerJobId };
}

function toDirectProviderStatus(
  result: VideoJobStatusResult,
): DirectProviderStatus {
  return {
    jobId: result.providerJobId,
    status:
      result.normalizedStatus === "succeeded"
        ? "completed"
        : result.normalizedStatus === "failed" ||
            result.normalizedStatus === "cancelled"
          ? "failed"
          : result.normalizedStatus === "queued"
            ? "pending"
            : "processing",
    rawProviderStatus: result.rawProviderStatus,
    videoUrl: result.videoUrl,
    thumbnailUrl: result.thumbnailUrl,
    lastFrameUrl: result.lastFrameUrl,
    errorMessage: result.errorMessage,
    progress: result.progress,
    rawProviderResponse: result.rawProviderResponse,
  };
}

async function fetchVideoJobStatus(
  job: {
    provider: VideoProvider;
    externalJobId: string;
    videoRouteSnapshot?: string | null;
    videoModelSnapshot?: string | null;
    videoProviderAdapterSnapshot?: string | null;
  },
): Promise<DirectProviderStatus> {
  if (statusFetcherOverride) {
    return statusFetcherOverride(job.externalJobId);
  }
  const snapshot = requiredJobVideoRouteSnapshot(job);
  if (
    (job.provider === VideoProvider.MOCK) !==
    (snapshot.videoRouteSnapshot === "mock")
  ) {
    throw new Error("VideoJob provider 与持久化路线快照不一致");
  }
  return toDirectProviderStatus(
    await createVideoProviderByRouteSnapshot(snapshot).getVideoJobStatus(
      job.externalJobId,
    ),
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function classifyDirectSubmissionError(args: {
  error: unknown;
  providerAcknowledged: boolean;
  providerId?: string;
}): ProviderSubmissionError {
  return asProviderSubmissionError({
    error: args.error,
    providerId: args.providerId ?? "historical_unknown",
    evidence: args.providerAcknowledged
      ? { stage: "persistence" }
      : isMockVideoRuntime()
        ? { stage: "preflight", retryable: true }
        : undefined,
  });
}

async function failDirectSubmission(args: {
  jobId: string;
  providerRequestKey: string;
  error: unknown;
  providerAcknowledged: boolean;
  providerId?: string;
}) {
  const failure = classifyDirectSubmissionError(args);
  const acknowledgementUnknown =
    failure.disposition === "acknowledgement_unknown";
  const userSafeError = acknowledgementUnknown
    ? "生成服务可能已接收任务，系统已暂停重试以避免重复计费。请联系管理员核对。"
    : friendlySubmitError(failure.message);
  await db.videoJob.updateMany({
    where: {
      id: args.jobId,
      submissionState: ProviderSubmissionState.SUBMITTING,
      providerRequestKey: args.providerRequestKey,
    },
    data: {
      status: VideoJobStatus.FAILED,
      submissionState: acknowledgementUnknown
        ? ProviderSubmissionState.ACK_UNKNOWN
        : ProviderSubmissionState.REJECTED,
      submissionErrorClass: `${failure.disposition}:${failure.stage}`,
      errorMessage: acknowledgementUnknown
        ? `[provider:ack_unknown] ${failure.message}`
        : `[provider:rejected] ${failure.message}`,
      userSafeError,
      finishedAt: new Date(),
    },
  });
  const job = await db.videoJob.findUnique({ where: { id: args.jobId } });
  if (!job) throw new Error("VideoJob disappeared after submission failure");
  return job;
}

async function persistAcceptedSubmission(args: {
  jobId: string;
  providerRequestKey: string;
  externalJobId: string;
  submittedAt: Date;
  retryCount?: number;
}) {
  const updated = await db.videoJob.updateMany({
    where: {
      id: args.jobId,
      submissionState: ProviderSubmissionState.SUBMITTING,
      providerRequestKey: args.providerRequestKey,
    },
    data: {
      externalJobId: args.externalJobId,
      status: VideoJobStatus.RUNNING,
      submissionState: ProviderSubmissionState.ACCEPTED,
      submissionErrorClass: null,
      submittedAt: args.submittedAt,
      startedAt: args.submittedAt,
      finishedAt: null,
      timeoutAt: new Date(args.submittedAt.getTime() + deadlineMs()),
      errorMessage: null,
      userSafeError: null,
      lastProviderStatus: "queued",
      pollErrors: 0,
      ...(args.retryCount === undefined
        ? {}
        : { retryCount: args.retryCount }),
    },
  });
  if (updated.count !== 1) {
    throw new Error("provider acknowledgement could not be persisted");
  }
  const job = await db.videoJob.findUnique({ where: { id: args.jobId } });
  if (!job) throw new Error("VideoJob disappeared after provider acknowledgement");
  return job;
}

async function claimFailedJobForRetry(job: {
  id: string;
  status: VideoJobStatus;
  submissionState: ProviderSubmissionState;
  submitAttempts: number;
}) {
  const submittedAt = new Date();
  const providerRequestKey = `${job.id}:attempt:${job.submitAttempts + 1}`;
  const claimed = await db.videoJob.updateMany({
    where: {
      id: job.id,
      status: VideoJobStatus.FAILED,
      submissionState: job.submissionState,
    },
    data: {
      status: VideoJobStatus.RUNNING,
      submissionState: ProviderSubmissionState.SUBMITTING,
      submissionErrorClass: null,
      providerRequestKey,
      submittedAt,
      finishedAt: null,
      submitAttempts: { increment: 1 },
      errorMessage: null,
      userSafeError: null,
    },
  });
  if (claimed.count !== 1) {
    throw new Error("任务已被其他请求处理，请刷新状态后重试");
  }
  return { providerRequestKey, submittedAt };
}

/// 全局 deadline（INV-1，2026-07 事故后收紧为强制终态）：
/// 提交时写入 timeoutAt = now + deadline；watchdog 双信号内联在每次 reconcile 里执行，
/// 不再依赖外部 cron 的调度精度（cron + sweep 降级为纯兜底）。
const deadlineMs = () => videoJobDeadlineMin() * 60_000;
/// 连续 N 次轮询都失败 → 标记 FAILED，提供 retry。默认 3
const POLL_ERROR_THRESHOLD = Number(
  process.env.SEEDANCE_POLL_ERROR_THRESHOLD ?? "3",
);

/**
 * 总入口：根据 brief 配置自动选择单段 / 多段流水线。
 *
 * - 有 directorPlan + targetDurationSec > 15 → 走 dispatchMultiSegmentGeneration（PART 4）
 * - 否则（旧流程，含 Sunny Shutter）→ 走 dispatchVideoGeneration（基于 ScenePlan / VideoPrompt）
 *
 * 调用方应优先用 dispatchVideoForBrief，让 video-service 自己决定路径，
 * 避免在路由里重复判断逻辑。
 */
export async function dispatchVideoForBrief(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    select: {
      id: true,
      targetDurationSec: true,
      directorPlan: true,
    },
  });
  if (!brief) throw new Error("Brief 不存在");

  /// Unified-input / DirectorPlan 管线：有 directorPlan 就用 segmentPlan 直发 Seedance
  ///（含 15s 单段；旧 Sunny Shutter / ScenePlan brief 无 directorPlan，仍走下方 legacy 路径）
  if (brief.directorPlan != null) {
    const storyboardReferences = await requireApprovedStoryboardForBrief(briefId);
    await db.videoBrief.update({
      where: { id: briefId },
      data: { referenceImageUrls: storyboardReferences },
    });
    return dispatchMultiSegmentGeneration(briefId);
  }
  return dispatchVideoGeneration(briefId);
}

/**
 * PART 4：多段视频生成 —— 基于 DirectorPlan.segmentPlan。
 *
 * 流程：
 * 1. 创建 FinalVideo 行（status=PENDING）
 * 2. 为每段创建 1 条 VideoJob（segmentIndex / segmentDurationSec / finalVideoId）
 * 3. 把每段 segmentPlan.seedancePrompt 直接发给 Seedance（不依赖 ScenePlan / VideoPrompt）
 * 4. 后续 reconcileVideoJob 在最后一段成功时触发 stitch（见 stitch-service）
 *
 * 幂等保护：
 * - 已经有 RUNNING 的多段任务时（finalVideoId 关联），不重新提交，直接 reconcile。
 */
export async function dispatchMultiSegmentGeneration(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
  });
  if (!brief) throw new Error("Brief 不存在");
  if (!brief.directorPlan) {
    throw new Error("Brief 尚未生成 DirectorPlan，无法分段生成");
  }
  const routeSnapshot = requiredVideoRouteSnapshot(brief);

  let plan: DirectorPlan;
  try {
    plan = parseDirectorPlan(brief.directorPlan);
  } catch (err) {
    throw new Error(`DirectorPlan 解析失败: ${(err as Error).message}`);
  }

  /// 幂等：已有同 brief 的多段 inflight job → reconcile 后返回
  const inflightExisting = await db.videoJob.findMany({
    where: {
      videoBriefId: briefId,
      finalVideoId: { not: null },
      OR: [
        { status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] } },
        {
          submissionState: {
            in: [
              ProviderSubmissionState.SUBMITTING,
              ProviderSubmissionState.ACK_UNKNOWN,
            ],
          },
        },
      ],
    },
  });
  if (inflightExisting.length > 0) {
    await reconcileBriefRenderStatus(briefId);
    return inflightExisting;
  }

  /// 创建（或重置）FinalVideo
  let finalVideoId = brief.finalVideoId;
  if (finalVideoId) {
    /// 旧 FinalVideo 重置为 PENDING（重新生成场景）
    await db.finalVideo.update({
      where: { id: finalVideoId },
      data: {
        status: FinalVideoStatus.PENDING,
        stitchedVideoUrl: null,
        thumbnailUrl: null,
        ffmpegError: null,
        stitchAttemptToken: null,
        startedAt: null,
        finishedAt: null,
        segmentCount: plan.segmentPlan.length,
        targetDurationSec: brief.targetDurationSec,
      },
    });
  } else {
    const finalVideo = await db.finalVideo.create({
      data: {
        targetDurationSec: brief.targetDurationSec,
        segmentCount: plan.segmentPlan.length,
        status: FinalVideoStatus.PENDING,
      },
    });
    finalVideoId = finalVideo.id;
    await db.videoBrief.update({
      where: { id: briefId },
      data: { finalVideoId },
    });
  }

  await db.videoBrief.update({
    where: { id: briefId },
    data: {
      status: VideoBriefStatus.RENDER_QUEUED,
      errorMessage: null,
    },
  });

  /// 把上次该 brief 残留的孤立 QUEUED/RUNNING（externalJobId 为空）→ CANCELLED
  await db.videoJob.updateMany({
    where: {
      videoBriefId: briefId,
      status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] },
      externalJobId: null,
      submissionState: ProviderSubmissionState.NOT_STARTED,
    },
    data: { status: VideoJobStatus.CANCELLED },
  });

  /// 产品/参考图以 Seedance 2.0 Omni-Reference 模式随每段下发（跨镜头产品一致性锚）。
  /// 同行靠「产品板」图片锚定产品外观；我们等价传用户上传的产品/实景图。
  /// Seedance 2 Omni-Reference 上限 9 张，留 1 张余量传 8 张——客户给的真实素材越多越贴。
  const referenceImageUrls = (brief.referenceImageUrls ?? []).slice(0, 8);

  const created: Awaited<ReturnType<typeof submitSegmentJob>>[] = [];
  for (const segment of plan.segmentPlan) {
    const result = await submitSegmentJob({
      briefId,
      finalVideoId,
      aspectRatio: brief.aspectRatio,
      segment,
      segmentCount: plan.segmentPlan.length,
      referenceImageUrls,
      routeSnapshot,
    });
    created.push(result);
  }

  await syncBriefStatus(briefId);
  return created;
}

async function submitSegmentJob(params: {
  briefId: string;
  finalVideoId: string;
  aspectRatio: string;
  segment: SegmentPlan;
  segmentCount: number;
  /// 产品参考图（Omni-Reference 模式传给 Seedance 2.0，产品外观跨镜头一致）
  referenceImageUrls?: string[];
  routeSnapshot: VideoRouteSnapshot;
}) {
  const {
    briefId,
    finalVideoId,
    aspectRatio,
    segment,
    segmentCount,
    referenceImageUrls,
    routeSnapshot,
  } = params;
  const logicalJobKey = `${briefId}:segment:${segment.segmentIndex}`;
  const id = randomUUID();
  const providerRequestKey = `${id}:attempt:1`;
  const submittedAt = new Date();
  let job;
  try {
    job = await db.videoJob.create({
      data: {
        id,
        logicalJobKey,
        providerRequestKey,
        submissionState: ProviderSubmissionState.SUBMITTING,
        submitAttempts: 1,
        submittedAt,
        timeoutAt: new Date(submittedAt.getTime() + deadlineMs()),
        videoBriefId: briefId,
        /// provider 必须与不可变路线快照一致（poll 侧有一致性硬校验）；
        /// mock 演练线路的段任务持久化为 MOCK，与 batch-service 同规则。
        provider:
          routeSnapshot.videoRouteSnapshot === "mock"
            ? VideoProvider.MOCK
            : VideoProvider.SEEDANCE_T2V,
        status: VideoJobStatus.RUNNING,
        segmentIndex: segment.segmentIndex,
        segmentDurationSec: segment.durationSec,
        finalVideoId,
        ...routeSnapshot,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await db.videoJob.findUnique({ where: { logicalJobKey } });
    if (!existing) throw error;
    return existing;
  }

  let providerAcknowledged = false;
  try {
    const hasRefs = (referenceImageUrls?.length ?? 0) > 0;
    const { jobId } = await submitVideoJob(
      {
        providerRequestKey,
        prompt: segment.seedancePrompt,
        durationSec: segment.durationSec,
        aspectRatio,
        model: routeSnapshot.videoModelSnapshot,
        /// 有产品图 → Omni-Reference 模式（产品外观锚定）；无图 → 纯 T2V
        referenceImages: hasRefs
          ? referenceImageUrls?.map((url) => ({ url, role: "content" as const }))
          : undefined,
        referenceMode: hasRefs ? "reference" : undefined,
        /// 质量对齐：显式要求 1080p（Seedance 2.0 默认更低档位）
        resolution: "1080p",
        mockHints: {
          briefId,
          segmentIndex: segment.segmentIndex,
          segmentCount,
          durationSec: segment.durationSec,
          aspectRatio,
          purpose: segment.role,
        },
      },
      routeSnapshot,
    );
    providerAcknowledged = true;
    logStatusTransition({
      taskId: job.id,
      from: VideoJobStatus.RUNNING,
      to: VideoJobStatus.RUNNING,
      reason: `submitted (external=${jobId})`,
    });
    return await persistAcceptedSubmission({
      jobId: job.id,
      providerRequestKey,
      externalJobId: jobId,
      submittedAt,
    });
  } catch (err) {
    logStatusTransition({
      taskId: job.id,
      from: VideoJobStatus.RUNNING,
      to: VideoJobStatus.FAILED,
      reason: providerAcknowledged
        ? "submit_ack_persistence_unknown"
        : "submit_ack_unknown",
    });
    return failDirectSubmission({
      jobId: job.id,
      providerRequestKey,
      error: err,
      providerAcknowledged,
      providerId: routeSnapshot.videoRouteSnapshot,
    });
  }
}

/**
 * 触发一个 VideoBrief 的视频生成：把每个 scene 的 prompt 提交成一个 VideoJob。
 * 第一个 scene 若包含 I2V 参考图，会先经过抠图预处理。
 *
 * 幂等保护：
 * - 如果该 brief 已经存在 RUNNING 且 externalJobId 非空的 VideoJob，
 *   不再向 Provider 提交新任务，避免重复扣费；调用方应优先调 reconcileBriefRenderStatus。
 */
export async function dispatchVideoGeneration(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    include: {
      scripts: { where: { isCurrent: true }, take: 1 },
    },
  });
  if (!brief) throw new Error("Brief 不存在");
  const script = brief.scripts[0];
  if (!script) throw new Error("Brief 尚未有脚本");
  const briefRouteSnapshot = requiredVideoRouteSnapshot(brief);

  const scenes = await db.scenePlan.findMany({
    where: { scriptId: script.id },
    orderBy: { sceneIndex: "asc" },
    include: { videoPrompts: true },
  });
  if (scenes.length === 0) throw new Error("请先生成分镜/Prompt");

  const inflightExisting = await db.videoJob.findMany({
    where: {
      videoBriefId: briefId,
      OR: [
        { status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] } },
        {
          submissionState: {
            in: [
              ProviderSubmissionState.SUBMITTING,
              ProviderSubmissionState.ACK_UNKNOWN,
            ],
          },
        },
      ],
    },
  });
  if (inflightExisting.length > 0) {
    /// 已经有付费在跑的 Provider 任务 → 不重新提交，直接调和现有状态后返回
    await reconcileBriefRenderStatus(briefId);
    return inflightExisting;
  }

  await db.videoBrief.update({
    where: { id: briefId },
    data: { status: VideoBriefStatus.RENDER_QUEUED, errorMessage: null },
  });

  const processed = brief.referenceImageUrls?.length
    ? (await processReferenceImages(brief.referenceImageUrls)).map((p) => p.url)
    : [];

  /// 没有 externalJobId 的孤立 QUEUED/RUNNING（可能上次提交失败但残留）→ 标 CANCELLED
  await db.videoJob.updateMany({
    where: {
      videoBriefId: briefId,
      status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] },
      externalJobId: null,
      submissionState: ProviderSubmissionState.NOT_STARTED,
    },
    data: { status: VideoJobStatus.CANCELLED },
  });

  const created = await Promise.all(
    scenes.map(async (scene) => {
      const prompt = scene.videoPrompts[0];
      if (!prompt) throw new Error(`Scene #${scene.sceneIndex} 没有 prompt`);
      const logicalJobKey = `${briefId}:scene:${scene.id}`;
      const id = randomUUID();
      const providerRequestKey = `${id}:attempt:1`;
      const submittedAt = new Date();
      const routeSnapshot: VideoRouteSnapshot =
        briefRouteSnapshot.videoProviderAdapterSnapshot === "byteplus" &&
        prompt.provider === VideoProvider.SEEDANCE_I2V &&
        I2V_MODEL_OVERRIDE
          ? {
              ...briefRouteSnapshot,
              videoModelSnapshot: I2V_MODEL_OVERRIDE,
            }
          : briefRouteSnapshot;
      let job;
      try {
        job = await db.videoJob.create({
          data: {
            id,
            logicalJobKey,
            providerRequestKey,
            submissionState: ProviderSubmissionState.SUBMITTING,
            submitAttempts: 1,
            submittedAt,
            timeoutAt: new Date(submittedAt.getTime() + deadlineMs()),
            videoBriefId: briefId,
            provider:
              routeSnapshot.videoRouteSnapshot === "mock"
                ? VideoProvider.MOCK
                : prompt.provider,
            status: VideoJobStatus.RUNNING,
            ...routeSnapshot,
          },
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const existing = await db.videoJob.findUnique({
          where: { logicalJobKey },
        });
        if (!existing) throw error;
        return existing;
      }

      let providerAcknowledged = false;
      try {
        const ratio =
          (prompt.params as { ratio?: string } | null)?.ratio ?? brief.aspectRatio;
        const { jobId } = await submitVideoJob(
          {
            providerRequestKey,
            prompt: prompt.promptText,
            referenceImages:
              prompt.provider === VideoProvider.SEEDANCE_I2V
                ? prompt.referenceImageUrl
                  ? [prompt.referenceImageUrl, ...processed.slice(1)].map(
                      (url) => ({ url, role: "content" as const }),
                    )
                  : processed.map((url) => ({ url, role: "content" as const }))
                : undefined,
            durationSec: scene.durationSec,
            aspectRatio: ratio,
            model: routeSnapshot.videoModelSnapshot,
            mockHints: {
              briefId,
              segmentIndex: scene.sceneIndex,
              segmentCount: scenes.length,
              durationSec: scene.durationSec,
              aspectRatio: ratio,
              purpose: "scene",
            },
          },
          routeSnapshot,
        );
        providerAcknowledged = true;
        return await persistAcceptedSubmission({
          jobId: job.id,
          providerRequestKey,
          externalJobId: jobId,
          submittedAt,
        });
      } catch (err) {
        return failDirectSubmission({
          jobId: job.id,
          providerRequestKey,
          error: err,
          providerAcknowledged,
          providerId: routeSnapshot.videoRouteSnapshot,
        });
      }
    }),
  );

  await syncBriefStatus(briefId);
  return created;
}

/**
 * 调和单个 VideoJob 的 Provider 状态。
 * - 调用方负责处理批量、聚合到 brief 状态。
 * - 容错：Provider 查询失败时不会把 job 直接判 FAILED，
 *   而是累加 pollErrors，超过阈值才下线。
 *
 * Watchdog 双信号内联（INV-1/INV-2 等价物，2026-07 事故加固）：
 *   信号 A（硬超时）在调 Provider **之前**判定 —— 即使 Provider 悬挂也能终态化；
 *   信号 B（provider 僵死）在拿到 Provider 响应后判定。
 * 两个信号都走 CAS（仍在 RUNNING/QUEUED 才写 FAILED，INV-6 幂等），
 * 并记录结构化状态迁移日志（AC-5）。
 */
export async function reconcileVideoJob(jobId: string) {
  const job = await db.videoJob.findUnique({ where: { id: jobId } });
  if (!job) return null;
  if (!job.externalJobId) return job;
  if (
    job.status !== VideoJobStatus.RUNNING &&
    job.status !== VideoJobStatus.QUEUED
  ) {
    return job;
  }

  /// GATE0-6：历史隔离任务既不能轮询 Provider，也不能被 watchdog
  /// 先改成 FAILED 后从 retry 路径绕过。必须先由人工 RELEASED/EXPIRED。
  if (isHistoricalDispatchQuarantined(job)) return job;

  const now = new Date();

  /// ---- 信号 A：硬超时（不依赖 Provider 可达性） ----
  if (isPastHardDeadline(job, now)) {
    const failed = await failJobIdempotent(job, {
      reason: "timeout",
      errorMessage: `${WATCHDOG_TIMEOUT_PREFIX} 超过全局 deadline（timeoutAt=${job.timeoutAt?.toISOString()} + ${watchdogGraceMin()}min 宽限）仍未终态`,
      userSafeError: WATCHDOG_TIMEOUT_USER_ERROR,
      now,
    });
    if (failed) return failed;
    return db.videoJob.findUnique({ where: { id: jobId } });
  }

  let result: DirectProviderStatus;
  try {
    result = await fetchVideoJobStatus({
      provider: job.provider,
      externalJobId: job.externalJobId,
      videoRouteSnapshot: job.videoRouteSnapshot,
      videoModelSnapshot: job.videoModelSnapshot,
      videoProviderAdapterSnapshot: job.videoProviderAdapterSnapshot,
    });
  } catch (err) {
    if (err instanceof HistoricalVideoRouteUnknownError) {
      logStatusTransition({
        taskId: job.id,
        from: job.status,
        to: VideoJobStatus.FAILED,
        reason: "historical_route_snapshot_missing_no_provider_call",
      });
      await db.videoJob.updateMany({
        where: {
          id: job.id,
          status: { in: [VideoJobStatus.RUNNING, VideoJobStatus.QUEUED] },
        },
        data: {
          status: VideoJobStatus.FAILED,
          submissionErrorClass: "historical_route_snapshot_missing",
          errorMessage: `[provider:route_unknown] ${err.message}`,
          userSafeError:
            "该历史任务缺少生成线路记录，系统已停止自动查询以避免跨线路误操作。请联系管理员对账。",
          finishedAt: new Date(),
          lastCheckedAt: new Date(),
        },
      });
      return db.videoJob.findUnique({ where: { id: jobId } });
    }
    const newErrors = (job.pollErrors ?? 0) + 1;
    const exceeded = newErrors >= POLL_ERROR_THRESHOLD;
    if (exceeded) {
      logStatusTransition({
        taskId: job.id,
        from: job.status,
        to: VideoJobStatus.FAILED,
        reason: `poll_errors_exceeded (#${newErrors}): ${(err as Error).message}`,
      });
    }
    return db.videoJob.update({
      where: { id: jobId },
      data: {
        pollErrors: newErrors,
        lastCheckedAt: new Date(),
        errorMessage: `轮询异常 (#${newErrors}): ${(err as Error).message}`,
        ...(exceeded
          ? {
              status: VideoJobStatus.FAILED,
              userSafeError:
                "我们暂时无法获取生成进度，请稍后点击「刷新状态」或「重试」。",
              finishedAt: new Date(),
            }
          : {}),
      },
    });
  }

  if (result.status === "completed") {
    /// 发片前自动 QA 门禁：抽帧 + 画面文字/错字检测。
    /// 检出烧录字幕/畸形字形 → 该段直接判 FAILED，走既有单段重试闭环，
    /// 废段永远到不了 stitch / 成片库。门禁自身异常一律 fail-open 不阻塞。
    if (result.videoUrl && job.provider !== VideoProvider.MOCK) {
      const qa = await runFrameTextQa(result.videoUrl);
      if (!qa.ok) {
        logStatusTransition({
          taskId: job.id,
          from: job.status,
          to: VideoJobStatus.FAILED,
          reason: `frame_qa_rejected: ${qa.summary}`,
        });
        /// CAS：仍在 RUNNING/QUEUED 才写终态（INV-6）
        await db.videoJob.updateMany({
          where: {
            id: jobId,
            status: { in: [VideoJobStatus.RUNNING, VideoJobStatus.QUEUED] },
          },
          data: {
            status: VideoJobStatus.FAILED,
            outputVideoUrl: result.videoUrl,
            outputThumbUrl: result.thumbnailUrl ?? null,
            errorMessage: `${FRAME_QA_ERROR_PREFIX} ${qa.summary}`,
            userSafeError:
              "画面质检未通过（检测到异常文字），已自动拦截。点击「重试」可重新生成本段。",
            finishedAt: new Date(),
            lastCheckedAt: new Date(),
            lastProviderStatus: result.rawProviderStatus,
            pollErrors: 0,
          },
        });
        return db.videoJob.findUnique({ where: { id: jobId } });
      }
      if (!qa.checked) {
        console.warn(`[frame-qa] job ${jobId} 门禁跳过: ${qa.skipReason}`);
      }
    }

    logStatusTransition({
      taskId: job.id,
      from: job.status,
      to: VideoJobStatus.SUCCEEDED,
      reason: `provider_completed (${result.rawProviderStatus})`,
    });
    /// CAS 成功迁移（INV-6：并发的另一次 reconcile 已写终态时这里 count=0，不覆盖）
    const succeeded = await db.videoJob.updateMany({
      where: {
        id: jobId,
        status: { in: [VideoJobStatus.RUNNING, VideoJobStatus.QUEUED] },
      },
      data: {
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl: result.videoUrl ?? null,
        outputThumbUrl: result.thumbnailUrl ?? null,
        finishedAt: new Date(),
        lastCheckedAt: new Date(),
        lastProviderStatus: result.rawProviderStatus,
        pollErrors: 0,
      },
    });
    const updated = await db.videoJob.findUnique({ where: { id: jobId } });
    /// 多段流的 fast-path：本段成功且是该 brief 最后一段时立即触发 stitch（无需等下一轮 cron）
    if (succeeded.count > 0 && updated?.finalVideoId) {
      await maybeTriggerStitch(updated.finalVideoId);
    }
    return updated;
  }

  if (result.status === "failed") {
    logStatusTransition({
      taskId: job.id,
      from: job.status,
      to: VideoJobStatus.FAILED,
      reason: `provider_failed (${result.rawProviderStatus}): ${result.errorMessage ?? ""}`,
    });
    await db.videoJob.updateMany({
      where: {
        id: jobId,
        status: { in: [VideoJobStatus.RUNNING, VideoJobStatus.QUEUED] },
      },
      data: {
        status: VideoJobStatus.FAILED,
        errorMessage: `[provider:failed] ${result.errorMessage ?? "视频生成 Provider 返回失败"}`,
        userSafeError: friendlyProviderError(
          result.rawProviderStatus,
          result.errorMessage,
        ),
        finishedAt: new Date(),
        lastCheckedAt: new Date(),
        lastProviderStatus: result.rawProviderStatus,
        pollErrors: 0,
      },
    });
    return db.videoJob.findUnique({ where: { id: jobId } });
  }

  /// ---- 信号 B：provider 僵死（status 仍 running/pending 但 updated_at 从未推进） ----
  const stall = detectProviderStall(result, now);
  if (stall.stalled) {
    const failed = await failJobIdempotent(job, {
      reason: "provider_stalled",
      errorMessage: `${WATCHDOG_STALLED_PREFIX} ${stall.detail}`,
      userSafeError: WATCHDOG_STALLED_USER_ERROR,
      now,
      snapshot: result.rawProviderResponse,
      lastProviderStatus: result.rawProviderStatus,
    });
    if (failed) return failed;
    return db.videoJob.findUnique({ where: { id: jobId } });
  }

  /// 仍在 pending / processing —— 只更新观察字段（含 provider 真实进度，INV-5）
  return db.videoJob.update({
    where: { id: jobId },
    data: {
      lastCheckedAt: new Date(),
      lastProviderStatus: result.rawProviderStatus,
      pollErrors: 0,
      ...(typeof result.progress === "number"
        ? { lastProgress: Math.max(0, Math.min(100, Math.round(result.progress))) }
        : {}),
    },
  });
}

/**
 * watchdog 终态化的统一出口：CAS 写 FAILED（仍在 RUNNING/QUEUED 才写，INV-6），
 * 并输出结构化状态迁移日志（AC-5，provider 僵死时附原始响应快照）。
 * 返回更新后的 job；CAS 落空（已被并发路径终态化）返回 null。
 */
async function failJobIdempotent(
  job: { id: string; status: VideoJobStatus; videoBriefId: string | null },
  opts: {
    reason: "timeout" | "provider_stalled";
    errorMessage: string;
    userSafeError: string;
    now: Date;
    snapshot?: unknown;
    lastProviderStatus?: string;
  },
) {
  const updated = await db.videoJob.updateMany({
    where: {
      id: job.id,
      status: { in: [VideoJobStatus.RUNNING, VideoJobStatus.QUEUED] },
    },
    data: {
      status: VideoJobStatus.FAILED,
      errorMessage: opts.errorMessage,
      userSafeError: opts.userSafeError,
      finishedAt: opts.now,
      lastCheckedAt: opts.now,
      ...(opts.lastProviderStatus
        ? { lastProviderStatus: opts.lastProviderStatus }
        : {}),
    },
  });
  if (updated.count === 0) return null;
  logStatusTransition({
    taskId: job.id,
    from: job.status,
    to: VideoJobStatus.FAILED,
    reason: opts.reason,
    snapshot: opts.snapshot,
  });
  return db.videoJob.findUnique({ where: { id: job.id } });
}

/**
 * 调和单个 brief 的全部在飞 job，并把状态聚合回 VideoBrief。
 * UI 的「刷新状态」按钮调用这个。
 */
export async function reconcileBriefRenderStatus(briefId: string) {
  const inflight = await db.videoJob.findMany({
    where: {
      videoBriefId: briefId,
      status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] },
      externalJobId: { not: null },
    },
  });
  for (const job of inflight) {
    await reconcileVideoJob(job.id);
  }
  await syncBriefStatus(briefId);

  /// 兜底：HMR 后 maybeTriggerStitch 可能已在单段 reconcile 时错过，此处再试一次 stitch
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    select: { finalVideoId: true },
  });
  if (brief?.finalVideoId) {
    await maybeTriggerStitch(brief.finalVideoId);
    await syncBriefStatus(briefId);
  }

  return summarizeBriefRender(briefId);
}

/**
 * 重新提交单个失败的 VideoJob（保留同一 scene/prompt，避免影响其它 scene）。
 * - 提交前会再去 Provider 查一次最新状态；如果其实已经成功，则直接修正 DB，不重复提交。
 * - 防止用户在「失败」状态下点重试时，意外发起多次付费。
 */
export async function retryFailedVideoJob(jobId: string) {
  const job = await db.videoJob.findUnique({
    where: { id: jobId },
    include: { videoBrief: true },
  });
  if (!job) throw new Error("VideoJob 不存在");
  if (job.status !== VideoJobStatus.FAILED) {
    throw new Error("只允许重试已失败的视频任务");
  }
  if (!job.videoBriefId) {
    throw new Error("批量 VideoJob 请使用 batch retry 接口");
  }
  if (isHistoricalDispatchQuarantined(job)) {
    throw new Error("历史任务仍处于派发隔离栏，请先由管理员显式放行");
  }
  if (
    job.submissionState === ProviderSubmissionState.SUBMITTING ||
    job.submissionState === ProviderSubmissionState.ACK_UNKNOWN
  ) {
    throw new SubmissionReconciliationRequiredError();
  }
  const jobRouteSnapshot = requiredJobVideoRouteSnapshot(job);
  const videoBriefId = job.videoBriefId;

  /// frame-qa 拦截的段：Provider 端是 completed，但产物已被判废 →
  /// 跳过下方「查状态发现已成功就直接翻回 SUCCEEDED」的捷径，必须重新生成
  const failedByFrameQa = !!job.errorMessage?.startsWith(FRAME_QA_ERROR_PREFIX);
  let providerConfirmedFailed = failedByFrameQa;

  /// 双保险：如果 externalJobId 还在，先去查一遍真实状态
  if (job.externalJobId && !failedByFrameQa) {
    try {
      const r = await fetchVideoJobStatus({
        provider: job.provider,
        externalJobId: job.externalJobId,
        videoRouteSnapshot: job.videoRouteSnapshot,
        videoModelSnapshot: job.videoModelSnapshot,
        videoProviderAdapterSnapshot: job.videoProviderAdapterSnapshot,
      });
      if (r.status === "completed") {
        logStatusTransition({
          taskId: job.id,
          from: job.status,
          to: VideoJobStatus.SUCCEEDED,
          reason: "retry_found_provider_completed（不重复扣费）",
        });
        return db.videoJob.update({
          where: { id: job.id },
          data: {
            status: VideoJobStatus.SUCCEEDED,
            outputVideoUrl: r.videoUrl ?? null,
            outputThumbUrl: r.thumbnailUrl ?? null,
            errorMessage: null,
            userSafeError: null,
            finishedAt: new Date(),
            lastProviderStatus: r.rawProviderStatus,
          },
        });
      }
      if (r.status === "processing" || r.status === "pending") {
        /// Provider 还在跑 → 把 DB 状态恢复成 RUNNING，不重复扣费
        logStatusTransition({
          taskId: job.id,
          from: job.status,
          to: VideoJobStatus.RUNNING,
          reason: "retry_found_provider_still_running（不重复扣费）",
        });
        return db.videoJob.update({
          where: { id: job.id },
          data: {
            status: VideoJobStatus.RUNNING,
            errorMessage: null,
            userSafeError: null,
            finishedAt: null,
            lastProviderStatus: r.rawProviderStatus,
          },
        });
      }
      if (r.status === "failed") {
        providerConfirmedFailed = true;
        await db.videoJob.updateMany({
          where: { id: job.id, status: VideoJobStatus.FAILED },
          data: { lastProviderStatus: r.rawProviderStatus },
        });
      }
    } catch (error) {
      await db.videoJob.updateMany({
        where: {
          id: job.id,
          status: VideoJobStatus.FAILED,
          submissionState: job.submissionState,
        },
        data: {
          submissionState: ProviderSubmissionState.ACK_UNKNOWN,
          submissionErrorClass: "status_lookup_ack_unknown",
          errorMessage: `[provider:status_unknown] ${(error as Error).message}`,
          userSafeError:
            "暂时无法确认生成服务是否已完成该任务。为避免重复计费，系统不会自动重提，请联系管理员核对。",
        },
      });
      throw new SubmissionReconciliationRequiredError();
    }
  }

  const safeWithoutExternalId =
    !job.externalJobId &&
    (job.submissionState === ProviderSubmissionState.REJECTED ||
      (job.submissionState === ProviderSubmissionState.NOT_STARTED &&
        job.submitAttempts === 0));
  if (!providerConfirmedFailed && !safeWithoutExternalId) {
    throw new SubmissionReconciliationRequiredError();
  }

  /// Provider 端确认失败 / 不存在 → 重新提交
  /// 多段流：优先用 directorPlan.segmentPlan 的对应段（防双重计费的关键 — 只重试该段）
  if (job.segmentIndex != null && job.finalVideoId) {
    const briefForRetry = await db.videoBrief.findUnique({
      where: { id: videoBriefId },
      select: { aspectRatio: true, directorPlan: true, referenceImageUrls: true },
    });
    if (!briefForRetry?.directorPlan) {
      throw new Error("Brief 缺少 DirectorPlan，无法重试该段");
    }
    let plan: DirectorPlan;
    try {
      plan = parseDirectorPlan(briefForRetry.directorPlan);
    } catch (err) {
      throw new Error(`DirectorPlan 解析失败: ${(err as Error).message}`);
    }
    const segment = plan.segmentPlan.find(
      (s) => s.segmentIndex === job.segmentIndex,
    );
    if (!segment) {
      throw new Error(`找不到 segmentIndex=${job.segmentIndex} 的段计划`);
    }

    /// 与首次 dispatch 完全同参：参考图 Omni-Reference + 1080p。
    /// 此前重试丢失这两项 → 重试段产品外观漂移、分辨率降档，成片段间质量不一致。
    const retryRefs = (briefForRetry.referenceImageUrls ?? []).slice(0, 8);
    const retryHasRefs = retryRefs.length > 0;

    const { submittedAt, providerRequestKey } =
      await claimFailedJobForRetry(job);
    let providerAcknowledged = false;
    try {
      const { jobId: newExternalId } = await submitVideoJob(
        {
          providerRequestKey,
          prompt: segment.seedancePrompt,
          durationSec: segment.durationSec,
          aspectRatio: briefForRetry.aspectRatio,
          model: jobRouteSnapshot.videoModelSnapshot,
          referenceImages: retryHasRefs
            ? retryRefs.map((url) => ({ url, role: "content" as const }))
            : undefined,
          referenceMode: retryHasRefs ? "reference" : undefined,
          resolution: "1080p",
          mockHints: {
            briefId: videoBriefId,
            segmentIndex: segment.segmentIndex,
            segmentCount: plan.segmentPlan.length,
            durationSec: segment.durationSec,
            aspectRatio: briefForRetry.aspectRatio,
            purpose: segment.role,
          },
        },
        jobRouteSnapshot,
      );
      providerAcknowledged = true;
      logStatusTransition({
        taskId: job.id,
        from: job.status,
        to: VideoJobStatus.RUNNING,
        reason: `retry_resubmitted (external=${newExternalId}, attempt=${(job.retryCount ?? 0) + 1})`,
      });
      const updated = await persistAcceptedSubmission({
        jobId: job.id,
        providerRequestKey,
        externalJobId: newExternalId,
        submittedAt,
        retryCount: (job.retryCount ?? 0) + 1,
      });
      /// 重置 FinalVideo 状态，避免还在 FAILED 卡住拼接重试
      await db.finalVideo.update({
        where: { id: job.finalVideoId },
        data: {
          status: FinalVideoStatus.PENDING,
          ffmpegError: null,
          stitchAttemptToken: null,
        },
      });
      return updated;
    } catch (err) {
      return failDirectSubmission({
        jobId: job.id,
        providerRequestKey,
        error: err,
        providerAcknowledged,
        providerId: jobRouteSnapshot.videoRouteSnapshot,
      });
    }
  }

  /// 单段流（旧路径，含 Sunny Shutter）：从 ScenePlan/VideoPrompt 重新读取并提交
  const scene = await db.scenePlan.findFirst({
    where: { script: { videoBriefId } },
    include: { videoPrompts: true },
    orderBy: { sceneIndex: "asc" },
  });
  if (!scene) throw new Error("找不到对应的 scene plan，无法重试");
  const prompt = scene.videoPrompts[0];
  if (!prompt) throw new Error("找不到对应的 prompt，无法重试");

  const { submittedAt, providerRequestKey } =
    await claimFailedJobForRetry(job);
  let providerAcknowledged = false;
  try {
    const ratio = (prompt.params as { ratio?: string } | null)?.ratio;
    const briefForRefs = await db.videoBrief.findUnique({
      where: { id: videoBriefId },
      select: { referenceImageUrls: true },
    });
    const processed = briefForRefs?.referenceImageUrls?.length
      ? (await processReferenceImages(briefForRefs.referenceImageUrls)).map(
          (p) => p.url,
        )
      : [];
    const { jobId: newExternalId } = await submitVideoJob(
      {
        providerRequestKey,
        prompt: prompt.promptText,
        referenceImages:
          prompt.provider === VideoProvider.SEEDANCE_I2V
            ? prompt.referenceImageUrl
              ? [prompt.referenceImageUrl, ...processed.slice(1)].map((url) => ({
                  url,
                  role: "content" as const,
                }))
              : processed.map((url) => ({ url, role: "content" as const }))
            : undefined,
        durationSec: scene.durationSec,
        aspectRatio: ratio,
        model: jobRouteSnapshot.videoModelSnapshot,
        mockHints: {
          briefId: videoBriefId,
          segmentIndex: scene.sceneIndex,
          segmentCount: 1,
          durationSec: scene.durationSec,
          aspectRatio: ratio ?? "9:16",
          purpose: "scene-retry",
        },
      },
      jobRouteSnapshot,
    );
    providerAcknowledged = true;
    logStatusTransition({
      taskId: job.id,
      from: job.status,
      to: VideoJobStatus.RUNNING,
      reason: `retry_resubmitted_legacy (external=${newExternalId}, attempt=${(job.retryCount ?? 0) + 1})`,
    });
    return persistAcceptedSubmission({
      jobId: job.id,
      providerRequestKey,
      externalJobId: newExternalId,
      submittedAt,
      retryCount: (job.retryCount ?? 0) + 1,
    });
  } catch (err) {
    return failDirectSubmission({
      jobId: job.id,
      providerRequestKey,
      error: err,
      providerAcknowledged,
      providerId: jobRouteSnapshot.videoRouteSnapshot,
    });
  }
}

/**
 * Fast-path：当一段刚成功时，检查是否所有段都成功 → 立即触发 stitch。
 * 不直接 import stitch-service 避免循环；用动态 import。
 */
async function maybeTriggerStitch(finalVideoId: string): Promise<void> {
  const fv = await db.finalVideo.findUnique({
    where: { id: finalVideoId },
    include: {
      segments: { select: { status: true } },
    },
  });
  if (!fv) return;
  if (fv.status !== FinalVideoStatus.PENDING) return;
  const allDone =
    fv.segments.length === fv.segmentCount &&
    fv.segments.every((s) => s.status === VideoJobStatus.SUCCEEDED);
  if (!allDone) return;
  try {
    const { stitchFinalVideo } = await import("./stitch-service");
    await stitchFinalVideo(finalVideoId);
  } catch (err) {
    console.warn(
      "[video-service] inline stitch trigger failed, will rely on cron",
      (err as Error).message,
    );
  }
}

/**
 * 段感知重试：只重提同 finalVideo 的 FAILED 段，不动其它段。
 * UI 的「重试失败片段」按钮调这个。
 */
export async function retryFailedSegmentsForBrief(briefId: string) {
  const failed = await db.videoJob.findMany({
    where: {
      videoBriefId: briefId,
      status: VideoJobStatus.FAILED,
    },
    orderBy: { segmentIndex: "asc" },
  });
  if (failed.length === 0) return [];

  const results = [];
  for (const job of failed) {
    try {
      const updated = await retryFailedVideoJob(job.id);
      results.push({ jobId: job.id, ok: true, status: updated?.status });
    } catch (err) {
      results.push({
        jobId: job.id,
        ok: false,
        error: (err as Error).message,
      });
    }
  }
  await syncBriefStatus(briefId);
  return results;
}

/**
 * 轮询并更新所有 RUNNING 状态的 VideoJob。由 Vercel Cron 调用。
 */
export async function pollRunningJobs(limit = 30) {
  const running = await db.videoJob.findMany({
    where: {
      status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] },
      externalJobId: { not: null },
    },
    orderBy: { startedAt: "asc" },
    take: limit,
  });

  let updated = 0;
  const affectedBriefs = new Set<string>();
  for (const job of running) {
    const before = job.status;
    const after = await reconcileVideoJob(job.id);
    if (after && after.status !== before) {
      updated += 1;
      if (job.videoBriefId) affectedBriefs.add(job.videoBriefId);
    }
  }

  for (const id of affectedBriefs) {
    await syncBriefStatus(id);
  }
  return { polled: running.length, updated };
}

/**
 * 根据所有 scene 的 VideoJob 状态聚合成 Brief 级状态。
 *
 * 双流兼容：
 * - 多段流（brief.finalVideoId != null）：等所有段 SUCCEEDED → 触发 stitch；
 *   FinalVideo 状态机驱动 brief 状态。
 * - 旧单段流（brief.finalVideoId == null，含 Sunny Shutter）：
 *   首段 SUCCEEDED 即把 outputVideoUrl 写到 brief.finalVideoUrl，与改造前完全一致。
 *
 * 失败 / busy 行为对两条流都一样。
 */
export async function syncBriefStatus(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    select: { id: true, finalVideoId: true },
  });
  if (!brief) return;

  const jobs = await db.videoJob.findMany({
    where: { videoBriefId: briefId },
  });
  if (jobs.length === 0) return;

  const succeeded = jobs.filter((j) => j.status === VideoJobStatus.SUCCEEDED);
  const failed = jobs.filter((j) => j.status === VideoJobStatus.FAILED);
  const busy = jobs.filter(
    (j) => j.status === VideoJobStatus.QUEUED || j.status === VideoJobStatus.RUNNING,
  );

  if (busy.length > 0) {
    await db.videoBrief.update({
      where: { id: briefId },
      data: { status: VideoBriefStatus.RENDERING },
    });
    return;
  }

  if (failed.length > 0) {
    await db.videoBrief.update({
      where: { id: briefId },
      data: {
        status: VideoBriefStatus.RENDER_FAILED,
        errorMessage:
          failed[0]?.userSafeError ?? failed[0]?.errorMessage ?? "部分片段生成失败",
      },
    });
    return;
  }

  if (succeeded.length === 0) return;

  /// 多段流：通知 stitch
  if (brief.finalVideoId) {
    await onAllSegmentsSucceeded(brief.finalVideoId, briefId);
    return;
  }

  /// 单段流（旧路径，Sunny Shutter 兼容）
  const first = succeeded[0];
  await db.videoBrief.update({
    where: { id: briefId },
    data: {
      status: VideoBriefStatus.QA_PENDING,
      finalVideoUrl: first.outputVideoUrl,
      finalThumbnailUrl: first.outputThumbUrl,
    },
  });
  await ensureQAPendingStub(briefId);
}

/**
 * 多段流成片：所有段 SUCCEEDED 后调用。
 * - 把 FinalVideo 标记为 PENDING（待拼接 / cron 拾取）
 * - VideoBrief.status → RENDERING（语义：所有片段就绪，正在合成完整视频）
 * - 真正的 ffmpeg 拼接由 stitch-service 异步执行（cron 或显式触发）
 *
 * 这里之所以不直接同步拼接：ffmpeg 在 Vercel serverless 中可能跑较久，
 * 应放到独立 cron / 后台任务避免阻塞 reconcileVideoJob。
 */
async function onAllSegmentsSucceeded(finalVideoId: string, briefId: string) {
  /// 仅在 PENDING 状态下推进；STITCHING / READY / FAILED 不动
  await db.finalVideo.updateMany({
    where: { id: finalVideoId, status: FinalVideoStatus.PENDING },
    data: {
      /// 保持 PENDING 等 cron 拾取；UI 文案显示「正在合成完整视频」
      status: FinalVideoStatus.PENDING,
    },
  });
  /// brief 仍标 RENDERING（用户视角：「正在合成完整视频」）
  await db.videoBrief.update({
    where: { id: briefId },
    data: { status: VideoBriefStatus.RENDERING },
  });
}

/**
 * 把 brief 的渲染任务聚合成一份「用户/UI 友好」的进度对象。
 * 不包含 provider 名 / external id 这些内部细节（它们在 jobs[].debug 里）。
 */
export type BriefRenderSummary = {
  briefId: string;
  briefStatus: VideoBriefStatus;
  totalJobs: number;
  succeeded: number;
  running: number;
  queued: number;
  failed: number;
  cancelled: number;
  finalVideoUrl: string | null;
  finalThumbnailUrl: string | null;
  /// 任意一个仍在运行的 job 是否已经超过 timeoutAt
  hasStuckJob: boolean;
  /// 最近一次有效检查的时间
  lastCheckedAt: Date | null;
  /// 多段拼接信息（单段流为 null，与 Sunny Shutter 兼容）
  finalVideo: {
    id: string;
    status: FinalVideoStatus;
    targetDurationSec: number;
    segmentCount: number;
    segmentsCompleted: number;
    stitchedVideoUrl: string | null;
    thumbnailUrl: string | null;
    ffmpegError: string | null;
  } | null;
  jobs: Array<{
    id: string;
    sceneIndex?: number | null;
    segmentIndex: number | null;
    segmentDurationSec: number | null;
    status: VideoJobStatus;
    /// 用户安全的状态文本（不含 provider 名）
    userStatusKey: BriefRenderUserStatus;
    outputVideoUrl: string | null;
    outputThumbnailUrl: string | null;
    submittedAt: Date | null;
    lastCheckedAt: Date | null;
    finishedAt: Date | null;
    /// 友好错误（FAILED 时填）
    userSafeError: string | null;
    error: CustomerGenerationError | null;
    /// 是否已超时
    isStuck: boolean;
    /// debug 抽屉用 — 不要默认展示
    debug: {
      provider: VideoProvider;
      externalJobId: string | null;
      lastProviderStatus: string | null;
      adminError: string | null;
    };
  }>;
};

export type BriefRenderUserStatus =
  | "waiting"
  | "submitted"
  | "generating"
  | "ready"
  | "failed"
  | "stuck"
  | "cancelled";

export async function summarizeBriefRender(
  briefId: string,
): Promise<BriefRenderSummary> {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    select: {
      id: true,
      status: true,
      finalVideoUrl: true,
      finalThumbnailUrl: true,
      finalVideoId: true,
      finalVideo: true,
    },
  });
  if (!brief) throw new Error("Brief 不存在");
  const jobs = await db.videoJob.findMany({
    where: { videoBriefId: briefId },
    orderBy: [{ segmentIndex: "asc" }, { createdAt: "asc" }],
  });
  const now = Date.now();

  const counts = {
    succeeded: 0,
    running: 0,
    queued: 0,
    failed: 0,
    cancelled: 0,
  };
  let lastCheckedAt: Date | null = null;
  let hasStuckJob = false;

  const mapped = jobs.map((j) => {
    if (j.status === VideoJobStatus.SUCCEEDED) counts.succeeded++;
    else if (j.status === VideoJobStatus.RUNNING) counts.running++;
    else if (j.status === VideoJobStatus.QUEUED) counts.queued++;
    else if (j.status === VideoJobStatus.FAILED) counts.failed++;
    else if (j.status === VideoJobStatus.CANCELLED) counts.cancelled++;

    const isStuck =
      (j.status === VideoJobStatus.RUNNING ||
        j.status === VideoJobStatus.QUEUED) &&
      j.timeoutAt != null &&
      j.timeoutAt.getTime() < now;
    if (isStuck) hasStuckJob = true;

    if (j.lastCheckedAt && (!lastCheckedAt || j.lastCheckedAt > lastCheckedAt)) {
      lastCheckedAt = j.lastCheckedAt;
    }

    return {
      id: j.id,
      sceneIndex: null as number | null,
      segmentIndex: j.segmentIndex,
      segmentDurationSec: j.segmentDurationSec,
      status: j.status,
      userStatusKey: classifyUserStatus(j, isStuck),
      outputVideoUrl: j.outputVideoUrl,
      outputThumbnailUrl: j.outputThumbUrl,
      submittedAt: j.submittedAt ?? j.startedAt ?? j.createdAt,
      lastCheckedAt: j.lastCheckedAt,
      finishedAt: j.finishedAt,
      userSafeError: j.userSafeError ?? toUserSafeIfMissing(j.errorMessage),
      error: classifyCustomerGenerationError({
        status: j.status,
        submissionState: j.submissionState,
        submissionErrorClass: j.submissionErrorClass,
        errorMessage: j.errorMessage,
        userSafeError: j.userSafeError ?? toUserSafeIfMissing(j.errorMessage),
        isStuck,
      }),
      isStuck,
      debug: {
        provider: j.provider,
        externalJobId: j.externalJobId,
        lastProviderStatus: j.lastProviderStatus,
        adminError: j.errorMessage,
      },
    };
  });

  /// 多段拼接信息：仅当存在 FinalVideo（新流程）时填，旧 brief 留 null
  const finalVideo = brief.finalVideo
    ? {
        id: brief.finalVideo.id,
        status: brief.finalVideo.status,
        targetDurationSec: brief.finalVideo.targetDurationSec,
        segmentCount: brief.finalVideo.segmentCount,
        segmentsCompleted: jobs.filter(
          (j) =>
            j.finalVideoId === brief.finalVideoId &&
            j.status === VideoJobStatus.SUCCEEDED,
        ).length,
        stitchedVideoUrl: brief.finalVideo.stitchedVideoUrl,
        thumbnailUrl: brief.finalVideo.thumbnailUrl,
        ffmpegError: brief.finalVideo.ffmpegError,
      }
    : null;

  /// 用户视角的 final URL：优先 stitched（新流程），否则 brief.finalVideoUrl（旧流程，含 Sunny Shutter）
  const exposedFinalUrl =
    finalVideo?.stitchedVideoUrl ?? brief.finalVideoUrl ?? null;
  const exposedFinalThumb =
    finalVideo?.thumbnailUrl ?? brief.finalThumbnailUrl ?? null;

  return {
    briefId: brief.id,
    briefStatus: brief.status,
    totalJobs: jobs.length,
    succeeded: counts.succeeded,
    running: counts.running,
    queued: counts.queued,
    failed: counts.failed,
    cancelled: counts.cancelled,
    finalVideoUrl: exposedFinalUrl,
    finalThumbnailUrl: exposedFinalThumb,
    hasStuckJob,
    lastCheckedAt,
    finalVideo,
    jobs: mapped,
  };
}

export type CustomerBriefRenderSummary = Omit<
  BriefRenderSummary,
  "finalVideo" | "jobs"
> & {
  finalVideo: Omit<NonNullable<BriefRenderSummary["finalVideo"]>, "ffmpegError"> | null;
  jobs: Array<Omit<BriefRenderSummary["jobs"][number], "debug">>;
};

export function toCustomerBriefRenderSummary(
  summary: BriefRenderSummary,
): CustomerBriefRenderSummary {
  let finalVideo: CustomerBriefRenderSummary["finalVideo"] = null;
  if (summary.finalVideo) {
    const { ffmpegError, ...safe } = summary.finalVideo;
    void ffmpegError;
    finalVideo = safe;
  }
  return {
    ...summary,
    finalVideo,
    jobs: summary.jobs.map((job) => {
      const { debug, ...safe } = job;
      void debug;
      return safe;
    }),
  };
}

function classifyUserStatus(
  job: {
    status: VideoJobStatus;
    submittedAt: Date | null;
    startedAt: Date | null;
    externalJobId: string | null;
  },
  isStuck: boolean,
): BriefRenderUserStatus {
  if (job.status === VideoJobStatus.SUCCEEDED) return "ready";
  if (job.status === VideoJobStatus.FAILED) return "failed";
  if (job.status === VideoJobStatus.CANCELLED) return "cancelled";
  if (isStuck) return "stuck";
  if (job.status === VideoJobStatus.RUNNING) {
    return job.externalJobId ? "generating" : "submitted";
  }
  if (job.status === VideoJobStatus.QUEUED) return "waiting";
  return "waiting";
}

/// 内部 admin 错误转用户安全提示（兜底，遇到没显式 userSafeError 的旧 job）
function toUserSafeIfMissing(adminError: string | null): string | null {
  if (!adminError) return null;
  return friendlyProviderError("unknown", adminError);
}

function friendlySubmitError(adminMessage: string): string {
  if (adminMessage.includes("OPENAI_API_KEY") || adminMessage.includes("BYTEPLUS_ARK_API_KEY")) {
    return "视频生成服务暂未配置完成，请联系管理员检查 API 密钥。";
  }
  if (adminMessage.includes("rate") || adminMessage.includes("429")) {
    return "视频生成服务繁忙，请稍后再试。";
  }
  if (adminMessage.toLowerCase().includes("timeout")) {
    return "提交视频生成请求时超时，请点击「重试」。";
  }
  return "视频生成请求提交失败，请点击「重试」。如果反复失败请联系支持。";
}

function friendlyProviderError(
  rawStatus: string,
  message?: string | null,
): string {
  const lc = (message ?? "").toLowerCase();
  if (rawStatus === "expired" || lc.includes("expired")) {
    return "视频生成结果已过期，请点击「重试」重新生成。";
  }
  if (rawStatus === "cancelled" || rawStatus === "canceled") {
    return "视频生成已被取消，请点击「重试」重新生成。";
  }
  if (lc.includes("policy") || lc.includes("safety") || lc.includes("nsfw")) {
    return "提示词或参考图未通过内容安全审核，请调整脚本/参考图后重试。";
  }
  if (lc.includes("rate") || lc.includes("429")) {
    return "视频生成服务繁忙，请稍后点击「重试」。";
  }
  return "视频生成失败，请点击「重试」。如反复失败请联系支持。";
}

async function ensureQAPendingStub(briefId: string) {
  const existing = await db.qAReview.findFirst({
    where: { videoBriefId: briefId, status: "PENDING" },
  });
  if (existing) return;
  await db.qAReview.create({
    data: { videoBriefId: briefId, status: "PENDING" },
  });
}

/// 仅供测试导入
export const __test__ = {
  classifyUserStatus,
  friendlySubmitError,
  friendlyProviderError,
  classifyDirectSubmissionError,
  failDirectSubmission,
  persistAcceptedSubmission,
  claimFailedJobForRetry,
  submitSegmentJob,
  __setStatusFetcherForTests(
    fn: ((providerJobId: string) => Promise<DirectProviderStatus>) | null,
  ): void {
    statusFetcherOverride = fn;
  },
  __setSubmitterForTests(fn: DirectSubmitterOverride | null): void {
    submitterOverride = fn;
  },
};

/// 让 TypeScript 知道 Prisma 重导出（避免 unused import 报错）
type _Reexport = Prisma.VideoJobCreateInput;
void (null as unknown as _Reexport);
