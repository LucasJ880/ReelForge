import { randomUUID } from "node:crypto";
import type {
  MediaAsset,
  ProductImageJob,
  ProductImageMode,
  ProductImageResult,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
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

export const PRODUCT_IMAGE_PROMPT_VERSION = "product-image-shuyu-v2";
const MAX_POLL_ERRORS = 3;

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

type ProductImageResultWithAsset = ProductImageResult & { asset: MediaAsset };
export type ProductImageJobWithAssets = ProductImageJob & {
  sourceAsset: MediaAsset | null;
  outputs: ProductImageResultWithAsset[];
};

const assetInclude = {
  sourceAsset: true,
  outputs: { include: { asset: true }, orderBy: { position: "asc" as const } },
} as const;

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
    input.resultCount > 1
      ? `Return up to ${input.resultCount} distinct, commercially useful variations while preserving the same product identity.`
      : "Return one commercially useful result.",
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

function providerRequestKey(): string {
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
  const requestKey = providerRequestKey();
  let job: ProductImageJobWithAssets;
  try {
    job = await db.productImageJob.create({
      data: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        providerRequestKey: requestKey,
        provider: "shuyu",
        mode,
        prompt: input.prompt,
        preset: input.preset,
        aspectRatio: input.aspectRatio,
        quality: input.resolution,
        resolutionSnapshot: input.resolution,
        resultCount: input.resultCount,
        model: "pending-shuyu-image-2-audit",
        sourceAssetId: input.sourceAsset?.id,
        sourceImageUrl: input.sourceAsset?.url,
        sourceMimeType: input.sourceAsset?.mimeType,
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

  const claimed = await db.productImageJob.updateMany({
    where: { id: job.id, userId: input.userId, status: "QUEUED" },
    data: { status: "PROCESSING", startedAt: new Date() },
  });
  if (claimed.count !== 1) {
    return (await findProductImageJobForUser(job.id, input.userId)) ?? job;
  }

  const prompt = buildProductImagePrompt({
    hasReference: Boolean(input.sourceAsset),
    description: input.prompt,
    preset: input.preset,
    aspectRatio: input.aspectRatio,
    resultCount: input.resultCount,
  });
  try {
    const submitted = await runtimeDependencies().submitTask({
      requestKey,
      prompt,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      inputImages: input.sourceAsset ? [input.sourceAsset.url] : [],
      onPlanSelected: async (plan) => {
        await db.productImageJob.update({
          where: { id: job.id },
          data: {
            planId: plan.planId,
            model: plan.model,
            modelSnapshot: plan.model,
            resolutionSnapshot: plan.resolution,
            pointsSnapshot: plan.points,
          },
        });
      },
    });
    await db.productImageJob.update({
      where: { id: job.id },
      data: {
        externalTaskId: submitted.externalTaskId,
        lastProviderStatus: "queued",
        lastCheckedAt: new Date(),
      },
    });
    return (await findProductImageJobForUser(job.id, input.userId)) ?? job;
  } catch (error) {
    const safe = safeProductImageError(error);
    await db.productImageJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: safe.code,
        errorMessage: safe.message,
      },
    });
    await recordProductImageUsage(job.id, input.userId, "FAILED", safe.code);
    return (await findProductImageJobForUser(job.id, input.userId)) ?? job;
  }
}

export async function reconcileProductImageJob(
  jobId: string,
  userId?: string,
): Promise<ProductImageJobWithAssets | null> {
  const job = userId
    ? await findProductImageJobForUser(jobId, userId)
    : await db.productImageJob.findUnique({ where: { id: jobId }, include: assetInclude });
  if (!job || job.status !== "PROCESSING" || !job.externalTaskId) return job;

  let providerResult: Awaited<ReturnType<typeof pollShuyuImageTask>>;
  try {
    providerResult = await runtimeDependencies().pollTask(job.externalTaskId);
  } catch (error) {
    const pollErrors = job.pollErrors + 1;
    await db.productImageJob.update({
      where: { id: job.id },
      data: {
        pollErrors,
        lastCheckedAt: new Date(),
        ...(pollErrors >= MAX_POLL_ERRORS
          ? {
              status: "FAILED" as const,
              completedAt: new Date(),
              errorCode: "POLL_UNAVAILABLE",
              errorMessage: "暂时无法获取产品图生成进度，请稍后重试。",
            }
          : {}),
      },
    });
    return userId
      ? findProductImageJobForUser(job.id, userId)
      : db.productImageJob.findUnique({ where: { id: job.id }, include: assetInclude });
  }

  if (providerResult.status === "queued" || providerResult.status === "processing") {
    await db.productImageJob.update({
      where: { id: job.id },
      data: {
        lastProviderStatus: providerResult.rawStatus,
        lastCheckedAt: new Date(),
        pollErrors: 0,
      },
    });
    return userId
      ? findProductImageJobForUser(job.id, userId)
      : db.productImageJob.findUnique({ where: { id: job.id }, include: assetInclude });
  }

  if (providerResult.status === "failed") {
    await db.productImageJob.updateMany({
      where: { id: job.id, status: "PROCESSING" },
      data: {
        status: "FAILED",
        lastProviderStatus: providerResult.rawStatus,
        lastCheckedAt: new Date(),
        completedAt: new Date(),
        errorCode: "PROVIDER_FAILED",
        errorMessage: "Shuyu 产品图生成失败，参考素材与设置已保留。",
      },
    });
    await recordProductImageUsage(job.id, job.userId, "FAILED", "PROVIDER_FAILED");
    return userId
      ? findProductImageJobForUser(job.id, userId)
      : db.productImageJob.findUnique({ where: { id: job.id }, include: assetInclude });
  }

  const claimedAt = new Date();
  const claimed = await db.productImageJob.updateMany({
    where: { id: job.id, status: "PROCESSING", lastCheckedAt: job.lastCheckedAt },
    data: { lastCheckedAt: claimedAt, lastProviderStatus: providerResult.rawStatus },
  });
  if (claimed.count !== 1) {
    return userId
      ? findProductImageJobForUser(job.id, userId)
      : db.productImageJob.findUnique({ where: { id: job.id }, include: assetInclude });
  }

  try {
    const existingPositions = new Set(job.outputs.map((output) => output.position));
    const selectedUrls = providerResult.outputUrls.slice(0, job.resultCount);
    for (const [position, outputUrl] of selectedUrls.entries()) {
      if (existingPositions.has(position)) continue;
      await persistOutput(job, position, outputUrl);
    }
    const outputs = await db.productImageResult.findMany({
      where: { productImageJobId: job.id },
      include: { asset: true },
      orderBy: { position: "asc" },
    });
    if (outputs.length === 0) throw new Error("Shuyu returned no persistable image output");
    const primary = outputs[0];
    await db.productImageJob.updateMany({
      where: { id: job.id, status: "PROCESSING" },
      data: {
        status: "SUCCEEDED",
        outputImageUrl: primary.outputImageUrl,
        outputAssetId: primary.assetId,
        completedAt: new Date(),
        lastCheckedAt: new Date(),
        lastProviderStatus: providerResult.rawStatus,
        pollErrors: 0,
        errorCode: null,
        errorMessage: null,
      },
    });
    await recordProductImageUsage(job.id, job.userId, "SUCCESS");
  } catch (error) {
    const safe = safeProductImageError(error);
    await db.productImageJob.updateMany({
      where: { id: job.id, status: "PROCESSING" },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: safe.code,
        errorMessage: safe.message,
      },
    });
    await recordProductImageUsage(job.id, job.userId, "FAILED", safe.code);
  }
  return userId
    ? findProductImageJobForUser(job.id, userId)
    : db.productImageJob.findUnique({ where: { id: job.id }, include: assetInclude });
}

async function persistOutput(
  job: ProductImageJobWithAssets,
  position: number,
  outputUrl: string,
): Promise<void> {
  const runtime = runtimeDependencies();
  const generated = await runtime.fetchOutputImage(outputUrl);
  const storage = runtime.getStorageProvider();
  if (!storage.isConfigured()) throw new Error("产品图存储暂不可用");
  const key = `product-images/${job.userId}/${job.id}/output-${position}-${randomUUID()}.${extensionForImageMime(generated.mimeType)}`;
  const persisted = await storage.uploadBuffer("renders", generated.bytes, {
    key,
    access: "public",
    contentType: generated.mimeType,
    overwrite: false,
  });
  let assetDurable = false;
  try {
    const asset = await runtime.createOwnedAsset({
      userId: job.userId,
      storageKey: persisted.key,
      url: persisted.url,
      mimeType: generated.mimeType,
      bytes: generated.bytes,
    });
    assetDurable = true;
    await db.productImageResult.create({
      data: {
        productImageJobId: job.id,
        assetId: asset.id,
        position,
        outputImageUrl: asset.url,
      },
    });
  } catch (error) {
    if (!assetDurable) {
      await storage.deleteObject("renders", persisted.key).catch(() => undefined);
    }
    throw error;
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

export async function pollPendingProductImageJobs(limit = 20): Promise<{
  polled: number;
}> {
  const jobs = await db.productImageJob.findMany({
    where: { status: "PROCESSING", externalTaskId: { not: null } },
    orderBy: { lastCheckedAt: "asc" },
    take: Math.max(1, Math.min(limit, 50)),
    select: { id: true },
  });
  for (const job of jobs) await reconcileProductImageJob(job.id);
  return { polled: jobs.length };
}

export const __test__ = {
  safeProductImageError,
  persistOutput,
  __setRuntimeDependenciesForTests(
    dependencies: Partial<ProductImageRuntimeDependencies> | null,
  ) {
    runtimeOverride = dependencies;
  },
};
