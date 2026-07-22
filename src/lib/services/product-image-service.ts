import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type {
  ProductImageJob,
  ProductImageMode,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { getAiProvider } from "@/lib/ai";
import {
  ContentReviewRejectedError,
  classifyContentReviewFailure,
  reviewMediaOrThrow,
  reviewTextOrThrow,
} from "@/lib/content-review";
import { db } from "@/lib/db";
import { recordAIUsage } from "@/lib/services/ai-usage-log-service";
import { createOwnedMediaAsset } from "@/lib/services/media-asset-service";
import { getStorageProvider } from "@/lib/storage";

export const PRODUCT_IMAGE_PROMPT_VERSION = "product-image-v1";
const DEFAULT_PRODUCT_IMAGE_MODEL = "gpt-image-2";
const MAX_GENERATED_IMAGE_BYTES = 25 * 1024 * 1024;
type ImageQuality = "auto" | "low" | "medium" | "high";

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
export type ProductImageAspectRatio = "1:1" | "4:5" | "9:16" | "16:9";

const SIZE_BY_ASPECT: Record<ProductImageAspectRatio, "1024x1024" | "1024x1536" | "1536x1024"> = {
  "1:1": "1024x1024",
  "4:5": "1024x1536",
  "9:16": "1024x1536",
  "16:9": "1536x1024",
};

export interface ProductImageRequest {
  userId: string;
  idempotencyKey: string;
  mode: ProductImageMode;
  prompt: string;
  preset: ProductImagePreset;
  aspectRatio: ProductImageAspectRatio;
  quality: ImageQuality;
  sourceImage?: {
    url: string;
    mimeType: string;
    data: Buffer;
    fileName: string;
  };
}

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
  mode: ProductImageMode;
  description: string;
  preset: ProductImagePreset;
  aspectRatio: ProductImageAspectRatio;
}): string {
  const preset = PRODUCT_IMAGE_PRESETS[input.preset];
  const shared = [
    "Create one production-ready commercial product photograph.",
    `Art direction: ${preset.instruction}.`,
    `Composition: ${input.aspectRatio} frame, product is the unmistakable focal point, physically plausible perspective and shadows.`,
    `Customer direction: ${input.description.trim()}.`,
    "Do not add claims, badges, prices, watermarks, extra products, people, hands, invented logos, or invented readable text unless explicitly requested.",
    "Avoid warped geometry, duplicate parts, floating objects, broken packaging, illegible labels, and surreal reflections.",
  ];

  if (input.mode === "OPTIMIZE") {
    shared.unshift(
      "The uploaded source image is the sole visual source of truth.",
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
): Promise<ProductImageJob | null> {
  return db.productImageJob.findFirst({ where: { id, userId } });
}

export async function listProductImageJobsForUser(
  userId: string,
  take = 24,
): Promise<ProductImageJob[]> {
  return db.productImageJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(take, 50)),
  });
}

export async function createProductImageJob(
  input: ProductImageRequest,
): Promise<ProductImageJob> {
  const existing = await db.productImageJob.findUnique({
    where: {
      userId_idempotencyKey: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) return existing;

  if (input.mode === "OPTIMIZE" && !input.sourceImage) {
    throw new ProductImageRequestError(
      "优化产品图需要上传一张原始产品照片。",
      "SOURCE_IMAGE_REQUIRED",
    );
  }

  const model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_PRODUCT_IMAGE_MODEL;
  let job: ProductImageJob;
  try {
    job = await db.productImageJob.create({
      data: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        mode: input.mode,
        prompt: input.prompt,
        preset: input.preset,
        aspectRatio: input.aspectRatio,
        quality: input.quality,
        model,
        sourceImageUrl: input.sourceImage?.url,
        sourceMimeType: input.sourceImage?.mimeType,
      },
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

  const startedAt = Date.now();
  const providerPrompt = buildProductImagePrompt({
    mode: input.mode,
    description: input.prompt,
    preset: input.preset,
    aspectRatio: input.aspectRatio,
  });

  try {
    await reviewTextOrThrow({
      kind: "generation_prompt",
      text: providerPrompt,
      context: { productImageJobId: job.id, ownerId: input.userId },
    });

    const prefix = `product-images/${input.userId}/${job.id}/${randomUUID()}/`;
    const ai = getAiProvider();
    const result = input.mode === "OPTIMIZE"
      ? await ai.editImages({
          prompt: providerPrompt,
          referenceImages: [{
            data: input.sourceImage!.data,
            mimeType: input.sourceImage!.mimeType,
            fileName: input.sourceImage!.fileName,
          }],
          size: SIZE_BY_ASPECT[input.aspectRatio],
          quality: input.quality,
          storagePrefix: prefix,
          model,
        })
      : await ai.generateImages({
          prompt: providerPrompt,
          n: 1,
          size: SIZE_BY_ASPECT[input.aspectRatio],
          quality: input.quality,
          storagePrefix: prefix,
          model,
        });

    const outputImageUrl = "url" in result ? result.url : result.urls[0];
    if (!outputImageUrl) throw new Error("图像 provider 未返回成品地址");

    await reviewMediaOrThrow({
      kind: "generated_image",
      mediaUrl: outputImageUrl,
      mediaType: "image",
      context: { productImageJobId: job.id, ownerId: input.userId },
    });

    const generatedMedia = await readGeneratedImage(outputImageUrl);
    let canonicalOutputUrl = outputImageUrl;
    let canonicalStorageKey = `product-image-output/${job.id}`;
    if (!result.fromMock) {
      const storage = getStorageProvider();
      if (!storage.isConfigured()) throw new Error("产品图存储暂不可用");
      const persisted = await storage.uploadBuffer("renders", generatedMedia.bytes, {
        key: `product-images/${input.userId}/${job.id}/owned-output.${extensionForImageMime(generatedMedia.mimeType)}`,
        access: "public",
        contentType: generatedMedia.mimeType,
        overwrite: false,
      });
      canonicalOutputUrl = persisted.url;
      canonicalStorageKey = persisted.key;
    }
    const outputAsset = await createOwnedMediaAsset({
      userId: input.userId,
      storageKey: canonicalStorageKey,
      url: canonicalOutputUrl,
      mimeType: generatedMedia.mimeType,
      bytes: generatedMedia.bytes,
    });

    const updated = await db.productImageJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        model: result.modelUsed,
        outputImageUrl: canonicalOutputUrl,
        outputAssetId: outputAsset.id,
        fromMock: result.fromMock,
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });
    await recordAIUsage({
      feature: "product_image_studio",
      provider: result.fromMock ? "mock" : "openai",
      model: result.modelUsed,
      actorUserId: input.userId,
      inputSummary: `${input.mode}/${input.preset}/${input.aspectRatio}`,
      outputSummary: `productImageJobId=${job.id}`,
      promptTokens: result.usage?.inputTokens,
      completionTokens: result.usage?.outputTokens,
      totalTokens: result.usage?.totalTokens,
      promptVersion: PRODUCT_IMAGE_PROMPT_VERSION,
      status: result.fromMock ? "MOCK" : "SUCCESS",
      durationMs: Date.now() - startedAt,
    });
    return updated;
  } catch (error) {
    const safe = safeProductImageError(error);
    const failed = await db.productImageJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: safe.code,
        errorMessage: safe.message,
      },
    });
    await recordAIUsage({
      feature: "product_image_studio",
      provider: "openai",
      model,
      actorUserId: input.userId,
      inputSummary: `${input.mode}/${input.preset}/${input.aspectRatio}`,
      outputSummary: `productImageJobId=${job.id}`,
      promptVersion: PRODUCT_IMAGE_PROMPT_VERSION,
      status: "FAILED",
      errorMessage: safe.code,
      durationMs: Date.now() - startedAt,
    });
    return failed;
  }
}

async function readGeneratedImage(
  imageUrl: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  if (imageUrl.startsWith("/")) {
    const publicRoot = resolve(process.cwd(), "public");
    const filePath = resolve(publicRoot, `.${imageUrl}`);
    if (!filePath.startsWith(`${publicRoot}${sep}`)) {
      throw new Error("生成图片路径不合法");
    }
    const bytes = await readFile(filePath);
    assertGeneratedImageSize(bytes.byteLength);
    return {
      bytes,
      mimeType: imageUrl.toLowerCase().endsWith(".webp")
        ? "image/webp"
        : imageUrl.toLowerCase().endsWith(".png")
          ? "image/png"
          : "image/jpeg",
    };
  }

  const url = new URL(imageUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("生成图片地址不合法");
  }
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error("无法读取生成图片");
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (!mimeType?.startsWith("image/")) throw new Error("生成结果不是图片");
  const bytes = Buffer.from(await response.arrayBuffer());
  assertGeneratedImageSize(bytes.byteLength);
  return { bytes, mimeType };
}

function assertGeneratedImageSize(byteSize: number): void {
  if (byteSize <= 0 || byteSize > MAX_GENERATED_IMAGE_BYTES) {
    throw new Error("生成图片大小不合法");
  }
}

function extensionForImageMime(mimeType: string): "png" | "jpg" | "webp" {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function safeProductImageError(error: unknown): { code: string; message: string } {
  if (error instanceof ContentReviewRejectedError) {
    /// 只有真违规才提示「更换素材/调整描述」；provider 不可达/抖动按可重试处理。
    if (classifyContentReviewFailure(error) === "content_blocked") {
      return {
        code: "CONTENT_REVIEW_REJECTED",
        message:
          error.result.userMessage ||
          "内容安全检查未通过。请更换素材或调整描述后重试。",
      };
    }
    return {
      code: "CONTENT_REVIEW_UNAVAILABLE",
      message: "素材安全检查暂时不可用，请稍后重试。",
    };
  }
  if (error instanceof ProductImageRequestError) {
    return { code: error.code, message: error.message };
  }
  console.error("[product-image] provider failure", {
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
  });
  return {
    code: "PROVIDER_UNAVAILABLE",
    message: "产品图暂时生成失败，未完成的结果不会进入素材库。请稍后重试。",
  };
}

export const __test__ = {
  SIZE_BY_ASPECT,
  safeProductImageError,
};
