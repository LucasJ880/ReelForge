import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { quotaErrorResponse } from "@/lib/api-quota";
import { customerApiError } from "@/lib/contracts/customer-api";
import { uploadBlobSuccess } from "@/lib/contracts/upload-blob";
import { createOwnedMediaAsset } from "@/lib/services/media-asset-service";
import { assertQuotaForSession } from "@/lib/services/quota-service";
import { getStorageProvider } from "@/lib/storage";
import { validateFileMagicBytes } from "@/lib/upload/media-file-validation";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const SUPPORTED_UPLOAD_TYPES = /^(video\/(mp4|quicktime|webm|x-m4v)|image\/(png|jpe?g|webp)|audio\/(mpeg|mp4|x-m4a|wav|aac))$/i;
const SAFE_PREFIX = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

interface UploadBlobDependencies {
  requireAuth: typeof requireAuth;
  getStorageProvider: typeof getStorageProvider;
  validateFileMagicBytes: typeof validateFileMagicBytes;
  assertQuotaForSession: typeof assertQuotaForSession;
  createOwnedMediaAsset: typeof createOwnedMediaAsset;
  randomUUID: () => string;
}

const defaultDependencies: UploadBlobDependencies = {
  requireAuth,
  getStorageProvider,
  validateFileMagicBytes,
  assertQuotaForSession,
  createOwnedMediaAsset,
  randomUUID,
};

function validationError(message: string, status = 400) {
  return NextResponse.json(
    customerApiError({
      code: "VALIDATION_FAILED",
      message,
      retryable: false,
      action: "fix_request",
    }),
    { status },
  );
}

function unavailableError(args: {
  code: "STORAGE_UNAVAILABLE" | "QUOTA_CHECK_UNAVAILABLE" | "SERVICE_UNAVAILABLE";
  message: string;
  action?: "retry" | "wait" | "contact_support";
}) {
  return NextResponse.json(
    customerApiError({
      code: args.code,
      message: args.message,
      retryable: args.action !== "contact_support",
      action: args.action ?? "retry",
    }),
    { status: 503 },
  );
}

/**
 * 通用素材上传：前端以 POST multipart/form-data 上传单文件。
 * 用于产品参考图、自定义参考图等。
 *
 * Phase 2A：从直接 import @vercel/blob 改为走 storage provider 抽象层。
 *   - 海外部署：STORAGE_PROVIDER=vercel_blob → 走 Vercel Blob
 *   - 国内部署：STORAGE_PROVIDER=volcengine_tos → 走火山 TOS
 *
 * 鉴权：任何已登录账号（含 BUSINESS / PERSONAL / 内部 staff）均可调用，
 * 由 size + MIME 白名单 + 文件名 prefix 兜底防滥用。Phase 7a 已加单用户配额。
 *
 * 成功响应返回服务端持有的资产 ID；后续创作请求只提交 ID，不信任外部 URL。
 */
export function createUploadBlobPostHandler(
  overrides: Partial<UploadBlobDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function uploadBlobPost(req: NextRequest) {
  const guard = await dependencies.requireAuth();
  if (!guard.ok) return guard.response;

  const form = await req.formData().catch(() => null);
  if (!form) {
    return validationError("无法读取上传内容，请重新选择文件后重试。");
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return validationError("缺少 file 字段");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return validationError(
      "素材上传失败：单个文件不能超过 100MB。请压缩视频、裁短素材，或改用可公开访问的素材 URL 登记。",
      413,
    );
  }
  if (!SUPPORTED_UPLOAD_TYPES.test(file.type)) {
    return validationError(
      "素材上传失败：当前 MVP 仅支持 mp4、mov、webm、png、jpg、webp、mp3、wav、m4a、aac。请转换格式后重试。",
      415,
    );
  }
  const magic = await dependencies.validateFileMagicBytes(file).catch(() => null);
  if (!magic) {
    return validationError("素材文件无法读取，请重新导出原始文件后再试。", 415);
  }
  if (!magic.ok) {
    return validationError(
      `素材上传失败：${magic.reason}。请重新导出原始文件后再试。`,
      415,
    );
  }
  const prefix = (form.get("prefix") as string | null) ?? "uploads";
  if (!SAFE_PREFIX.test(prefix)) {
    return validationError("上传目录不合法，请刷新页面后重试。");
  }
  const extension = extensionForMime(file.type);
  const key = `${prefix}/${dependencies.randomUUID()}${extension}`;

  let storage: ReturnType<typeof getStorageProvider>;
  try {
    storage = dependencies.getStorageProvider();
  } catch {
    return unavailableError({
      code: "STORAGE_UNAVAILABLE",
      message: "素材上传服务暂不可用，请联系运营核对部署配置。",
      action: "contact_support",
    });
  }
  if (!storage.isConfigured()) {
    return unavailableError({
      code: "STORAGE_UNAVAILABLE",
      message: "素材上传服务暂不可用，请联系运营核对部署配置。",
      action: "contact_support",
    });
  }

  try {
    await dependencies.assertQuotaForSession(guard.session, "BLOB_UPLOAD_BYTES", file.size);
  } catch (err) {
    const quotaRes = quotaErrorResponse(err);
    if (quotaRes) return quotaRes;
    return unavailableError({
      code: "QUOTA_CHECK_UNAVAILABLE",
      message: "暂时无法核对上传额度，请稍后重试。",
      action: "wait",
    });
  }

  /// 用户上传素材走 uploads bucket（与生成视频成品的 renders bucket 隔离）
  /// access=public：当前业务模型里素材 URL 需要长期可被 AI provider 拉取（Seedance / Ark vision），
  /// 不能用短时效 signed URL。生产环境推荐 TOS bucket 公开读 + 单独 ACL，或外挂 CDN。
  let result: Awaited<ReturnType<typeof storage.uploadFile>> | null = null;
  let assetPersisted = false;
  let stage: "storage_upload" | "asset_persistence" = "storage_upload";
  try {
    result = await storage.uploadFile("uploads", file, {
      key,
      access: "public",
      contentType: file.type || undefined,
    });
    stage = "asset_persistence";
    const asset = await dependencies.createOwnedMediaAsset({
      userId: guard.session.user.id,
      storageKey: result.key,
      url: result.url,
      mimeType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    assetPersisted = true;
    return NextResponse.json(
      uploadBlobSuccess({
        asset: {
          id: asset.id,
          url: asset.url,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
        },
      }),
      { status: 201 },
    );
  } catch (error) {
    if (result && !assetPersisted) {
      await storage.deleteObject("uploads", result.key).catch(() => undefined);
    }
    console.error("[upload/blob] request failed", {
      stage,
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return result
      ? unavailableError({
          code: "SERVICE_UNAVAILABLE",
          message: "素材登记暂不可用，请稍后重试。",
          action: "retry",
        })
      : unavailableError({
          code: "STORAGE_UNAVAILABLE",
          message: "素材存储暂不可用，请稍后重试。",
          action: "retry",
        });
  }
  };
}

function extensionForMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/png": return ".png";
    case "image/jpeg":
    case "image/jpg": return ".jpg";
    case "image/webp": return ".webp";
    case "video/mp4": return ".mp4";
    case "video/quicktime": return ".mov";
    case "video/webm": return ".webm";
    case "video/x-m4v": return ".m4v";
    case "audio/mpeg": return ".mp3";
    case "audio/mp4":
    case "audio/x-m4a": return ".m4a";
    case "audio/wav": return ".wav";
    case "audio/aac": return ".aac";
    default: return "";
  }
}

export const POST = createUploadBlobPostHandler();
