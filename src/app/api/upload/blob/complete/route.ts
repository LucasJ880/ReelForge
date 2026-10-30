import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { quotaErrorResponse } from "@/lib/api-quota";
import { customerApiError } from "@/lib/contracts/customer-api";
import {
  uploadBlobSuccess,
  uploadCompleteRequestSchema,
} from "@/lib/contracts/upload-blob";
import {
  createOwnedMediaAsset,
  findOwnedMediaAssetByStorageKey,
  type MediaAssetRecord,
} from "@/lib/services/media-asset-service";
import { assertQuotaForSession } from "@/lib/services/quota-service";
import { verifyDirectUploadTicket } from "@/lib/upload/direct-upload-ticket";
import { validateMediaMagicBytes } from "@/lib/upload/media-file-validation";
import { MAX_UPLOAD_BYTES, UPLOAD_TOO_LARGE_MESSAGE } from "@/lib/upload/upload-policy";

/// 登记要把对象读回来算哈希与尺寸；100MB 视频在同区读一遍要几秒，给足余量。
export const maxDuration = 60;

interface StoredObject {
  url: string;
  size: number;
}

interface UploadCompleteDependencies {
  requireAuth: typeof requireAuth;
  verifyTicket: typeof verifyDirectUploadTicket;
  findExistingAsset: typeof findOwnedMediaAssetByStorageKey;
  headObject: (pathname: string) => Promise<StoredObject | null>;
  readObject: (url: string) => Promise<Uint8Array>;
  deleteObject: (pathname: string) => Promise<void>;
  assertQuotaForSession: typeof assertQuotaForSession;
  createOwnedMediaAsset: typeof createOwnedMediaAsset;
}

const defaultDependencies: UploadCompleteDependencies = {
  requireAuth,
  verifyTicket: verifyDirectUploadTicket,
  findExistingAsset: findOwnedMediaAssetByStorageKey,
  headObject: async (pathname) => {
    const { BlobNotFoundError, head } = await import("@vercel/blob");
    try {
      const blob = await head(pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
      return { url: blob.url, size: blob.size };
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  },
  readObject: async (url) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`object read failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  },
  deleteObject: async (pathname) => {
    const { del } = await import("@vercel/blob");
    await del(pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
  },
  assertQuotaForSession,
  createOwnedMediaAsset,
};

function assetResponse(asset: MediaAssetRecord) {
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
}

function errorResponse(args: {
  status: number;
  code: "VALIDATION_FAILED" | "ASSET_MISSING" | "STORAGE_UNAVAILABLE" | "QUOTA_CHECK_UNAVAILABLE" | "SERVICE_UNAVAILABLE";
  message: string;
  action: "fix_request" | "replace_asset" | "retry" | "wait";
}) {
  return NextResponse.json(
    customerApiError({
      code: args.code,
      message: args.message,
      /// 与 customer-api 的恢复语义表一致：只有「重试 / 稍等」是可重试的
      retryable: args.action === "retry" || args.action === "wait",
      action: args.action,
    }),
    { status: args.status },
  );
}

/**
 * 浏览器直传第三步：凭票据登记资产。
 *
 * 只信票据里签过的路径与类型，再把对象从存储读回来亲自验：大小、文件签名、额度。
 * 任何一关不过都删掉对象，不留没人认领的文件；同一张票据重复登记返回同一条资产，
 * 不重复扣额度（网络抖动时前端会重试这一步）。
 */
export function createUploadCompletePostHandler(
  overrides: Partial<UploadCompleteDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function uploadCompletePost(req: NextRequest) {
    const guard = await dependencies.requireAuth();
    if (!guard.ok) return guard.response;
    const userId = guard.session.user.id;

    const parsed = uploadCompleteRequestSchema.safeParse(await req.json().catch(() => null));
    const ticket = parsed.success
      ? dependencies.verifyTicket(parsed.data.ticket, { userId })
      : null;
    if (!ticket) {
      return errorResponse({
        status: 400,
        code: "VALIDATION_FAILED",
        message: "上传凭证无效或已过期，请重新选择文件上传。",
        action: "fix_request",
      });
    }

    const existing = await dependencies
      .findExistingAsset({ userId, storageKey: ticket.pathname })
      .catch(() => null);
    if (existing) return assetResponse(existing);

    const discard = () => dependencies.deleteObject(ticket.pathname).catch(() => undefined);

    let stored: StoredObject | null;
    let bytes: Uint8Array;
    try {
      stored = await dependencies.headObject(ticket.pathname);
      if (!stored) {
        return errorResponse({
          status: 409,
          code: "ASSET_MISSING",
          message: "文件还没有传完，请重新选择文件上传。",
          action: "replace_asset",
        });
      }
      if (stored.size > MAX_UPLOAD_BYTES) {
        await discard();
        return errorResponse({
          status: 413,
          code: "VALIDATION_FAILED",
          message: UPLOAD_TOO_LARGE_MESSAGE,
          action: "fix_request",
        });
      }
      bytes = await dependencies.readObject(stored.url);
    } catch (error) {
      console.error("[upload/blob/complete] storage read failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      return errorResponse({
        status: 503,
        code: "STORAGE_UNAVAILABLE",
        message: "素材存储暂不可用，请稍后重试。",
        action: "retry",
      });
    }

    const magic = validateMediaMagicBytes(bytes.subarray(0, 32), ticket.contentType);
    if (!magic.ok) {
      await discard();
      return errorResponse({
        status: 415,
        code: "VALIDATION_FAILED",
        message: `素材上传失败：${magic.reason}。请重新导出原始文件后再试。`,
        action: "fix_request",
      });
    }
    /// 以文件签名为准（与中转上传同一口径）：「.png 名字、JPEG 内容」按真实类型入库。
    const mimeType = magic.detected.startsWith("image/") ? magic.detected : ticket.contentType;

    try {
      await dependencies.assertQuotaForSession(guard.session, "BLOB_UPLOAD_BYTES", bytes.byteLength);
    } catch (error) {
      await discard();
      const quotaResponse = quotaErrorResponse(error);
      if (quotaResponse) return quotaResponse;
      return errorResponse({
        status: 503,
        code: "QUOTA_CHECK_UNAVAILABLE",
        message: "暂时无法核对上传额度，请稍后重试。",
        action: "wait",
      });
    }

    try {
      const asset = await dependencies.createOwnedMediaAsset({
        userId,
        storageKey: ticket.pathname,
        url: stored.url,
        mimeType,
        bytes,
      });
      return assetResponse(asset);
    } catch (error) {
      /// 并发重放撞上 storageKey 唯一键：另一个请求已经登记成功，返回那一条，对象不能删。
      const raced = await dependencies
        .findExistingAsset({ userId, storageKey: ticket.pathname })
        .catch(() => null);
      if (raced) return assetResponse(raced);
      await discard();
      console.error("[upload/blob/complete] asset persistence failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      return errorResponse({
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "素材登记暂不可用，请稍后重试。",
        action: "retry",
      });
    }
  };
}

export const POST = createUploadCompletePostHandler();
