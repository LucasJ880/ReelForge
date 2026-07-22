import { randomUUID } from "node:crypto";
import {
  Prisma,
  ProductImageStatus,
  ProviderSubmissionState,
  type MediaAsset,
  type ProductImageMode,
  type ProductImageProviderTask,
} from "@prisma/client";
import type { ShuyuResolution } from "@/lib/providers/shuyu-catalog";
import {
  fetchShuyuOutputImage,
  pollShuyuImageTask,
  submitShuyuImageTask,
  type ShuyuImageAspectRatio,
} from "@/lib/providers/shuyu-image-provider";
import { db } from "@/lib/db";
import { recordAIUsage } from "@/lib/services/ai-usage-log-service";
import {
  createOwnedMediaAsset,
  type MediaAssetRecord,
} from "@/lib/services/media-asset-service";
import { getStorageProvider } from "@/lib/storage";
import {
  asProviderSubmissionError,
  type ProviderSubmissionError,
} from "@/lib/video-generation/providers/submission-error";

export const PRODUCT_IMAGE_PROMPT_VERSION = "product-image-shuyu-v2";
const MAX_POLL_ERRORS = 3;
const PROVIDER_TASK_LEASE_MS = 2 * 60_000;
const SUBMITTING_STALE_MS = 2 * 60_000;

interface ProductImageRuntimeDependencies {
  submitTask: typeof submitShuyuImageTask;
  pollTask: typeof pollShuyuImageTask;
  fetchOutputImage: typeof fetchShuyuOutputImage;
  getStorageProvider: typeof getStorageProvider;
  createOwnedAsset: typeof createOwnedMediaAsset;
}

const defaultRuntimeDependencies: ProductImageRuntimeDependencies = {
  submitTask: submitShuyuImageTask,
  pollTask: pollShuyuImageTask,
  fetchOutputImage: fetchShuyuOutputImage,
  getStorageProvider,
  createOwnedAsset: createOwnedMediaAsset,
};
let runtimeOverride: Partial<ProductImageRuntimeDependencies> | null = null;

function runtimeDependencies(): ProductImageRuntimeDependencies {
  return { ...defaultRuntimeDependencies, ...runtimeOverride };
}

export const PRODUCT_IMAGE_PRESETS = {
  white_studio: {
    label: "白底棚拍",
    instruction:
      "clean warm-white seamless studio background, soft commercial key light, realistic contact shadow",
  },
  lifestyle: {
    label: "生活方式",
    instruction:
      "credible everyday lifestyle setting appropriate to the product, natural daylight, restrained supporting props",
  },
  luxury: {
    label: "高端质感",
    instruction:
      "premium editorial product lighting, dark warm neutral set, precise highlights, refined but believable materials",
  },
  social: {
    label: "社媒广告",
    instruction:
      "clear social-commerce composition with generous safe space for later copy, bright natural lighting, immediate product focus",
  },
  macro: {
    label: "材质特写",
    instruction:
      "macro commercial detail view emphasizing authentic material texture and construction, shallow depth of field",
  },
} as const;

export type ProductImagePreset = keyof typeof PRODUCT_IMAGE_PRESETS;
export type ProductImageAspectRatio = Extract<
  ShuyuImageAspectRatio,
  "1:1" | "4:5" | "9:16" | "16:9"
>;

export interface ProductImageRequest {
  userId: string;
  idempotencyKey: string;
  prompt: string;
  preset: ProductImagePreset;
  aspectRatio: ProductImageAspectRatio;
  resolution: ShuyuResolution;
  resultCount: number;
  sourceAsset?: MediaAssetRecord;
}

const assetInclude = {
  sourceAsset: true,
  outputs: { include: { asset: true }, orderBy: { position: "asc" as const } },
  providerTasks: {
    include: { result: { include: { asset: true } } },
    orderBy: { ordinal: "asc" as const },
  },
} as const;

export type ProductImageJobWithAssets = Prisma.ProductImageJobGetPayload<{
  include: typeof assetInclude;
}>;

export type ProductImageResultWithOwner = Prisma.ProductImageResultGetPayload<{
  include: {
    asset: true;
    productImageJob: { select: { id: true; userId: true; status: true } };
  };
}>;

type ProviderTaskWithJob = Prisma.ProductImageProviderTaskGetPayload<{
  include: {
    result: { include: { asset: true } };
    productImageJob: { include: { sourceAsset: true; outputs: { include: { asset: true } } } };
  };
}>;

export class ProductImageRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ProductImageRequestError";
  }
}

class ProductImageLeaseLostError extends Error {
  constructor() {
    super("Product image provider-task lease was lost");
    this.name = "ProductImageLeaseLostError";
  }
}

class ProductImageRetryClaimLostError extends Error {
  constructor() {
    super("Product image provider-task retry claim was lost");
    this.name = "ProductImageRetryClaimLostError";
  }
}

export function buildProductImagePrompt(input: {
  hasReference: boolean;
  description: string;
  preset: ProductImagePreset;
  aspectRatio: ProductImageAspectRatio;
  resultCount: number;
}): string {
  const preset = PRODUCT_IMAGE_PRESETS[input.preset];
  const shared = [
    "Create a production-ready commercial product photograph.",
    `Art direction: ${preset.instruction}.`,
    `Composition: ${input.aspectRatio} frame, product is the unmistakable focal point, physically plausible perspective and shadows.`,
    `Customer direction: ${input.description.trim()}.`,
    "Return one commercially useful result.",
    "Do not add claims, badges, prices, watermarks, extra products, people, hands, invented logos, or invented readable text unless explicitly requested.",
    "Avoid warped geometry, duplicate parts, floating objects, broken packaging, illegible labels, and surreal reflections.",
  ];
  if (input.hasReference) {
    shared.unshift(
      "The supplied reference image is the sole visual source of truth.",
      "Preserve the exact product identity, count, geometry, proportions, color, material, packaging, logo, label placement, and visible construction details.",
      "Only improve background, lighting, shadow, crop, framing, and minor photographic cleanup. Never redesign or replace the product.",
    );
  } else {
    shared.unshift(
      "Render a truthful product concept from the customer's written description; do not invent brand identity or regulated performance claims.",
    );
  }
  return shared.join("\n");
}

export async function findProductImageJobForUser(
  id: string,
  userId: string,
): Promise<ProductImageJobWithAssets | null> {
  return db.productImageJob.findFirst({ where: { id, userId }, include: assetInclude });
}

export async function findProductImageResultForUser(
  id: string,
  userId: string,
): Promise<ProductImageResultWithOwner | null> {
  return db.productImageResult.findFirst({
    where: {
      id,
      productImageJob: { userId, status: ProductImageStatus.SUCCEEDED },
    },
    include: {
      asset: true,
      productImageJob: { select: { id: true, userId: true, status: true } },
    },
  });
}

export async function listProductImageJobsForUser(
  userId: string,
  take = 24,
): Promise<ProductImageJobWithAssets[]> {
  return db.productImageJob.findMany({
    where: { userId },
    include: assetInclude,
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(take, 50)),
  });
}

function stableProviderRequestKey(): string {
  return `product-image-${randomUUID()}`;
}

export async function createProductImageJob(
  input: ProductImageRequest,
): Promise<ProductImageJobWithAssets> {
  const existing = await db.productImageJob.findUnique({
    where: {
      userId_idempotencyKey: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    include: assetInclude,
  });
  if (existing) return existing;
  if (!Number.isInteger(input.resultCount) || input.resultCount < 1 || input.resultCount > 4) {
    throw new ProductImageRequestError("一次可生成 1–4 张产品图。", "INVALID_RESULT_COUNT");
  }

  const mode: ProductImageMode = input.sourceAsset ? "OPTIMIZE" : "GENERATE";
  const taskRequests = Array.from({ length: input.resultCount }, (_, ordinal) => ({
    ordinal,
    requestKey: stableProviderRequestKey(),
  }));
  let job: ProductImageJobWithAssets;
  try {
    job = await db.productImageJob.create({
      data: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        providerRequestKey: taskRequests[0]?.requestKey,
        provider: "shuyu",
        mode,
        prompt: input.prompt,
        preset: input.preset,
        aspectRatio: input.aspectRatio,
        quality: input.resolution,
        resolutionSnapshot: input.resolution,
        resultCount: input.resultCount,
        pointsSnapshot: 0,
        model: "pending-shuyu-image-2-audit",
        sourceAssetId: input.sourceAsset?.id,
        sourceImageUrl: input.sourceAsset?.url,
        sourceMimeType: input.sourceAsset?.mimeType,
        providerTasks: {
          create: taskRequests.map(({ ordinal, requestKey }) => ({
            ordinal,
            requestKey,
            resolutionSnapshot: input.resolution,
          })),
        },
      },
      include: assetInclude,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await db.productImageJob.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: input.userId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        include: assetInclude,
      });
      if (duplicate) return duplicate;
    }
    throw error;
  }

  await db.productImageJob.updateMany({
    where: { id: job.id, userId: input.userId, status: ProductImageStatus.QUEUED },
    data: { status: ProductImageStatus.PROCESSING, startedAt: new Date() },
  });
  for (const task of job.providerTasks) {
    await submitProductImageProviderTask(task.id, input);
  }
  await refreshProductImageJob(job.id);
  return (await findProductImageJobForUser(job.id, input.userId)) ?? job;
}

async function submitProductImageProviderTask(
  taskId: string,
  input?: ProductImageRequest,
  allowRejected = false,
  alreadyClaimed = false,
): Promise<void> {
  const task = await db.productImageProviderTask.findUnique({
    where: { id: taskId },
    include: {
      result: { include: { asset: true } },
      productImageJob: {
        include: { sourceAsset: true, outputs: { include: { asset: true } } },
      },
    },
  });
  if (!task || task.result || task.submissionState === ProviderSubmissionState.ACK_UNKNOWN) return;
  const allowedStates: ProviderSubmissionState[] = allowRejected
    ? [ProviderSubmissionState.REJECTED]
    : [ProviderSubmissionState.NOT_STARTED];
  if (
    alreadyClaimed
      ? task.submissionState !== ProviderSubmissionState.SUBMITTING
      : !allowedStates.includes(task.submissionState)
  ) return;

  if (!alreadyClaimed) {
    const claimed = await db.productImageProviderTask.updateMany({
      where: {
        id: task.id,
        requestKey: task.requestKey,
        status: { in: [ProductImageStatus.QUEUED, ProductImageStatus.FAILED] },
        submissionState: { in: allowedStates },
      },
      data: {
        status: ProductImageStatus.PROCESSING,
        submissionState: ProviderSubmissionState.SUBMITTING,
        submissionErrorClass: null,
        submittedAt: new Date(),
        submitAttempts: { increment: 1 },
        completedAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (claimed.count !== 1) return;
  }

  const job = task.productImageJob;
  const request: ProductImageRequest = input ?? {
    userId: job.userId,
    idempotencyKey: job.idempotencyKey,
    prompt: job.prompt,
    preset: job.preset as ProductImagePreset,
    aspectRatio: job.aspectRatio as ProductImageAspectRatio,
    resolution: (task.resolutionSnapshot ?? job.resolutionSnapshot ?? job.quality) as ShuyuResolution,
    resultCount: job.resultCount,
  };
  // The URL snapshot is the immutable provider input. The related asset may be
  // deleted later (onDelete: SetNull), but a confirmed retry must replay the
  // exact original paid request under the same request key.
  const sourceImageUrl = job.sourceImageUrl ?? input?.sourceAsset?.url ?? job.sourceAsset?.url;
  const prompt = buildProductImagePrompt({
    hasReference: Boolean(sourceImageUrl),
    description: request.prompt,
    preset: request.preset,
    aspectRatio: request.aspectRatio,
    resultCount: 1,
  });
  let providerAcknowledged = false;
  try {
    const submitted = await runtimeDependencies().submitTask({
      requestKey: task.requestKey,
      prompt,
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
      inputImages: sourceImageUrl ? [sourceImageUrl] : [],
      planSnapshot:
        task.planId && task.modelSnapshot && task.resolutionSnapshot && task.pointsSnapshot !== null
          ? {
              planId: task.planId,
              model: task.modelSnapshot,
              resolution: task.resolutionSnapshot as ShuyuResolution,
              points: task.pointsSnapshot,
              family: "gpt-image-2",
            }
          : undefined,
      onPlanSelected: async (plan) => {
        await db.$transaction(async (tx) => {
          const persisted = await tx.productImageProviderTask.updateMany({
            where: {
              id: task.id,
              requestKey: task.requestKey,
              submissionState: ProviderSubmissionState.SUBMITTING,
            },
            data: {
              planId: plan.planId,
              modelSnapshot: plan.model,
              resolutionSnapshot: plan.resolution,
              pointsSnapshot: plan.points,
            },
          });
          if (persisted.count !== 1) throw new ProductImageLeaseLostError();
          await tx.productImageJob.update({
            where: { id: job.id },
            data: {
              ...(task.ordinal === 0
                ? {
                    planId: plan.planId,
                    model: plan.model,
                    modelSnapshot: plan.model,
                    resolutionSnapshot: plan.resolution,
                  }
                : {}),
              ...(task.pointsSnapshot === null
                ? { pointsSnapshot: { increment: plan.points } }
                : {}),
            },
          });
        });
      },
    });
    providerAcknowledged = true;
    const persisted = await db.productImageProviderTask.updateMany({
      where: {
        id: task.id,
        requestKey: task.requestKey,
        submissionState: ProviderSubmissionState.SUBMITTING,
      },
      data: {
        externalTaskId: submitted.externalTaskId,
        submissionState: ProviderSubmissionState.ACCEPTED,
        status: ProductImageStatus.PROCESSING,
        lastProviderStatus: "queued",
        lastCheckedAt: new Date(),
        pollErrors: 0,
      },
    });
    if (persisted.count !== 1) throw new Error("provider acknowledgement could not be persisted");
    if (task.ordinal === 0) {
      await db.productImageJob.updateMany({
        where: { id: job.id },
        data: {
          externalTaskId: submitted.externalTaskId,
          lastProviderStatus: "queued",
          lastCheckedAt: new Date(),
        },
      });
    }
  } catch (error) {
    const failure = classifyProductImageSubmission(error, providerAcknowledged);
    const acknowledgementUnknown = failure.disposition === "acknowledgement_unknown";
    await db.productImageProviderTask.updateMany({
      where: {
        id: task.id,
        requestKey: task.requestKey,
        submissionState: ProviderSubmissionState.SUBMITTING,
      },
      data: {
        status: ProductImageStatus.FAILED,
        submissionState: acknowledgementUnknown
          ? ProviderSubmissionState.ACK_UNKNOWN
          : ProviderSubmissionState.REJECTED,
        submissionErrorClass: `${failure.disposition}:${failure.stage}`,
        completedAt: new Date(),
        errorCode: acknowledgementUnknown ? "SUBMISSION_ACK_UNKNOWN" : "PROVIDER_REJECTED",
        errorMessage: acknowledgementUnknown
          ? "Shuyu 可能已接收任务。为避免重复计费，系统不会自动重提，请联系管理员核对。"
          : "Shuyu 明确拒绝了任务；可使用相同请求标识安全重试。",
      },
    });
  }
}

export async function retryRejectedProductImageProviderTask(
  taskId: string,
  userId: string,
): Promise<ProductImageJobWithAssets | null> {
  let task: { id: string; productImageJobId: string } | null;
  try {
    task = await db.$transaction(async (tx) => {
      const eligible = await tx.productImageProviderTask.findFirst({
        where: {
          id: taskId,
          status: ProductImageStatus.FAILED,
          submissionState: ProviderSubmissionState.REJECTED,
          productImageJob: { userId },
        },
        select: { id: true, productImageJobId: true, requestKey: true },
      });
      if (!eligible) return null;
      const reactivated = await tx.productImageJob.updateMany({
        where: {
          id: eligible.productImageJobId,
          userId,
          status: { in: [ProductImageStatus.FAILED, ProductImageStatus.PROCESSING] },
        },
        data: {
          status: ProductImageStatus.PROCESSING,
          completedAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (reactivated.count !== 1) throw new ProductImageRetryClaimLostError();
      const claimed = await tx.productImageProviderTask.updateMany({
        where: {
          id: eligible.id,
          requestKey: eligible.requestKey,
          status: ProductImageStatus.FAILED,
          submissionState: ProviderSubmissionState.REJECTED,
        },
        data: {
          status: ProductImageStatus.PROCESSING,
          submissionState: ProviderSubmissionState.SUBMITTING,
          submissionErrorClass: null,
          submittedAt: new Date(),
          submitAttempts: { increment: 1 },
          completedAt: null,
          errorCode: null,
          errorMessage: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (claimed.count !== 1) throw new ProductImageRetryClaimLostError();
      return { id: eligible.id, productImageJobId: eligible.productImageJobId };
    });
  } catch (error) {
    if (error instanceof ProductImageRetryClaimLostError) return null;
    throw error;
  }
  if (!task) return null;
  await submitProductImageProviderTask(task.id, undefined, false, true);
  await refreshProductImageJob(task.productImageJobId);
  return findProductImageJobForUser(task.productImageJobId, userId);
}

function classifyProductImageSubmission(
  error: unknown,
  providerAcknowledged: boolean,
): ProviderSubmissionError {
  return asProviderSubmissionError({
    error,
    providerId: "shuyu",
    evidence: providerAcknowledged ? { stage: "persistence" } : undefined,
  });
}

export async function reconcileProductImageJob(
  jobId: string,
  userId?: string,
): Promise<ProductImageJobWithAssets | null> {
  const job = userId
    ? await findProductImageJobForUser(jobId, userId)
    : await db.productImageJob.findUnique({ where: { id: jobId }, include: assetInclude });
  if (!job || job.status !== ProductImageStatus.PROCESSING) return job;

  for (const task of job.providerTasks) {
    if (
      task.status === ProductImageStatus.PROCESSING &&
      task.submissionState === ProviderSubmissionState.ACCEPTED &&
      task.externalTaskId
    ) {
      await reconcileProductImageProviderTask(task.id);
    }
  }
  await refreshProductImageJob(job.id);
  return userId
    ? findProductImageJobForUser(job.id, userId)
    : db.productImageJob.findUnique({ where: { id: job.id }, include: assetInclude });
}

async function claimProductImageProviderTask(
  taskId: string,
  leaseOwner: string = randomUUID(),
  now = new Date(),
): Promise<ProviderTaskWithJob | null> {
  const claimed = await db.productImageProviderTask.updateMany({
    where: {
      id: taskId,
      status: ProductImageStatus.PROCESSING,
      submissionState: ProviderSubmissionState.ACCEPTED,
      externalTaskId: { not: null },
      OR: [{ leaseOwner: null }, { leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
    },
    data: {
      leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + PROVIDER_TASK_LEASE_MS),
    },
  });
  if (claimed.count !== 1) return null;
  return db.productImageProviderTask.findFirst({
    where: { id: taskId, leaseOwner, leaseExpiresAt: { gt: now } },
    include: {
      result: { include: { asset: true } },
      productImageJob: {
        include: { sourceAsset: true, outputs: { include: { asset: true } } },
      },
    },
  });
}

async function reconcileProductImageProviderTask(taskId: string): Promise<void> {
  const leaseOwner = randomUUID();
  const task = await claimProductImageProviderTask(taskId, leaseOwner);
  if (!task?.externalTaskId) return;
  let providerResult: Awaited<ReturnType<typeof pollShuyuImageTask>>;
  try {
    providerResult = await runtimeDependencies().pollTask(task.externalTaskId);
  } catch {
    const pollErrors = task.pollErrors + 1;
    const mutationTime = new Date();
    await db.productImageProviderTask.updateMany({
      where: {
        id: task.id,
        leaseOwner,
        leaseExpiresAt: { gt: mutationTime },
        status: ProductImageStatus.PROCESSING,
      },
      data: {
        pollErrors,
        lastCheckedAt: mutationTime,
        leaseOwner: null,
        leaseExpiresAt: null,
        ...(pollErrors >= MAX_POLL_ERRORS
          ? {
              status: ProductImageStatus.FAILED,
              completedAt: new Date(),
              errorCode: "POLL_UNAVAILABLE",
              errorMessage: "暂时无法获取产品图生成进度，请稍后重试。",
            }
          : {}),
      },
    });
    await refreshProductImageJob(task.productImageJobId);
    return;
  }

  if (providerResult.status === "queued" || providerResult.status === "processing") {
    const mutationTime = new Date();
    await db.productImageProviderTask.updateMany({
      where: {
        id: task.id,
        leaseOwner,
        leaseExpiresAt: { gt: mutationTime },
        status: ProductImageStatus.PROCESSING,
      },
      data: {
        lastProviderStatus: providerResult.rawStatus,
        lastCheckedAt: mutationTime,
        pollErrors: 0,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return;
  }

  if (providerResult.status === "failed") {
    const mutationTime = new Date();
    await db.productImageProviderTask.updateMany({
      where: {
        id: task.id,
        leaseOwner,
        leaseExpiresAt: { gt: mutationTime },
        status: ProductImageStatus.PROCESSING,
      },
      data: {
        status: ProductImageStatus.FAILED,
        lastProviderStatus: providerResult.rawStatus,
        lastCheckedAt: mutationTime,
        completedAt: mutationTime,
        errorCode: "PROVIDER_FAILED",
        errorMessage: "Shuyu 产品图生成失败，参考素材与设置已保留。",
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    await refreshProductImageJob(task.productImageJobId);
    return;
  }

  try {
    if (!task.result) {
      const outputUrl = providerResult.outputUrls[0];
      if (!outputUrl) throw new Error("Shuyu completed the task without an image output");
      const renewalTime = new Date();
      const renewed = await db.productImageProviderTask.updateMany({
        where: {
          id: task.id,
          leaseOwner,
          leaseExpiresAt: { gt: renewalTime },
          status: ProductImageStatus.PROCESSING,
        },
        data: { leaseExpiresAt: new Date(renewalTime.getTime() + PROVIDER_TASK_LEASE_MS) },
      });
      if (renewed.count !== 1) throw new ProductImageLeaseLostError();
      await persistProviderTaskOutput(task, leaseOwner, outputUrl, providerResult.rawStatus);
    } else {
      const mutationTime = new Date();
      await db.productImageProviderTask.updateMany({
        where: {
          id: task.id,
          leaseOwner,
          leaseExpiresAt: { gt: mutationTime },
          status: ProductImageStatus.PROCESSING,
        },
        data: {
          status: ProductImageStatus.SUCCEEDED,
          lastProviderStatus: providerResult.rawStatus,
          lastCheckedAt: mutationTime,
          completedAt: mutationTime,
          pollErrors: 0,
          errorCode: null,
          errorMessage: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    }
  } catch (error) {
    if (!(error instanceof ProductImageLeaseLostError)) {
      const safe = safeProductImageError(error);
      const mutationTime = new Date();
      await db.productImageProviderTask.updateMany({
        where: {
          id: task.id,
          leaseOwner,
          leaseExpiresAt: { gt: mutationTime },
          status: ProductImageStatus.PROCESSING,
        },
        data: {
          status: ProductImageStatus.FAILED,
          completedAt: mutationTime,
          errorCode: safe.code,
          errorMessage: safe.message,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    }
  }
  await refreshProductImageJob(task.productImageJobId);
}

async function persistProviderTaskOutput(
  task: ProviderTaskWithJob,
  leaseOwner: string,
  outputUrl: string,
  rawProviderStatus = "completed",
): Promise<void> {
  const runtime = runtimeDependencies();
  const generated = await runtime.fetchOutputImage(outputUrl);
  const storage = runtime.getStorageProvider();
  if (!storage.isConfigured()) throw new Error("产品图存储暂不可用");
  const key = `product-images/${task.productImageJob.userId}/${task.productImageJobId}/output-${task.ordinal}-${randomUUID()}.${extensionForImageMime(generated.mimeType)}`;
  const persisted = await storage.uploadBuffer("renders", generated.bytes, {
    key,
    access: "public",
    contentType: generated.mimeType,
    overwrite: false,
  });
  let asset: MediaAsset | null = null;
  try {
    asset = await runtime.createOwnedAsset({
      userId: task.productImageJob.userId,
      storageKey: persisted.key,
      url: persisted.url,
      mimeType: generated.mimeType,
      bytes: generated.bytes,
    });
    await db.$transaction(async (tx) => {
      const mutationTime = new Date();
      const ownsLease = await tx.productImageProviderTask.updateMany({
        where: {
          id: task.id,
          leaseOwner,
          status: ProductImageStatus.PROCESSING,
          leaseExpiresAt: { gt: mutationTime },
        },
        data: {
          status: ProductImageStatus.SUCCEEDED,
          lastProviderStatus: rawProviderStatus,
          lastCheckedAt: mutationTime,
          completedAt: mutationTime,
          pollErrors: 0,
          errorCode: null,
          errorMessage: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (ownsLease.count !== 1) throw new ProductImageLeaseLostError();
      await tx.productImageResult.create({
        data: {
          productImageJobId: task.productImageJobId,
          providerTaskId: task.id,
          assetId: asset!.id,
          position: task.ordinal,
          outputImageUrl: asset!.url,
        },
      });
    });
  } catch (error) {
    if (asset) {
      const removed = await db.mediaAsset.deleteMany({
        where: { id: asset.id, productImageResults: { none: {} } },
      }).catch(() => ({ count: 0 }));
      if (removed.count === 1) {
        await storage.deleteObject("renders", persisted.key).catch(() => undefined);
      }
    } else {
      await storage.deleteObject("renders", persisted.key).catch(() => undefined);
    }
    throw error;
  }
}

async function refreshProductImageJob(jobId: string): Promise<void> {
  const job = await db.productImageJob.findUnique({
    where: { id: jobId },
    include: assetInclude,
  });
  if (!job || job.providerTasks.length === 0) return;
  const ackUnknown = job.providerTasks.find(
    (task) => task.submissionState === ProviderSubmissionState.ACK_UNKNOWN,
  );
  const failed = job.providerTasks.find((task) => task.status === ProductImageStatus.FAILED);
  const allTerminal = job.providerTasks.every(
    (task) =>
      task.status === ProductImageStatus.SUCCEEDED ||
      task.status === ProductImageStatus.FAILED,
  );
  const exactSuccess =
    job.providerTasks.length === job.resultCount &&
    job.providerTasks.every((task) => task.status === ProductImageStatus.SUCCEEDED) &&
    job.outputs.length === job.resultCount;

  if (exactSuccess) {
    const primary = job.outputs[0];
    if (!primary) return;
    const completed = await db.productImageJob.updateMany({
      where: { id: job.id, status: ProductImageStatus.PROCESSING },
      data: {
        status: ProductImageStatus.SUCCEEDED,
        outputImageUrl: primary.outputImageUrl,
        outputAssetId: primary.assetId,
        completedAt: new Date(),
        lastCheckedAt: new Date(),
        lastProviderStatus: "completed",
        pollErrors: 0,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (completed.count === 1) {
      await recordProductImageUsage(job.id, job.userId, "SUCCESS");
    }
    return;
  }
  if ((ackUnknown || failed) && allTerminal) {
    const errorCode = ackUnknown ? "SUBMISSION_ACK_UNKNOWN" : failed?.errorCode ?? "PROVIDER_FAILED";
    const completed = await db.productImageJob.updateMany({
      where: { id: job.id, status: ProductImageStatus.PROCESSING },
      data: {
        status: ProductImageStatus.FAILED,
        completedAt: new Date(),
        errorCode,
        errorMessage: ackUnknown
          ? "生成服务可能已接收部分任务。为避免重复计费，系统不会自动重提；请联系管理员核对。"
          : failed?.errorMessage ?? "Shuyu 产品图生成失败，参考素材与设置已保留。",
      },
    });
    if (completed.count === 1) {
      await recordProductImageUsage(job.id, job.userId, "FAILED", errorCode);
    }
  }
}

async function recordProductImageUsage(
  jobId: string,
  userId: string,
  status: "SUCCESS" | "FAILED",
  errorMessage?: string,
): Promise<void> {
  const job = await db.productImageJob.findUnique({ where: { id: jobId } });
  await recordAIUsage({
    feature: "product_image_studio",
    provider: "shuyu",
    model: job?.modelSnapshot ?? job?.model ?? "shuyu-image-2",
    actorUserId: userId,
    inputSummary: `${job?.mode ?? "unknown"}/${job?.preset ?? "unknown"}/${job?.aspectRatio ?? "unknown"}`,
    outputSummary: `productImageJobId=${jobId}`,
    promptVersion: PRODUCT_IMAGE_PROMPT_VERSION,
    status,
    errorMessage,
  }).catch(() => undefined);
}

function extensionForImageMime(mimeType: string): "png" | "jpg" | "webp" {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function safeProductImageError(error: unknown): { code: string; message: string } {
  if (error instanceof ProductImageRequestError) {
    return { code: error.code, message: error.message };
  }
  console.error("[product-image] Shuyu workflow failure", {
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
  });
  return {
    code: "PROVIDER_UNAVAILABLE",
    message: "Shuyu 产品图暂时生成失败，参考素材与设置已保留。请稍后重试。",
  };
}

async function failStaleSubmittingTasks(now: Date): Promise<number> {
  const stale = new Date(now.getTime() - SUBMITTING_STALE_MS);
  const tasks = await db.productImageProviderTask.findMany({
    where: {
      submissionState: ProviderSubmissionState.SUBMITTING,
      submittedAt: { lte: stale },
    },
    select: { id: true, productImageJobId: true, requestKey: true },
    take: 50,
  });
  let failed = 0;
  for (const task of tasks) {
    const updated = await db.productImageProviderTask.updateMany({
      where: {
        id: task.id,
        requestKey: task.requestKey,
        submissionState: ProviderSubmissionState.SUBMITTING,
        submittedAt: { lte: stale },
      },
      data: {
        status: ProductImageStatus.FAILED,
        submissionState: ProviderSubmissionState.ACK_UNKNOWN,
        submissionErrorClass: "acknowledgement_unknown:submission_timeout",
        completedAt: now,
        errorCode: "SUBMISSION_ACK_UNKNOWN",
        errorMessage: "提交确认丢失；为避免重复计费，系统不会自动重提。",
      },
    });
    if (updated.count === 1) {
      failed++;
      await refreshProductImageJob(task.productImageJobId);
    }
  }
  return failed;
}

export async function pollPendingProductImageJobs(limit = 20): Promise<{
  polled: number;
}> {
  const now = new Date();
  await failStaleSubmittingTasks(now);
  const unsubmitted = await db.productImageProviderTask.findMany({
    where: {
      status: ProductImageStatus.QUEUED,
      submissionState: ProviderSubmissionState.NOT_STARTED,
      productImageJob: { status: ProductImageStatus.PROCESSING },
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 50)),
    select: { id: true },
  });
  for (const task of unsubmitted) await submitProductImageProviderTask(task.id);

  const tasks = await db.productImageProviderTask.findMany({
    where: {
      status: ProductImageStatus.PROCESSING,
      submissionState: ProviderSubmissionState.ACCEPTED,
      externalTaskId: { not: null },
      productImageJob: { status: ProductImageStatus.PROCESSING },
      OR: [{ leaseOwner: null }, { leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
    },
    orderBy: { lastCheckedAt: "asc" },
    take: Math.max(1, Math.min(limit, 50)),
    select: { id: true },
  });
  for (const task of tasks) await reconcileProductImageProviderTask(task.id);
  return { polled: tasks.length };
}

export const __test__ = {
  safeProductImageError,
  classifyProductImageSubmission,
  claimProductImageProviderTask,
  reconcileProductImageProviderTask,
  submitProductImageProviderTask,
  refreshProductImageJob,
  failStaleSubmittingTasks,
  persistProviderTaskOutput,
  __setRuntimeDependenciesForTests(
    dependencies: Partial<ProductImageRuntimeDependencies> | null,
  ) {
    runtimeOverride = dependencies;
  },
};
