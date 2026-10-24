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
import { getStorageProvider } from "@/lib/storage";
import { asProviderSubmissionError } from "@/lib/video-generation/providers/submission-error";

const STORYBOARD_LEASE_MS = 2 * 60_000;
const STORYBOARD_POLL_RETRY_MS = 20_000;
/// 帧停留在 SUBMITTING 的最长时长。单次提交只有一次目录查询 + 一次 POST，
/// 超过这个窗口只可能是进程在提交半途崩溃——提交结局不可知，按 ACK_UNKNOWN 终结。
const STORYBOARD_SUBMIT_STALL_MS = 10 * 60_000;

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
      canRegenerate: canRegenerateStoryboardFrame(frame),
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
    frames,
  };
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
    frame.submissionState !== ProviderSubmissionState.NOT_STARTED
  ) return;
  const submittedAt = new Date();
  const claimed = await db.storyboardFrame.updateMany({
    where: {
      id: frame.id,
      isCurrent: true,
      status: StoryboardFrameStatus.QUEUED,
      submissionState: ProviderSubmissionState.NOT_STARTED,
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
    await db.storyboardRun.updateMany({
      where: { id: run.id, status: { not: StoryboardRunStatus.FAILED } },
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
}): Promise<StoryboardRunView> {
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
    if (!canRegenerateStoryboardFrame(existing)) {
      throw new StoryboardRequestError(
        "该分镜的合作方接收或退款状态尚未确认。为避免重复计费，请联系支持核对。",
        "BILLING_STATE_UNCONFIRMED",
        409,
      );
    }
    const invalidated = await tx.storyboardFrame.updateMany({
      where: { id: existing.id, isCurrent: true },
      data: { isCurrent: false },
    });
    if (invalidated.count !== 1) return null;
    await tx.storyboardRun.update({
      where: { id: existing.storyboardRunId },
      data: {
        status: StoryboardRunStatus.GENERATING,
        approvedAt: null,
        approvedById: null,
        errorCode: null,
        errorMessage: null,
      },
    });
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

export async function requireApprovedStoryboardForBrief(
  briefId: string,
): Promise<string[]> {
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
  return refs;
}

export async function pollPendingStoryboardRuns(limit = 10): Promise<number> {
  const runs = await db.storyboardRun.findMany({
    where: {
      OR: [
        { status: StoryboardRunStatus.GENERATING },
        // FAILED 但存在「任务号已知的 ACK_UNKNOWN 帧」的 run 可以按真实状态
        // 复活，必须持续对账；其余 FAILED run 没有可查的事实，不进队列。
        {
          status: StoryboardRunStatus.FAILED,
          frames: {
            some: {
              isCurrent: true,
              status: StoryboardFrameStatus.FAILED,
              submissionState: ProviderSubmissionState.ACK_UNKNOWN,
              externalTaskId: { not: null },
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
