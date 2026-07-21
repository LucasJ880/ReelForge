import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { quotaErrorResponse } from "@/lib/api-quota";
import {
  ContentReviewRejectedError,
  classifyContentReviewFailure,
  reviewMediaOrThrow,
} from "@/lib/content-review";
import { db } from "@/lib/db";
import {
  createProductImageJob,
  listProductImageJobsForUser,
  ProductImageRequestError,
} from "@/lib/services/product-image-service";
import { assertAuthenticatedActionRateLimit } from "@/lib/services/quota-service";
import { getStorageProvider } from "@/lib/storage";
import {
  SUPPORTED_IMAGE_MIME_TYPES,
  validateFileMagicBytes,
} from "@/lib/upload/media-file-validation";

export const maxDuration = 300;

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const requestSchema = z.object({
  mode: z.enum(["GENERATE", "OPTIMIZE"]),
  prompt: z.string().trim().min(8).max(1200),
  preset: z.enum(["white_studio", "lifestyle", "luxury", "social", "macro"]),
  aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:9"]),
  quality: z.enum(["low", "medium", "high"]),
});

export async function GET() {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const jobs = await listProductImageJobsForUser(guard.session.user.id);
  return NextResponse.json({ ok: true, jobs });
}

export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const userId = guard.session.user.id;
  const idempotencyKey = req.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return NextResponse.json(
      { ok: false, code: "IDEMPOTENCY_KEY_REQUIRED", error: "缺少有效的 Idempotency-Key。" },
      { status: 400 },
    );
  }

  const existing = await db.productImageJob.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
  });
  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true, job: existing });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { ok: false, code: "INVALID_FORM", error: "无法读取提交内容，请刷新后重试。" },
      { status: 400 },
    );
  }
  const parsed = requestSchema.safeParse({
    mode: form.get("mode"),
    prompt: form.get("prompt"),
    preset: form.get("preset"),
    aspectRatio: form.get("aspectRatio"),
    quality: form.get("quality"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "INVALID_REQUEST", error: "产品图参数不完整或格式不正确。" },
      { status: 400 },
    );
  }

  const source = form.get("sourceImage");
  if (parsed.data.mode === "OPTIMIZE" && !(source instanceof File)) {
    return NextResponse.json(
      { ok: false, code: "SOURCE_IMAGE_REQUIRED", error: "优化产品图需要上传一张原始产品照片。" },
      { status: 400 },
    );
  }
  if (source instanceof File) {
    if (source.size > MAX_SOURCE_BYTES) {
      return NextResponse.json(
        { ok: false, code: "SOURCE_TOO_LARGE", error: "原图不能超过 20MB，请压缩后重试。" },
        { status: 413 },
      );
    }
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(source.type.toLowerCase())) {
      return NextResponse.json(
        { ok: false, code: "UNSUPPORTED_IMAGE", error: "只支持 PNG、JPG 和 WebP 原图。" },
        { status: 415 },
      );
    }
    const magic = await validateFileMagicBytes(source);
    if (!magic.ok) {
      return NextResponse.json(
        { ok: false, code: "IMAGE_SIGNATURE_MISMATCH", error: `原图文件校验失败：${magic.reason}。` },
        { status: 415 },
      );
    }
  }

  try {
    await assertAuthenticatedActionRateLimit({ action: "product-image", userId });
  } catch (error) {
    const response = quotaErrorResponse(error);
    if (response) return response;
    throw error;
  }

  const storage = getStorageProvider();
  let uploaded: { url: string; key: string; data: Buffer; mimeType: string; fileName: string } | undefined;
  try {
    if (source instanceof File) {
      if (!storage.isConfigured()) {
        throw new ProductImageRequestError(
          "产品图存储暂不可用，请联系运营后重试。",
          "STORAGE_UNAVAILABLE",
          503,
        );
      }
      const data = Buffer.from(await source.arrayBuffer());
      const ext = extensionForMime(source.type);
      const result = await storage.uploadBuffer("uploads", data, {
        key: `product-images/${userId}/${randomUUID()}/source.${ext}`,
        access: "public",
        contentType: source.type,
        overwrite: false,
      });
      uploaded = {
        url: result.url,
        key: result.key,
        data,
        mimeType: source.type,
        fileName: `source.${ext}`,
      };
      await reviewMediaOrThrow({
        kind: "user_upload",
        mediaUrl: result.url,
        mediaType: "image",
        context: { ownerId: userId, workflow: "product_image" },
      });
    }

    const job = await createProductImageJob({
      userId,
      idempotencyKey,
      ...parsed.data,
      sourceImage: uploaded
        ? {
            url: uploaded.url,
            data: uploaded.data,
            mimeType: uploaded.mimeType,
            fileName: uploaded.fileName,
          }
        : undefined,
    });

    // A concurrent request may win the idempotency race after this request
    // uploaded a source. Remove the unused copy; never delete the canonical job source.
    if (uploaded && job.sourceImageUrl !== uploaded.url) {
      await storage.deleteObject("uploads", uploaded.key).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, duplicate: false, job }, { status: 201 });
  } catch (error) {
    if (uploaded) {
      await storage.deleteObject("uploads", uploaded.key).catch(() => undefined);
    }
    if (error instanceof ProductImageRequestError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status },
      );
    }
    if (error instanceof ContentReviewRejectedError) {
      /// provider 不可达 / 密钥缺失 / 抖动不是用户素材的问题，返回可重试的 503，
      /// 不再统一误报「请更换素材」。只有 verdict==="rejected" 才是真违规。
      if (classifyContentReviewFailure(error) === "content_blocked") {
        return NextResponse.json(
          {
            ok: false,
            code: "CONTENT_REVIEW_REJECTED",
            error: error.result.userMessage || "内容安全检查未通过。请更换素材后重试。",
          },
          { status: 422 },
        );
      }
      return NextResponse.json(
        {
          ok: false,
          code: "CONTENT_REVIEW_UNAVAILABLE",
          error: "素材安全检查暂时不可用，请稍后重试。",
        },
        { status: 503 },
      );
    }
    console.error("[product-images:POST]", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, code: "PRODUCT_IMAGE_FAILED", error: "产品图处理失败，请稍后重试。" },
      { status: 503 },
    );
  }
}

function extensionForMime(mime: string): "png" | "jpg" | "webp" {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}
