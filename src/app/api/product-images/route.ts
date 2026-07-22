import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { quotaErrorResponse } from "@/lib/api-quota";
import { db } from "@/lib/db";
import {
  MediaAssetNotFoundError,
  MediaAssetTypeError,
  resolveOwnedImageAssets,
} from "@/lib/services/media-asset-service";
import {
  createProductImageJob,
  listProductImageJobsForUser,
  ProductImageRequestError,
  type ProductImageJobWithAssets,
} from "@/lib/services/product-image-service";
import { assertAuthenticatedActionRateLimit } from "@/lib/services/quota-service";

const requestSchema = z.object({
  prompt: z.string().trim().min(8).max(1200),
  preset: z.enum(["white_studio", "lifestyle", "luxury", "social", "macro"]),
  aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:9"]),
  resolution: z.enum(["1K", "2K", "4K"]),
  resultCount: z.number().int().min(1).max(4),
  sourceAssetId: z.string().trim().min(1).max(200).optional(),
}).strict();

function assetView(asset: ProductImageJobWithAssets["sourceAsset"]) {
  return asset
    ? {
        id: asset.id,
        url: asset.url,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
      }
    : null;
}

export function productImageJobView(job: ProductImageJobWithAssets) {
  const outputs = job.outputs.length > 0
    ? job.outputs.map((output) => ({
        id: output.id,
        handoffId: output.id,
        position: output.position,
        url: output.outputImageUrl,
        asset: assetView(output.asset),
        historical: false,
      }))
    : job.status === "SUCCEEDED" && job.outputImageUrl
      ? [{
          id: `historical-${job.id}`,
          handoffId: null,
          position: 0,
          url: job.outputImageUrl,
          asset: null,
          historical: true,
        }]
      : [];
  return {
    id: job.id,
    status: job.status,
    prompt: job.prompt,
    preset: job.preset,
    aspectRatio: job.aspectRatio,
    model: job.model,
    modelSnapshot: job.modelSnapshot,
    planId: job.planId,
    resolutionSnapshot: job.resolutionSnapshot,
    pointsSnapshot: job.pointsSnapshot,
    resultCount: job.resultCount,
    outputImageUrl: job.outputImageUrl,
    outputAssetId: job.outputAssetId,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    sourceAsset: assetView(job.sourceAsset),
    outputs,
    retryableTasks: job.status === "FAILED"
      ? job.providerTasks
          .filter((task) => task.submissionState === "REJECTED")
          .map((task) => ({
            id: task.id,
            ordinal: task.ordinal,
            errorMessage: task.errorMessage,
          }))
      : [],
    historyNotice: outputs.some((output) => output.historical)
      ? "此历史图片可查看和下载；如需继续编辑或制作视频，请重新生成以创建服务器资产。"
      : null,
  };
}

interface ProductImagePostDependencies {
  requireAuth: typeof requireAuth;
  findExisting(args: {
    where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } };
    include: {
      sourceAsset: true;
      outputs: { include: { asset: true }; orderBy: { position: "asc" } };
      providerTasks: {
        include: { result: { include: { asset: true } } };
        orderBy: { ordinal: "asc" };
      };
    };
  }): Promise<ProductImageJobWithAssets | null>;
  resolveOwnedImageAssets: typeof resolveOwnedImageAssets;
  assertAuthenticatedActionRateLimit: typeof assertAuthenticatedActionRateLimit;
  createProductImageJob: typeof createProductImageJob;
}

const defaultPostDependencies: ProductImagePostDependencies = {
  requireAuth,
  findExisting: (args) => db.productImageJob.findUnique(args),
  resolveOwnedImageAssets,
  assertAuthenticatedActionRateLimit,
  createProductImageJob,
};

export function createProductImagePostHandler(
  overrides: Partial<ProductImagePostDependencies> = {},
) {
  const dependencies = { ...defaultPostDependencies, ...overrides };
  return async function productImagePost(req: NextRequest) {
    const guard = await dependencies.requireAuth();
    if (!guard.ok) return guard.response;
    const userId = guard.session.user.id;
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return NextResponse.json(
        { ok: false, code: "IDEMPOTENCY_KEY_REQUIRED", error: "缺少有效的 Idempotency-Key。" },
        { status: 400 },
      );
    }

    const existing = await dependencies.findExisting({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: {
        sourceAsset: true,
        outputs: { include: { asset: true }, orderBy: { position: "asc" } },
        providerTasks: {
          include: { result: { include: { asset: true } } },
          orderBy: { ordinal: "asc" },
        },
      },
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        job: productImageJobView(existing as ProductImageJobWithAssets),
        asset: assetView((existing as ProductImageJobWithAssets).sourceAsset),
      });
    }

    const body = await req.json().catch(() => null);
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, code: "INVALID_REQUEST", error: "产品图参数不完整或格式不正确。" },
        { status: 400 },
      );
    }

    let sourceAsset;
    try {
      sourceAsset = parsed.data.sourceAssetId
        ? (await dependencies.resolveOwnedImageAssets({
            userId,
            assetIds: [parsed.data.sourceAssetId],
          }))[0]
        : undefined;
    } catch (error) {
      if (error instanceof MediaAssetNotFoundError || error instanceof MediaAssetTypeError) {
        return NextResponse.json(
          { ok: false, code: "RESOURCE_NOT_FOUND", error: "参考图片不存在或无权访问。" },
          { status: 404 },
        );
      }
      throw error;
    }

    try {
      await dependencies.assertAuthenticatedActionRateLimit({ action: "product-image", userId });
    } catch (error) {
      const response = quotaErrorResponse(error);
      if (response) return response;
      throw error;
    }

    try {
      const job = await dependencies.createProductImageJob({
        userId,
        idempotencyKey,
        prompt: parsed.data.prompt,
        preset: parsed.data.preset,
        aspectRatio: parsed.data.aspectRatio,
        resolution: parsed.data.resolution,
        resultCount: parsed.data.resultCount,
        sourceAsset,
      });
      return NextResponse.json(
        {
          ok: true,
          duplicate: false,
          job: productImageJobView(job),
          asset: assetView(job.sourceAsset),
        },
        { status: 201 },
      );
    } catch (error) {
      if (error instanceof ProductImageRequestError) {
        return NextResponse.json(
          { ok: false, code: error.code, error: error.message },
          { status: error.status },
        );
      }
      console.error("[product-images:POST]", {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { ok: false, code: "PRODUCT_IMAGE_FAILED", error: "产品图任务提交失败，请稍后重试。" },
        { status: 503 },
      );
    }
  };
}

export async function GET() {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const jobs = await listProductImageJobsForUser(guard.session.user.id);
  return NextResponse.json({ ok: true, jobs: jobs.map(productImageJobView) });
}

const productImagePost = createProductImagePostHandler();
export async function POST(req: NextRequest) {
  return productImagePost(req);
}
