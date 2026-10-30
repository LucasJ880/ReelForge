import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { customerApiError } from "@/lib/contracts/customer-api";
import {
  uploadTicketRequestSchema,
  uploadTicketResponseSchema,
} from "@/lib/contracts/upload-blob";
import { getStorageProvider } from "@/lib/storage";
import {
  DIRECT_UPLOAD_TICKET_TTL_MS,
  signDirectUploadTicket,
} from "@/lib/upload/direct-upload-ticket";
import {
  MAX_UPLOAD_BYTES,
  SAFE_UPLOAD_PREFIX,
  SUPPORTED_UPLOAD_TYPES,
  UPLOAD_TOO_LARGE_MESSAGE,
  UPLOAD_UNSUPPORTED_TYPE_MESSAGE,
  uploadsObjectPathname,
} from "@/lib/upload/upload-policy";

/// Blob 写入凭证的有效期：够手机网络传完 100MB，又不至于长到能被拿去反复写。
const CLIENT_TOKEN_TTL_MS = 30 * 60 * 1000;

interface UploadTicketDependencies {
  requireAuth: typeof requireAuth;
  getStorageProvider: typeof getStorageProvider;
  generateClientToken: (args: {
    pathname: string;
    contentType: string;
    validUntil: number;
  }) => Promise<string>;
  signTicket: typeof signDirectUploadTicket;
  randomUUID: () => string;
  now: () => number;
}

const defaultDependencies: UploadTicketDependencies = {
  requireAuth,
  getStorageProvider,
  generateClientToken: async ({ pathname, contentType, validUntil }) => {
    const { generateClientTokenFromReadWriteToken } = await import("@vercel/blob/client");
    return generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: MAX_UPLOAD_BYTES,
      validUntil,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  },
  signTicket: signDirectUploadTicket,
  randomUUID,
  now: Date.now,
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

function storageUnavailable(action: "retry" | "contact_support") {
  return NextResponse.json(
    customerApiError({
      code: "STORAGE_UNAVAILABLE",
      message:
        action === "retry"
          ? "素材存储暂不可用，请稍后重试。"
          : "素材上传服务暂不可用，请联系运营核对部署配置。",
      retryable: action === "retry",
      action,
    }),
    { status: 503 },
  );
}

/**
 * 浏览器直传第一步：校验类型 / 大小 / 目录，签一张只能写这一个路径的 Blob 凭证。
 *
 * 文件本体不经过这里——Vercel 函数请求体上限 4.5MB，手机原图一穿过函数就被平台 413
 * （10-30 CEO 演示翻车的根因）。额度在 complete 按真实大小扣，这里不扣：传失败、
 * 用户取消都不该算钱。
 */
export function createUploadTicketPostHandler(
  overrides: Partial<UploadTicketDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function uploadTicketPost(req: NextRequest) {
    const guard = await dependencies.requireAuth();
    if (!guard.ok) return guard.response;

    const parsed = uploadTicketRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return validationError("无法读取上传内容，请重新选择文件后重试。");
    }
    const { contentType, size } = parsed.data;
    const prefix = parsed.data.prefix ?? "uploads";
    if (size > MAX_UPLOAD_BYTES) return validationError(UPLOAD_TOO_LARGE_MESSAGE, 413);
    if (!SUPPORTED_UPLOAD_TYPES.test(contentType)) {
      return validationError(UPLOAD_UNSUPPORTED_TYPE_MESSAGE, 415);
    }
    if (!SAFE_UPLOAD_PREFIX.test(prefix)) {
      return validationError("上传目录不合法，请刷新页面后重试。");
    }

    let storage: ReturnType<typeof getStorageProvider>;
    try {
      storage = dependencies.getStorageProvider();
    } catch {
      return storageUnavailable("contact_support");
    }
    /// 国内 TOS 没有浏览器直传凭证：让前端退回 multipart 中转（那里不在 Vercel 函数里跑）。
    if (storage.id !== "vercel_blob") {
      return NextResponse.json(uploadTicketResponseSchema.parse({ ok: true, mode: "server" }));
    }
    if (!storage.isConfigured()) return storageUnavailable("contact_support");

    const now = dependencies.now();
    const pathname = uploadsObjectPathname(prefix, dependencies.randomUUID(), contentType);
    let clientToken: string;
    try {
      clientToken = await dependencies.generateClientToken({
        pathname,
        contentType,
        validUntil: now + CLIENT_TOKEN_TTL_MS,
      });
    } catch (error) {
      console.error("[upload/blob/ticket] client token failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      return storageUnavailable("retry");
    }
    const ticket = dependencies.signTicket({
      userId: guard.session.user.id,
      pathname,
      contentType,
      expiresAt: now + DIRECT_UPLOAD_TICKET_TTL_MS,
    });
    return NextResponse.json(
      uploadTicketResponseSchema.parse({
        ok: true,
        mode: "direct",
        pathname,
        clientToken,
        ticket,
      }),
    );
  };
}

export const POST = createUploadTicketPostHandler();
