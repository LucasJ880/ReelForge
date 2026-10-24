import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  ProviderSubmissionState,
  StoryboardApprovalPolicy,
  StoryboardFrameStatus,
  StoryboardRunStatus,
  type MediaAsset,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  fetchShuyuOutputImage,
  pollShuyuImageTask,
  submitShuyuImageTask,
} from "@/lib/providers/shuyu-image-provider";
import {
  createOwnedMediaAsset,
  resolveOwnedMediaAssets,
} from "@/lib/services/media-asset-service";
import {
  bumpRateLimit,
  hourlyWindowKey,
  RateLimitExceededError,
} from "@/lib/services/rate-limit-service";
import { getStorageProvider } from "@/lib/storage";
import { asProviderSubmissionError } from "@/lib/video-generation/providers/submission-error";

const STORYBOARD_LEASE_MS = 2 * 60_000;
const STORYBOARD_POLL_RETRY_MS = 20_000;
/// 帧停留在 SUBMITTING 的最长时长。单次提交只有一次目录查询 + 一次 POST，
/// 超过这个窗口只可能是进程在提交半途崩溃——提交结局不可知，按 ACK_UNKNOWN 终结。
const STORYBOARD_SUBMIT_STALL_MS = 10 * 60_000;
/// 用户能取消的状态：还在出帧，或出完等用户确认。APPROVED 已交给（或即将交给）
/// 派发，FAILED 已全部终态——两者都不会再产生出图费用，前端放弃即可。
const CANCELLABLE_STORYBOARD_STATUSES: StoryboardRunStatus[] = [
  StoryboardRunStatus.GENERATING,
  StoryboardRunStatus.AWAITING_APPROVAL,
];
/// 单帧重做上限（每帧 attempt 1 之后最多再重做 3 次）。批量自动重投自有更低上限。
const STORYBOARD_FRAME_MAX_REGENERATIONS = 3;
/// 用户直接发起的故事板创建 / 单帧重做，每小时上限（批量内部准备不计）。
const STORYBOARD_CREATE_PER_HOUR_DEFAULT = 10;
const STORYBOARD_FRAME_REGEN_PER_HOUR_DEFAULT = 30;
const STORYBOARD_CANCELLED_FRAME_MESSAGE =
  "这一轮已取消，此分镜没有提交生成，不产生费用。";

const storyboardInclude = {
  frames: {
    where: { isCurrent: true },
    include: { outputAsset: true },
    orderBy: { ordinal: "asc" as const },
  },
} as const;

type StoryboardRunRecord = Prisma.StoryboardRunGetPayload<{
  include: typeof storyboardInclude;
}>;

type StoryboardFrameRecord = Prisma.StoryboardFrameGetPayload<{
  include: {
    outputAsset: true;
    storyboardRun: { include: { frames: { where: { isCurrent: true } } } };
  };
}>;

export interface StoryboardFramePlan {
  ordinal: number;
  beat: string;
  prompt: string;
}

export interface CreateStoryboardRunInput {
  userId: string;
  idempotencyKey: string;
  prompt: string;
  durationSec: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  sourceAssetIds?: string[];
  approvalPolicy?: "MANUAL" | "AUTO";
  purpose?: string;
  /// 用户在创作台直接发起时为 true：新建 run 前按小时计数限流。
  /// 批量内部准备不传——一个批次不能把同一用户的单条创作锁住。
  userInitiated?: boolean;
}

export interface StoryboardRunView {
  id: string;
  status: string;
  approvalPolicy: string;
  durationSec: number;
  aspectRatio: string;
  approvedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  canApprove: boolean;
  /// 服务端是否接受取消（还在出帧 / 等确认，且没有交给视频派发）。
  canCancel: boolean;
  frames: Array<{
    id: string;
    ordinal: number;
    attempt: number;
    beat: string;
    prompt: string;
    status: string;
    imageUrl: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    canRegenerate: boolean;
  }>;
}

export interface ResumableStoryboardContext {
  prompt: string;
  durationSec: number;
  aspectRatio: string;
  sourceAssets: Array<{
    id: string;
    url: string;
    mimeType: string;
    width: number | null;
    height: number | null;
  }>;
}

interface StoryboardRuntimeDependencies {
  submitTask: typeof submitShuyuImageTask;
  pollTask: typeof pollShuyuImageTask;
  fetchOutput: typeof fetchShuyuOutputImage;
  storage: typeof getStorageProvider;
  createAsset: typeof createOwnedMediaAsset;
}

const defaultRuntime: StoryboardRuntimeDependencies = {
  submitTask: submitShuyuImageTask,
  pollTask: pollShuyuImageTask,
  fetchOutput: fetchShuyuOutputImage,
  storage: getStorageProvider,
  createAsset: createOwnedMediaAsset,
};
let runtimeOverride: Partial<StoryboardRuntimeDependencies> | null = null;
const runtime = (): StoryboardRuntimeDependencies => ({
  ...defaultRuntime,
  ...runtimeOverride,
});

export class StoryboardRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "StoryboardRequestError";
  }
}

class StoryboardLeaseLostError extends Error {
  constructor() {
    super("Storyboard frame lease was lost");
    this.name = "StoryboardLeaseLostError";
  }
}

export function storyboardFrameCountForDuration(durationSec: number): number {
  if (durationSec <= 15) return 4;
  return 5;
}

export function buildStoryboardFramePlans(input: {
  prompt: string;
  durationSec: number;
  aspectRatio: string;
}): StoryboardFramePlan[] {
  const count = storyboardFrameCountForDuration(input.durationSec);
  const beats = count === 4
    ? [
        "0–3s · immediate problem or desire hook",
        "3–7s · faithful product reveal",
        "7–11s · simple product demonstration and proof",
        "11–15s · resolved result with clean CTA-safe composition",
      ]
    : [
        "opening hook",
        "faithful product reveal",
        "first demonstration beat",
        "proof and resolved result",
        "clean CTA-safe closing composition",
      ];
  return beats.map((beat, ordinal) => ({
    ordinal,
    beat,
    prompt: [
      "Create one photorealistic commercial storyboard keyframe with GPT Image 2.",
      `STORY: ${input.prompt.trim()}`,
      `FRAME ${ordinal + 1}/${count}: ${beat}.`,
      `FORMAT: ${input.aspectRatio}. No text, subtitles, logos, watermark, split screen, or collage.`,
      "PRODUCT IDENTITY LOCK: reproduce the uploaded product exactly—same shape, construction, material, color, proportions, packaging, and hardware; do not invent or remove details.",
      "CONTINUITY LOCK: keep the same room, camera language, lighting direction, person identity, wardrobe, and product identity across every frame; change only the story beat and simple action.",
      "Use physically plausible hands, shadows, perspective, contact points, and product mechanics.",
    ].join("\n"),
  }));
}

export function storyboardRunView(run: StoryboardRunRecord): StoryboardRunView {
  const cancelled = run.status === StoryboardRunStatus.CANCELLED;
  const frames = [...run.frames]
    .filter((frame) => frame.isCurrent !== false)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((frame) => ({
      id: frame.id,
      ordinal: frame.ordinal,
      attempt: frame.attempt,
      beat: frame.beat,
      prompt: frame.prompt,
      status: String(frame.status),
      imageUrl: frame.outputAsset?.url ?? frame.outputUrl ?? null,
      errorCode: frame.errorCode ?? null,
      errorMessage: frame.errorMessage ?? null,
      // 已取消的一轮不再出帧：任何分镜都不能重做。
      canRegenerate: !cancelled && canRegenerateStoryboardFrame(frame),
    }));
  const allReady =
    frames.length === storyboardFrameCountForDuration(run.durationSec) &&
    frames.every((frame) => frame.status === StoryboardFrameStatus.SUCCEEDED);
  return {
    id: run.id,
    status: String(run.status),
    approvalPolicy: String(run.approvalPolicy),
    durationSec: run.durationSec,
    aspectRatio: run.aspectRatio,
    approvedAt: run.approvedAt?.toISOString() ?? null,
    errorCode: run.errorCode ?? null,
    errorMessage: run.errorMessage ?? null,
    canApprove:
      run.approvalPolicy === StoryboardApprovalPolicy.MANUAL &&
      run.status === StoryboardRunStatus.AWAITING_APPROVAL &&
      allReady,
    canCancel: isStoryboardRunCancellable(run),
    frames,
  };
}

function isStoryboardRunCancellable(run: {
  status: StoryboardRunStatus | string;
  dispatchReservationKey?: string | null;
  videoBriefId?: string | null;
  videoJobId?: string | null;
}): boolean {
  return (
    (CANCELLABLE_STORYBOARD_STATUSES as string[]).includes(String(run.status)) &&
    !run.dispatchReservationKey &&
    !run.videoBriefId &&
    // 批量视频的故事板随批次取消（cancelStoryboardRunsForVideoJobs），不单独取消。
    !run.videoJobId
  );
}

function rateLimitFromEnv(name: string, fallback: number): number {
  const configured = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(configured) || configured < 1) return fallback;
  return Math.min(configured, 500);
}

/**
 * 用户直接发起的付费出图入口限流（与月度套餐额度分开，只防浏览器循环 /
 * 误操作 / 恶意刷单造成的突发花费）。超限给人话，不抛内部错误。
 */
async function bumpStoryboardRateLimit(
  action: "create" | "frame-regenerate",
  userId: string,
): Promise<void> {
  const max = action === "create"
    ? rateLimitFromEnv("STORYBOARD_CREATE_RATE_LIMIT_PER_HOUR", STORYBOARD_CREATE_PER_HOUR_DEFAULT)
    : rateLimitFromEnv(
        "STORYBOARD_FRAME_REGEN_RATE_LIMIT_PER_HOUR",
        STORYBOARD_FRAME_REGEN_PER_HOUR_DEFAULT,
      );
  try {
    await bumpRateLimit(`storyboard-${action}:user:${userId}`, hourlyWindowKey(), max);
  } catch (error) {
    if (!(error instanceof RateLimitExceededError)) throw error;
    throw new StoryboardRequestError(
      action === "create"
        ? `一小时内最多发起 ${max} 轮故事板。已生成的故事板都还在，请稍后再开新的一轮。`
        : `一小时内最多重做 ${max} 次分镜，请稍后再试；已生成的画面都会保留。`,
      "RATE_LIMITED",
      429,
    );
  }
}

export function canRegenerateStoryboardFrame(frame: {
  status: StoryboardFrameStatus | string;
  submissionState: ProviderSubmissionState | string;
  lastProviderStatus?: string | null;
  externalTaskId: string | null;
}): boolean {
  if (frame.status === StoryboardFrameStatus.SUCCEEDED) return true;
  if (frame.status !== StoryboardFrameStatus.FAILED) return false;
  if (frame.submissionState === ProviderSubmissionState.REJECTED) return true;
  if (frame.submissionState === ProviderSubmissionState.ACK_UNKNOWN) {
    // 任务号已知时真实状态可查，由 reconcile 复活或落地，禁止抢先重生成；
    // 任务号未知则合作方无按键反查接口，唯一安全出路是显式计费的新 attempt
    // （新 Idempotency-Key），重复扣费敞口以单帧图片费用为上限。
    return frame.externalTaskId == null;
  }
  return frame.lastProviderStatus === "refunded";
}

function requestHash(input: CreateStoryboardRunInput, assetUrls: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify({
      prompt: input.prompt.trim(),
      durationSec: input.durationSec,
      aspectRatio: input.aspectRatio,
      sourceAssetIds: [...(input.sourceAssetIds ?? [])].sort(),
      assetUrls,
      approvalPolicy: input.approvalPolicy ?? "MANUAL",
      purpose: input.purpose ?? "single-video-storyboard",
    }))
    .digest("hex");
}

function frameRequestKey(runId: string, ordinal: number, attempt: number): string {
  return `storyboard:${runId}:frame:${ordinal}:attempt:${attempt}`;
}

async function findRun(runId: string, userId?: string): Promise<StoryboardRunRecord | null> {
  return db.storyboardRun.findFirst({
    where: { id: runId, ...(userId ? { userId } : {}) },
    include: storyboardInclude,
  });
}

export async function createStoryboardRun(
  input: CreateStoryboardRunInput,
): Promise<StoryboardRunView> {
  if (!input.prompt.trim()) {
    throw new StoryboardRequestError("请描述视频故事。", "VALIDATION_FAILED");
  }
  if (![5, 10, 15, 30, 60].includes(input.durationSec)) {
    throw new StoryboardRequestError("视频时长不受支持。", "VALIDATION_FAILED");
  }
  const assetIds = [...new Set(input.sourceAssetIds ?? [])];
  const assets = assetIds.length
    ? await resolveOwnedMediaAssets({ userId: input.userId, assetIds })
    : [];
  if (assets.some((asset) => !asset.mimeType.startsWith("image/"))) {
    throw new StoryboardRequestError("故事板只接受图片素材。", "VALIDATION_FAILED");
  }
  const hash = requestHash(input, assets.map((asset) => asset.url));
  const existing = await db.storyboardRun.findUnique({
    where: {
      userId_idempotencyKey: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    include: storyboardInclude,
  });
  if (existing) {
    if (existing.requestHash !== hash) {
      throw new StoryboardRequestError(
        "该故事板提交标识已用于其他内容。",
        "IDEMPOTENCY_CONFLICT",
        409,
      );
    }
    return storyboardRunView(await reconcileStoryboardRun(existing.id, input.userId));
  }
  // 只给「真正新建」计数：同一幂等键的回放（刷新后重提）不占名额。
  if (input.userInitiated) await bumpStoryboardRateLimit("create", input.userId);

  const id = randomUUID();
  const plans = buildStoryboardFramePlans(input);
  let run: StoryboardRunRecord;
  try {
    run = await db.storyboardRun.create({
      data: {
        id,
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        requestHash: hash,
        approvalPolicy:
          input.approvalPolicy === "AUTO"
            ? StoryboardApprovalPolicy.AUTO
            : StoryboardApprovalPolicy.MANUAL,
        status: StoryboardRunStatus.GENERATING,
        durationSec: input.durationSec,
        aspectRatio: input.aspectRatio,
        purpose: input.purpose ?? "single-video-storyboard",
        sourcePrompt: input.prompt.trim(),
        inputAssetIds: assetIds,
        inputImageUrls: assets.map((asset) => asset.url),
        frames: {
          create: plans.map((plan) => ({
            ordinal: plan.ordinal,
            attempt: 1,
            isCurrent: true,
            beat: plan.beat,
            prompt: plan.prompt,
            providerRequestKey: frameRequestKey(id, plan.ordinal, 1),
          })),
        },
      },
      include: storyboardInclude,
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const replay = await db.storyboardRun.findUnique({
      where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
      include: storyboardInclude,
    });
    if (!replay || replay.requestHash !== hash) {
      throw new StoryboardRequestError("故事板提交冲突。", "IDEMPOTENCY_CONFLICT", 409);
    }
    return storyboardRunView(replay);
  }

  const first = run.frames[0];
  if (first) await submitStoryboardFrame(first.id);
  return storyboardRunView((await findRun(run.id, input.userId)) ?? run);
}

async function submitStoryboardFrame(frameId: string): Promise<void> {
  const frame = await db.storyboardFrame.findUnique({
    where: { id: frameId },
    include: {
      outputAsset: true,
      storyboardRun: { include: { frames: { where: { isCurrent: true } } } },
    },
  });
  if (
    !frame ||
    !frame.isCurrent ||
    frame.status !== StoryboardFrameStatus.QUEUED ||
    frame.submissionState !== ProviderSubmissionState.NOT_STARTED ||
    frame.storyboardRun.status === StoryboardRunStatus.CANCELLED
  ) return;
  const submittedAt = new Date();
  // 取消会把 QUEUED 帧就地落成终态；这里的帧级 CAS 与它互斥，外加 run 级
  // 兜底：已取消的一轮永远不会再有新的提交。
  const claimed = await db.storyboardFrame.updateMany({
    where: {
      id: frame.id,
      isCurrent: true,
      status: StoryboardFrameStatus.QUEUED,
      submissionState: ProviderSubmissionState.NOT_STARTED,
      storyboardRun: { status: { not: StoryboardRunStatus.CANCELLED } },
    },
    data: {
      status: StoryboardFrameStatus.PROCESSING,
      submissionState: ProviderSubmissionState.SUBMITTING,
      submittedAt,
      errorCode: null,
      errorMessage: null,
    },
  });
  if (claimed.count !== 1) return;

  const priorFrames = frame.storyboardRun.frames
    .filter((candidate) =>
      candidate.isCurrent &&
      candidate.ordinal < frame.ordinal &&
      candidate.status === StoryboardFrameStatus.SUCCEEDED &&
      candidate.outputUrl,
    )
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((candidate) => candidate.outputUrl!);
  const inputImages = [
    ...priorFrames.slice(-2),
    ...frame.storyboardRun.inputImageUrls,
  ].slice(0, 5);
  /// 合作方一旦返回任务号，提交就已确认；此后任何本地失败都不该把这帧
  /// 归为「确认未知」。任务号捕获在外层，落库失败时先重试一次持久化，
  /// 仍失败也要把任务号写进失败行，让后续对账能按它查真实状态。
  let acknowledgedTaskId: string | null = null;
  const acceptFrameSubmission = (externalTaskId: string) =>
    db.storyboardFrame.updateMany({
      where: {
        id: frame.id,
        providerRequestKey: frame.providerRequestKey,
        submissionState: ProviderSubmissionState.SUBMITTING,
      },
      data: {
        externalTaskId,
        submissionState: ProviderSubmissionState.ACCEPTED,
        lastProviderStatus: "queued",
        lastCheckedAt: new Date(),
        pollErrors: 0,
      },
    });
  try {
    const submitted = await runtime().submitTask({
      requestKey: frame.providerRequestKey,
      prompt: frame.prompt,
      aspectRatio: frame.storyboardRun.aspectRatio as "9:16" | "16:9" | "1:1",
      /// 合作方 0728 起下线 1K 档，目录最低为 2K。成本让位于可用性：
      /// 宁可每帧多几个积分，也不让整条产线因档位缺失而停摆。
      resolution: "2K",
      inputImages,
      planSnapshot:
        frame.planId && frame.modelSnapshot && frame.resolutionSnapshot && frame.pointsSnapshot != null
          ? {
              planId: frame.planId,
              model: frame.modelSnapshot,
              resolution: frame.resolutionSnapshot as "1K" | "2K" | "4K",
              points: frame.pointsSnapshot,
              family: "gpt-image-2",
            }
          : undefined,
      onPlanSelected: async (plan) => {
        const persisted = await db.storyboardFrame.updateMany({
          where: {
            id: frame.id,
            providerRequestKey: frame.providerRequestKey,
            submissionState: ProviderSubmissionState.SUBMITTING,
          },
          data: {
            planId: plan.planId,
            modelSnapshot: plan.model,
            resolutionSnapshot: plan.resolution,
            pointsSnapshot: plan.points,
          },
        });
        if (persisted.count !== 1) throw new StoryboardLeaseLostError();
      },
    });
    acknowledgedTaskId = submitted.externalTaskId;
    const accepted = await acceptFrameSubmission(submitted.externalTaskId);
    if (accepted.count !== 1) throw new StoryboardLeaseLostError();
  } catch (error) {
    if (acknowledgedTaskId && !(error instanceof StoryboardLeaseLostError)) {
      // 提交已确认、只是落库瞬时失败：重试一次持久化就能救回真实任务。
      // CAS 落空（帧已被并发路径接管）时安全退出，不产生任何覆盖。
      const recovered = await acceptFrameSubmission(acknowledgedTaskId)
        .catch(() => ({ count: 0 }));
      if (recovered.count === 1) return;
    }
    const failure = asProviderSubmissionError({
      error,
      providerId: "shuyu",
      evidence: acknowledgedTaskId ? { stage: "persistence" } : undefined,
    });
    const unknown = failure.disposition === "acknowledgement_unknown";
    const state = unknown
      ? ProviderSubmissionState.ACK_UNKNOWN
      : ProviderSubmissionState.REJECTED;
    const code = unknown ? "SUBMISSION_ACK_UNKNOWN" : "PROVIDER_REJECTED";
    const message = unknown
      ? acknowledgedTaskId
        ? "该分镜任务已被合作方接收，系统稍后会自动核对真实进度，无需重新提交。"
        : "该分镜的提交确认未知，系统会自动按新尝试重新生成这一帧；其余分镜不受影响。"
      : "Shuyu 明确拒绝了该分镜任务，可重新生成这一帧。";
    // Only this frame fails here. The run settles in advanceRun once every
    // sibling reaches a terminal state, so in-flight paid frames still finish.
    await db.storyboardFrame.updateMany({
      where: { id: frame.id, submissionState: ProviderSubmissionState.SUBMITTING },
      data: {
        status: StoryboardFrameStatus.FAILED,
        submissionState: state,
        completedAt: new Date(),
        errorCode: code,
        errorMessage: message,
        // 已知任务号绝不丢弃：reconcile 会按它查合作方真实状态并复活这一帧。
        ...(unknown && acknowledgedTaskId
          ? { externalTaskId: acknowledgedTaskId }
          : {}),
      },
    });
  }
}

async function claimFrame(frameId: string, leaseOwner: string): Promise<StoryboardFrameRecord | null> {
  const now = new Date();
  const claimed = await db.storyboardFrame.updateMany({
    where: {
      id: frameId,
      isCurrent: true,
      status: StoryboardFrameStatus.PROCESSING,
      submissionState: ProviderSubmissionState.ACCEPTED,
      externalTaskId: { not: null },
      AND: [{ OR: [{ availableAt: null }, { availableAt: { lte: now } }] }],
      OR: [{ leaseOwner: null }, { leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
    },
    data: {
      leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + STORYBOARD_LEASE_MS),
    },
  });
  if (claimed.count !== 1) return null;
  return db.storyboardFrame.findFirst({
    where: { id: frameId, leaseOwner, leaseExpiresAt: { gt: now } },
    include: {
      outputAsset: true,
      storyboardRun: { include: { frames: { where: { isCurrent: true } } } },
    },
  });
}

async function reconcileStoryboardFrame(frameId: string): Promise<void> {
  const leaseOwner = randomUUID();
  const frame = await claimFrame(frameId, leaseOwner);
  if (!frame?.externalTaskId) return;
  let result: Awaited<ReturnType<typeof pollShuyuImageTask>>;
  try {
    result = await runtime().pollTask(frame.externalTaskId);
  } catch {
    const now = new Date();
    await db.storyboardFrame.updateMany({
      where: {
        id: frame.id,
        leaseOwner,
        leaseExpiresAt: { gt: now },
        status: StoryboardFrameStatus.PROCESSING,
      },
      data: {
        pollErrors: { increment: 1 },
        lastCheckedAt: now,
        availableAt: new Date(now.getTime() + STORYBOARD_POLL_RETRY_MS),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return;
  }
  if (result.status === "queued" || result.status === "processing") {
    const now = new Date();
    await db.storyboardFrame.updateMany({
      where: { id: frame.id, leaseOwner, leaseExpiresAt: { gt: now } },
      data: {
        lastProviderStatus: result.rawStatus,
        lastCheckedAt: now,
        pollErrors: 0,
        availableAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return;
  }
  if (result.status === "failed") {
    const now = new Date();
    const refunded = result.rawStatus === "refunded";
    const refundError = result.rawStatus === "refund_error";
    const message = refundError
      ? "故事板生成失败且退款状态异常。为避免重复计费，请联系支持核对。"
      : refunded
        ? "故事板分镜生成失败，合作方已确认退款，可重新生成这一帧。"
        : "故事板分镜生成失败，但退款状态尚未确认。为避免重复计费，请联系支持核对。";
    // Frame-level failure only; advanceRun settles the run after every
    // sibling reaches a terminal state so completed frames stay harvestable.
    await db.storyboardFrame.updateMany({
      where: { id: frame.id, leaseOwner, leaseExpiresAt: { gt: now } },
      data: {
        status: StoryboardFrameStatus.FAILED,
        lastProviderStatus: result.rawStatus,
        lastCheckedAt: now,
        completedAt: now,
        errorCode: refundError
          ? "PROVIDER_REFUND_ERROR"
          : refunded
            ? "PROVIDER_REFUNDED"
            : "PROVIDER_FAILED",
        errorMessage: message,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return;
  }

  const outputUrl = result.outputUrls[0];
  if (!outputUrl) throw new Error("Shuyu storyboard completed without an image");
  const generated = await runtime().fetchOutput(outputUrl);
  const storage = runtime().storage();
  if (!storage.isConfigured()) throw new Error("故事板存储暂不可用");
  const extension = generated.mimeType === "image/png"
    ? "png"
    : generated.mimeType === "image/webp"
      ? "webp"
      : "jpg";
  const key = `storyboards/${frame.storyboardRun.userId}/${frame.storyboardRunId}/frame-${frame.ordinal}-attempt-${frame.attempt}-${randomUUID()}.${extension}`;
  const object = await storage.uploadBuffer("renders", generated.bytes, {
    key,
    contentType: generated.mimeType,
    access: "public",
    overwrite: false,
  });
  let asset: MediaAsset | null = null;
  try {
    asset = await runtime().createAsset({
      userId: frame.storyboardRun.userId,
      storageKey: object.key,
      url: object.url,
      mimeType: generated.mimeType,
      bytes: generated.bytes,
    });
    await db.$transaction(async (tx) => {
      const now = new Date();
      const finished = await tx.storyboardFrame.updateMany({
        where: {
          id: frame.id,
          leaseOwner,
          leaseExpiresAt: { gt: now },
          status: StoryboardFrameStatus.PROCESSING,
        },
        data: {
          status: StoryboardFrameStatus.SUCCEEDED,
          outputUrl: asset!.url,
          outputAssetId: asset!.id,
          lastProviderStatus: result.rawStatus,
          lastCheckedAt: now,
          completedAt: now,
          pollErrors: 0,
          errorCode: null,
          errorMessage: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (finished.count !== 1) throw new StoryboardLeaseLostError();
    });
  } catch (error) {
    if (asset) {
      const removed = await db.mediaAsset.deleteMany({
        where: { id: asset.id, storyboardFrames: { none: {} } },
      }).catch(() => ({ count: 0 }));
      if (removed.count === 1) await storage.deleteObject("renders", object.key).catch(() => undefined);
    } else {
      await storage.deleteObject("renders", object.key).catch(() => undefined);
    }
    throw error;
  }
}

async function advanceRun(runId: string): Promise<StoryboardRunRecord> {
  let run = await findRun(runId);
  if (!run) throw new StoryboardRequestError("故事板不存在。", "NOT_FOUND", 404);
  // 已取消的一轮只收割已提交的帧（reconcile 在帧级完成），run 本身不再迁移、
  // 不再提交排队帧。
  if (run.status === StoryboardRunStatus.CANCELLED) return run;
  const expected = storyboardFrameCountForDuration(run.durationSec);
  const settled =
    run.frames.length === expected &&
    run.frames.every((frame) =>
      frame.status === StoryboardFrameStatus.SUCCEEDED ||
      frame.status === StoryboardFrameStatus.FAILED,
    );
  const anyFailed = run.frames.some((frame) => frame.status === StoryboardFrameStatus.FAILED);
  if (!settled && run.status === StoryboardRunStatus.FAILED) {
    // Frames are still queued, generating, or freshly revived while the run
    // carries a FAILED verdict (old fail-fast semantics, or an ACK_UNKNOWN
    // frame that reconcile just brought back). Heal the run to GENERATING so
    // the scheduler and UI polling continue to drive the remaining frames;
    // paid in-flight work must never be abandoned.
    await db.storyboardRun.updateMany({
      where: { id: run.id, status: StoryboardRunStatus.FAILED },
      data: { status: StoryboardRunStatus.GENERATING, errorCode: null, errorMessage: null },
    });
  }
  if (anyFailed && settled) {
    // 显式源状态：只有还在出帧 / 等确认的 run 会被判失败；CANCELLED、APPROVED
    // 永远不被覆盖。
    await db.storyboardRun.updateMany({
      where: {
        id: run.id,
        status: {
          in: [StoryboardRunStatus.GENERATING, StoryboardRunStatus.AWAITING_APPROVAL],
        },
      },
      data: {
        status: StoryboardRunStatus.FAILED,
        errorCode: "FRAME_FAILED",
        errorMessage: "部分分镜需要处理；已完成的分镜已保留，可在故事板中单独处理失败的分镜。",
      },
    });
    return (await findRun(run.id))!;
  }
  if (
    run.frames.length === expected &&
    run.frames.every((frame) => frame.status === StoryboardFrameStatus.SUCCEEDED)
  ) {
    const auto = run.approvalPolicy === StoryboardApprovalPolicy.AUTO;
    // FAILED is also a legal source state: a revived ACK_UNKNOWN frame can
    // finish the run after an earlier premature FAILED verdict.
    await db.storyboardRun.updateMany({
      where: {
        id: run.id,
        status: { in: [StoryboardRunStatus.GENERATING, StoryboardRunStatus.FAILED] },
      },
      data: {
        status: auto ? StoryboardRunStatus.APPROVED : StoryboardRunStatus.AWAITING_APPROVAL,
        approvedAt: auto ? new Date() : null,
        errorCode: null,
        errorMessage: null,
      },
    });
    return (await findRun(run.id))!;
  }
  const next = run.frames.find((frame) => frame.status === StoryboardFrameStatus.QUEUED);
  if (next) await submitStoryboardFrame(next.id);
  run = (await findRun(run.id))!;
  return run;
}

export async function reconcileStoryboardRun(
  runId: string,
  userId?: string,
): Promise<StoryboardRunRecord> {
  const run = await findRun(runId, userId);
  if (!run) throw new StoryboardRequestError("故事板不存在。", "NOT_FOUND", 404);
  const now = Date.now();
  for (const frame of run.frames) {
    // 进程在提交半途崩溃的帧会永远停在 SUBMITTING，没有任何轮询会碰它。
    // 超过提交窗口后按「确认未知」终结（崩溃前后不可区分），无任务号的
    // 走显式计费的重新生成解冻，而不是让整条 run 无限等待。
    if (
      frame.status === StoryboardFrameStatus.PROCESSING &&
      frame.submissionState === ProviderSubmissionState.SUBMITTING &&
      frame.submittedAt &&
      now - frame.submittedAt.getTime() > STORYBOARD_SUBMIT_STALL_MS
    ) {
      await db.storyboardFrame.updateMany({
        where: {
          id: frame.id,
          isCurrent: true,
          submissionState: ProviderSubmissionState.SUBMITTING,
          submittedAt: frame.submittedAt,
        },
        data: {
          status: StoryboardFrameStatus.FAILED,
          submissionState: ProviderSubmissionState.ACK_UNKNOWN,
          completedAt: new Date(),
          errorCode: "SUBMISSION_ACK_UNKNOWN",
          errorMessage:
            "该分镜的提交确认未知，系统会自动按新尝试重新生成这一帧；其余分镜不受影响。",
        },
      });
      continue;
    }
    // ACK_UNKNOWN 但任务号已知：合作方真实状态可查。先复活回收割轨道再
    // reconcile——活着继续渲染、成了就收割、败了按退款语义落地。全程零提交，
    // billing-safe。
    if (
      frame.status === StoryboardFrameStatus.FAILED &&
      frame.submissionState === ProviderSubmissionState.ACK_UNKNOWN &&
      frame.externalTaskId
    ) {
      const revived = await db.storyboardFrame.updateMany({
        where: {
          id: frame.id,
          isCurrent: true,
          status: StoryboardFrameStatus.FAILED,
          submissionState: ProviderSubmissionState.ACK_UNKNOWN,
          externalTaskId: frame.externalTaskId,
        },
        data: {
          status: StoryboardFrameStatus.PROCESSING,
          submissionState: ProviderSubmissionState.ACCEPTED,
          completedAt: null,
          errorCode: null,
          errorMessage: null,
          pollErrors: 0,
          availableAt: null,
        },
      });
      if (revived.count === 1) {
        try {
          await reconcileStoryboardFrame(frame.id);
        } catch (error) {
          console.error("[storyboards] ack-unknown frame reconcile failed", {
            frameId: frame.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      continue;
    }
    if (
      frame.status === StoryboardFrameStatus.PROCESSING &&
      frame.submissionState === ProviderSubmissionState.ACCEPTED &&
      frame.externalTaskId
    ) {
      try {
        await reconcileStoryboardFrame(frame.id);
      } catch (error) {
        // One frame's harvest failure (storage, output fetch) must not block
        // reconciling siblings or reading the run; the frame retries on the
        // next poll once its lease expires.
        console.error("[storyboards] frame reconcile failed", {
          frameId: frame.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return advanceRun(run.id);
}

export async function getStoryboardRunForUser(
  runId: string,
  userId: string,
): Promise<StoryboardRunView> {
  return storyboardRunView(await reconcileStoryboardRun(runId, userId));
}

const STORYBOARD_RESUME_WINDOW_MS = 24 * 60 * 60_000;

/**
 * The most recent single-video storyboard the user can pick back up after a
 * refresh or accidental navigation: not yet attached to a video, and touched
 * within the resume window. Reconciles on read so a run that kept generating
 * server-side comes back with fresh frame states.
 */
export async function findResumableStoryboardRunForUser(userId: string): Promise<{
  run: StoryboardRunView;
  context: ResumableStoryboardContext;
} | null> {
  const candidate = await db.storyboardRun.findFirst({
    where: {
      userId,
      purpose: "single-video-storyboard",
      videoBriefId: null,
      videoJobId: null,
      status: {
        in: [
          StoryboardRunStatus.GENERATING,
          StoryboardRunStatus.AWAITING_APPROVAL,
          StoryboardRunStatus.APPROVED,
          StoryboardRunStatus.FAILED,
        ],
      },
      updatedAt: { gte: new Date(Date.now() - STORYBOARD_RESUME_WINDOW_MS) },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!candidate) return null;
  const run = await reconcileStoryboardRun(candidate.id, userId);
  const assets = run.inputAssetIds.length
    ? await db.mediaAsset.findMany({
        where: { id: { in: run.inputAssetIds }, userId },
        select: { id: true, url: true, mimeType: true, width: true, height: true },
      })
    : [];
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return {
    run: storyboardRunView(run),
    context: {
      prompt: run.sourcePrompt,
      durationSec: run.durationSec,
      aspectRatio: run.aspectRatio,
      sourceAssets: run.inputAssetIds
        .map((assetId) => assetsById.get(assetId))
        .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
        .map((asset) => ({
          id: asset.id,
          url: asset.url,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
        })),
    },
  };
}

export async function regenerateStoryboardFrame(input: {
  userId: string;
  runId: string;
  frameId: string;
  /// 创作台用户点「重做这一帧」时为 true（计入每小时限流）；批量自动重投不传。
  userInitiated?: boolean;
}): Promise<StoryboardRunView> {
  if (input.userInitiated) await bumpStoryboardRateLimit("frame-regenerate", input.userId);
  const created = await db.$transaction(async (tx) => {
    const existing = await tx.storyboardFrame.findFirst({
      where: {
        id: input.frameId,
        storyboardRunId: input.runId,
        isCurrent: true,
        storyboardRun: { userId: input.userId },
      },
      include: { storyboardRun: true },
    });
    if (!existing) return null;
    if (existing.storyboardRun.status === StoryboardRunStatus.CANCELLED) {
      throw new StoryboardRequestError(
        "这一轮故事板已取消，不能再重做分镜。请修改创作方向后开始新的一轮。",
        "STORYBOARD_CANCELLED",
        409,
      );
    }
    if (existing.attempt - 1 >= STORYBOARD_FRAME_MAX_REGENERATIONS) {
      throw new StoryboardRequestError(
        `这一帧已经重做了 ${STORYBOARD_FRAME_MAX_REGENERATIONS} 次。继续重抽很少变好：建议换一张更清楚的产品照片，或把创作描述写得更具体，再开新的一轮。`,
        "FRAME_REGENERATION_LIMIT",
        409,
      );
    }
    if (!canRegenerateStoryboardFrame(existing)) {
      throw new StoryboardRequestError(
        "该分镜的合作方接收或退款状态尚未确认。为避免重复计费，请联系支持核对。",
        "BILLING_STATE_UNCONFIRMED",
        409,
      );
    }
    // 显式源状态 CAS：已取消 / 已确认并交给派发的 run 不能被拉回 GENERATING。
    // 与取消并发时，取消先提交则这里 count=0、整个事务回滚，不会留下新帧。
    const reopened = await tx.storyboardRun.updateMany({
      where: {
        id: existing.storyboardRunId,
        userId: input.userId,
        status: {
          in: [
            StoryboardRunStatus.GENERATING,
            StoryboardRunStatus.AWAITING_APPROVAL,
            StoryboardRunStatus.FAILED,
          ],
        },
        dispatchReservationKey: null,
        videoBriefId: null,
      },
      data: {
        status: StoryboardRunStatus.GENERATING,
        approvedAt: null,
        approvedById: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (reopened.count !== 1) {
      throw new StoryboardRequestError(
        "故事板状态已变化（可能已取消或已确认），请刷新后再试。",
        "INVALID_STATE",
        409,
      );
    }
    const invalidated = await tx.storyboardFrame.updateMany({
      where: { id: existing.id, isCurrent: true },
      data: { isCurrent: false },
    });
    if (invalidated.count !== 1) {
      throw new StoryboardRequestError("故事板分镜已变化，请刷新后再试。", "INVALID_STATE", 409);
    }
    const attempt = existing.attempt + 1;
    return tx.storyboardFrame.create({
      data: {
        storyboardRunId: existing.storyboardRunId,
        ordinal: existing.ordinal,
        attempt,
        isCurrent: true,
        beat: existing.beat,
        prompt: `${existing.prompt}\nREGENERATION: create a distinct but continuity-faithful alternative for this same beat.`,
        providerRequestKey: frameRequestKey(existing.storyboardRunId, existing.ordinal, attempt),
      },
    });
  });
  if (!created) throw new StoryboardRequestError("故事板分镜不存在。", "NOT_FOUND", 404);
  await submitStoryboardFrame(created.id);
  const run = await findRun(input.runId, input.userId);
  if (!run) throw new StoryboardRequestError("故事板不存在。", "NOT_FOUND", 404);
  return storyboardRunView(run);
}

export async function approveStoryboard(input: {
  userId: string;
  runId: string;
}): Promise<StoryboardRunView> {
  const run = await findRun(input.runId, input.userId);
  if (!run) throw new StoryboardRequestError("故事板不存在。", "NOT_FOUND", 404);
  if (run.status === StoryboardRunStatus.CANCELLED) {
    throw new StoryboardRequestError(
      "这一轮故事板已取消，不能再确认。请修改创作方向后开始新的一轮。",
      "STORYBOARD_CANCELLED",
      409,
    );
  }
  const expected = storyboardFrameCountForDuration(run.durationSec);
  if (
    run.approvalPolicy !== StoryboardApprovalPolicy.MANUAL ||
    run.status !== StoryboardRunStatus.AWAITING_APPROVAL ||
    run.frames.length !== expected ||
    !run.frames.every((frame) => frame.status === StoryboardFrameStatus.SUCCEEDED)
  ) {
    throw new StoryboardRequestError("故事板尚未全部完成，暂时不能确认。", "INVALID_STATE", 409);
  }
  const approved = await db.storyboardRun.updateMany({
    where: {
      id: run.id,
      userId: input.userId,
      status: StoryboardRunStatus.AWAITING_APPROVAL,
      approvalPolicy: StoryboardApprovalPolicy.MANUAL,
    },
    data: {
      status: StoryboardRunStatus.APPROVED,
      approvedAt: new Date(),
      approvedById: input.userId,
    },
  });
  if (approved.count !== 1) throw new StoryboardRequestError("故事板状态已变化。", "INVALID_STATE", 409);
  return storyboardRunView((await findRun(run.id, input.userId))!);
}

export async function getApprovedStoryboardVideoReferences(input: {
  userId: string;
  runId: string;
}): Promise<string[]> {
  const run = await findRun(input.runId, input.userId);
  if (!run || run.status !== StoryboardRunStatus.APPROVED) {
    throw new StoryboardRequestError("请先完成并确认故事板。", "STORYBOARD_NOT_APPROVED", 409);
  }
  const refs = run.frames
    .filter((frame) =>
      frame.status === StoryboardFrameStatus.SUCCEEDED &&
      frame.outputAsset?.userId === input.userId,
    )
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((frame) => frame.outputAsset?.url)
    .filter((url): url is string => Boolean(url));
  if (refs.length !== storyboardFrameCountForDuration(run.durationSec)) {
    throw new StoryboardRequestError("故事板图片不完整。", "STORYBOARD_INCOMPLETE", 409);
  }
  return refs;
}

export async function attachStoryboardToVideoBrief(input: {
  userId: string;
  runId: string;
  briefId: string;
}): Promise<void> {
  const refs = await getApprovedStoryboardVideoReferences(input);
  await db.$transaction(async (tx) => {
    const brief = await tx.videoBrief.findFirst({
      where: {
        id: input.briefId,
        contentAngle: { round: { deliveryOrder: { createdById: input.userId } } },
      },
      select: { id: true },
    });
    if (!brief) throw new StoryboardRequestError("视频项目不存在。", "NOT_FOUND", 404);
    const attached = await tx.storyboardRun.updateMany({
      where: {
        id: input.runId,
        userId: input.userId,
        status: StoryboardRunStatus.APPROVED,
        OR: [{ videoBriefId: null }, { videoBriefId: input.briefId }],
      },
      data: { videoBriefId: input.briefId },
    });
    if (attached.count !== 1) {
      throw new StoryboardRequestError("故事板已用于另一支视频。", "INVALID_STATE", 409);
    }
    await tx.videoBrief.update({
      where: { id: input.briefId },
      data: { referenceImageUrls: refs },
    });
  });
}

export async function attachStoryboardToVideoJob(input: {
  userId: string;
  runId: string;
  videoJobId: string;
}): Promise<void> {
  const attached = await db.storyboardRun.updateMany({
    where: {
      id: input.runId,
      userId: input.userId,
      // 已取消的 run 不能再挂到任务上（取消会解绑并改写幂等键，正常不会走到这里）。
      status: { not: StoryboardRunStatus.CANCELLED },
      OR: [{ videoJobId: null }, { videoJobId: input.videoJobId }],
    },
    data: { videoJobId: input.videoJobId },
  });
  if (attached.count !== 1) {
    throw new StoryboardRequestError(
      "故事板已用于另一条批量视频。",
      "INVALID_STATE",
      409,
    );
  }
}

export async function requireApprovedStoryboardForVideoJob(
  videoJobId: string,
): Promise<string[]> {
  const run = await db.storyboardRun.findUnique({
    where: { videoJobId },
    include: storyboardInclude,
  });
  if (!run || run.status !== StoryboardRunStatus.APPROVED) {
    throw new StoryboardRequestError(
      "批量视频生成前必须完成故事板。",
      "STORYBOARD_NOT_APPROVED",
      409,
    );
  }
  const refs = run.frames
    .filter(
      (frame) =>
        frame.status === StoryboardFrameStatus.SUCCEEDED &&
        frame.outputAsset?.userId === run.userId,
    )
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((frame) => frame.outputAsset?.url)
    .filter((url): url is string => Boolean(url));
  if (refs.length !== storyboardFrameCountForDuration(run.durationSec)) {
    throw new StoryboardRequestError(
      "批量故事板图片不完整。",
      "STORYBOARD_INCOMPLETE",
      409,
    );
  }
  return refs;
}

async function loadApprovedStoryboardForBrief(briefId: string): Promise<{
  run: StoryboardRunRecord;
  frameUrls: string[];
}> {
  const run = await db.storyboardRun.findUnique({
    where: { videoBriefId: briefId },
    include: storyboardInclude,
  });
  if (!run || run.status !== StoryboardRunStatus.APPROVED) {
    throw new StoryboardRequestError("视频生成前必须确认故事板。", "STORYBOARD_NOT_APPROVED", 409);
  }
  const refs = run.frames
    .filter((frame) =>
      frame.status === StoryboardFrameStatus.SUCCEEDED &&
      frame.outputAsset?.userId === run.userId,
    )
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((frame) => frame.outputAsset?.url)
    .filter((url): url is string => Boolean(url));
  if (refs.length !== storyboardFrameCountForDuration(run.durationSec)) {
    throw new StoryboardRequestError("故事板图片不完整。", "STORYBOARD_INCOMPLETE", 409);
  }
  return { run, frameUrls: refs };
}

export async function requireApprovedStoryboardForBrief(
  briefId: string,
): Promise<string[]> {
  return (await loadApprovedStoryboardForBrief(briefId)).frameUrls;
}

/// 单条视频随每段下发的参考图上限：Omni-Reference 最多 9 张，留 1 张余量。
export const SINGLE_VIDEO_REFERENCE_IMAGE_LIMIT = 8;

/**
 * 单条视频的参考图编排：商家实拍在前、故事板帧在后（去重），按上限截断。
 *
 * 此前单条路径用故事板帧整体覆盖了原图，视频模型从头到尾看不到商家实拍，
 * 产品细节只能靠 AI 帧转述而漂移。实拍锚产品外观、故事板帧锚镜头连续性，
 * 两者都要：实拍最多占到「上限 − 帧数」个位置（至少 1 张），保证在常规上限内
 * 故事板帧不被挤掉；供应商侧若再按套餐上限截断，也是从队尾（帧）开始丢。
 */
export function composeSingleVideoReferenceImages(input: {
  productImageUrls: readonly string[];
  storyboardFrameUrls: readonly string[];
  limit?: number;
}): string[] {
  const limit = Math.max(1, input.limit ?? SINGLE_VIDEO_REFERENCE_IMAGE_LIMIT);
  const frames = [...new Set(input.storyboardFrameUrls.filter(Boolean))];
  const frameSet = new Set(frames);
  const photos = [...new Set(input.productImageUrls.filter(Boolean))]
    .filter((url) => !frameSet.has(url));
  const photoSlots = Math.max(1, limit - frames.length);
  return [...photos.slice(0, photoSlots), ...frames].slice(0, limit);
}

/**
 * 派发单条视频前取参考图：故事板必须已确认且完整；实拍取自这轮故事板的
 * 源图（就是商家上传、用来出故事板的那几张产品照片）。
 */
export async function requireApprovedStoryboardVideoReferencesForBrief(
  briefId: string,
): Promise<string[]> {
  const { run, frameUrls } = await loadApprovedStoryboardForBrief(briefId);
  return composeSingleVideoReferenceImages({
    productImageUrls: run.inputImageUrls,
    storyboardFrameUrls: frameUrls,
  });
}

export async function pollPendingStoryboardRuns(limit = 10): Promise<number> {
  const runs = await db.storyboardRun.findMany({
    where: {
      OR: [
        // 停用账号不再推进：GENERATING / FAILED 复活两路都排除停用用户；
        // 下面 CANCELLED 一路不过滤——停用时已取消的轮次仍要收回已付费的帧。
        { status: StoryboardRunStatus.GENERATING, owner: { disabledAt: null } },
        // FAILED 但存在「任务号已知的 ACK_UNKNOWN 帧」的 run 可以按真实状态
        // 复活，必须持续对账；其余 FAILED run 没有可查的事实，不进队列。
        {
          status: StoryboardRunStatus.FAILED,
          owner: { disabledAt: null },
          frames: {
            some: {
              isCurrent: true,
              status: StoryboardFrameStatus.FAILED,
              submissionState: ProviderSubmissionState.ACK_UNKNOWN,
              externalTaskId: { not: null },
            },
          },
        },
        // 已取消的一轮：不再出新帧，但已提交（可能已计费）的帧要继续对账，
        // 把付过钱的素材收回来；全部帧终态后自然退出这个队列。
        {
          status: StoryboardRunStatus.CANCELLED,
          frames: {
            some: {
              isCurrent: true,
              OR: [
                { status: StoryboardFrameStatus.PROCESSING },
                {
                  status: StoryboardFrameStatus.FAILED,
                  submissionState: ProviderSubmissionState.ACK_UNKNOWN,
                  externalTaskId: { not: null },
                },
              ],
            },
          },
        },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: Math.max(1, Math.min(limit, 50)),
    select: { id: true },
  });
  let polled = 0;
  for (const run of runs) {
    try {
      await reconcileStoryboardRun(run.id);
      polled += 1;
    } catch (error) {
      console.error("[storyboards] reconcile failed", {
        runId: run.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return polled;
}

/// 取消后改写的幂等键：同一个键再提交得到全新的一轮，而不是回放已取消的这条。
function storyboardTombstoneKey(runId: string, idempotencyKey: string): string {
  return `cancelled:${runId}:${idempotencyKey}`;
}

/**
 * 真取消一条故事板（铁律 §4.7：每一轮任务都必须可取消，取消清幂等键、保留素材）。
 *
 * - 只取消 GENERATING / AWAITING_APPROVAL，且不能有派发预留或已挂 brief
 *   （那说明视频已经在提交，取消故事板会把已付费的视频任务悬空）。
 * - 还没提交的 QUEUED 帧在同一事务里落成「未提交」终态，永远不会再被提交；
 * - 已提交（SUBMITTING / ACCEPTED）与任务号已知的 ACK_UNKNOWN 帧原样保留：
 *   它们可能已经计费，pollPendingStoryboardRuns 会继续对账，把素材收回来；
 * - 幂等键改写成墓碑值，解绑 brief / 批量任务 / 派发预留；已出的分镜图不动。
 *
 * 所有写入都带源状态 CAS：与出帧、确认、重做、派发预留并发时谁先提交谁赢，
 * 不会互相覆盖。返回本次是否真的把这条 run 改成了 CANCELLED。
 */
async function cancelStoryboardRunRecord(
  run: { id: string; userId: string; idempotencyKey: string },
  reason: "user" | "batch" | "account_disabled",
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const now = new Date();
    const cancelled = await tx.storyboardRun.updateMany({
      where: {
        id: run.id,
        userId: run.userId,
        idempotencyKey: run.idempotencyKey,
        status: { in: CANCELLABLE_STORYBOARD_STATUSES },
        dispatchReservationKey: null,
        videoBriefId: null,
        // 用户取消只针对单条故事板；批量任务上的 run 只能随批次一起取消。
        ...(reason === "user" ? { videoJobId: null } : {}),
      },
      data: {
        status: StoryboardRunStatus.CANCELLED,
        idempotencyKey: storyboardTombstoneKey(run.id, run.idempotencyKey),
        videoBriefId: null,
        videoJobId: null,
        dispatchReservationKey: null,
        approvedAt: null,
        approvedById: null,
        errorCode: "RUN_CANCELLED",
        errorMessage:
          reason === "batch"
            ? "所属批量任务已取消，这一轮故事板随之停止；已生成的分镜图保留。"
            : "已取消这一轮故事板；已生成的分镜图保留，不会再提交新的分镜。",
      },
    });
    if (cancelled.count !== 1) return false;
    await tx.storyboardFrame.updateMany({
      where: {
        storyboardRunId: run.id,
        isCurrent: true,
        status: StoryboardFrameStatus.QUEUED,
        submissionState: ProviderSubmissionState.NOT_STARTED,
      },
      data: {
        status: StoryboardFrameStatus.FAILED,
        completedAt: now,
        errorCode: "RUN_CANCELLED",
        errorMessage: STORYBOARD_CANCELLED_FRAME_MESSAGE,
      },
    });
    return true;
  });
}

function assertStoryboardRunCancellable(run: {
  status: StoryboardRunStatus;
  dispatchReservationKey: string | null;
  videoBriefId: string | null;
  videoJobId: string | null;
}): void {
  if (run.dispatchReservationKey || run.videoBriefId) {
    throw new StoryboardRequestError(
      "这一轮故事板已经交给视频生成，不能再取消故事板。请到成品库查看这条视频的进度。",
      "STORYBOARD_IN_DISPATCH",
      409,
    );
  }
  if (run.videoJobId) {
    // 单独取消批量任务上的故事板，批次下一拍会按同一任务重建新故事板、重复出图。
    throw new StoryboardRequestError(
      "这是批量视频的故事板，请在批次页取消对应的视频，故事板会一起停止。",
      "STORYBOARD_IN_BATCH",
      409,
    );
  }
  if (!CANCELLABLE_STORYBOARD_STATUSES.includes(run.status)) {
    throw new StoryboardRequestError(
      run.status === StoryboardRunStatus.APPROVED
        ? "故事板已确认，不会再产生出图费用；修改创作方向即可开始新的一轮。"
        : "这一轮故事板已经结束，不会再产生出图费用。",
      "INVALID_STATE",
      409,
    );
  }
}

/**
 * 用户取消自己的一轮故事板。重复取消幂等：已取消的直接返回当前视图。
 */
export async function cancelStoryboardRun(
  runId: string,
  userId: string,
): Promise<StoryboardRunView> {
  const run = await findRun(runId, userId);
  if (!run) throw new StoryboardRequestError("故事板不存在。", "NOT_FOUND", 404);
  if (run.status === StoryboardRunStatus.CANCELLED) return storyboardRunView(run);
  assertStoryboardRunCancellable(run);
  const cancelled = await cancelStoryboardRunRecord(run, "user");
  const latest = await findRun(run.id, userId);
  if (!latest) throw new StoryboardRequestError("故事板不存在。", "NOT_FOUND", 404);
  if (!cancelled && latest.status !== StoryboardRunStatus.CANCELLED) {
    // 读与写之间状态变了（刚出完帧被确认、刚开始派发）：按最新事实给人话。
    assertStoryboardRunCancellable(latest);
    // 仍可取消却没取消成（瞬时竞争）：明确告诉调用方「没取消」，不能当作已结束。
    throw new StoryboardRequestError("故事板状态刚刚变化，请再点一次取消。", "STATE_CHANGED", 409);
  }
  return storyboardRunView(latest);
}

/**
 * 批量任务取消时，把挂在这些任务上、仍在出帧的故事板一起真取消
 * （QUEUED 帧不再提交，已提交的帧继续对账收回素材）。返回实际取消的条数。
 */
export async function cancelStoryboardRunsForVideoJobs(jobIds: string[]): Promise<number> {
  const ids = [...new Set(jobIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const runs = await db.storyboardRun.findMany({
    where: {
      videoJobId: { in: ids },
      status: { in: CANCELLABLE_STORYBOARD_STATUSES },
    },
    select: { id: true, userId: true, idempotencyKey: true },
  });
  let cancelled = 0;
  for (const run of runs) {
    if (await cancelStoryboardRunRecord(run, "batch")) cancelled += 1;
  }
  return cancelled;
}

/**
 * 账号停用时，把该用户仍在出帧的故事板（单条与批量）全部真取消。
 * 每条自带事务，所以必须在停用事务提交之后调用。返回实际取消的条数。
 */
export async function cancelActiveStoryboardRunsForUser(userId: string): Promise<number> {
  const runs = await db.storyboardRun.findMany({
    where: { userId, status: { in: CANCELLABLE_STORYBOARD_STATUSES } },
    select: { id: true, userId: true, idempotencyKey: true },
  });
  let cancelled = 0;
  for (const run of runs) {
    if (await cancelStoryboardRunRecord(run, "account_disabled")) cancelled += 1;
  }
  return cancelled;
}

export const __test__ = {
  __setRuntimeDependenciesForTests(
    override: Partial<StoryboardRuntimeDependencies> | null,
  ) {
    runtimeOverride = override;
  },
  submitStoryboardFrame,
  reconcileStoryboardFrame,
  advanceRun,
};
