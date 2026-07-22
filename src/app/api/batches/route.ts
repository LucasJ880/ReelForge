import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  BatchInsufficientAssetsError,
  BatchImageIdConflictError,
  BatchIdempotencyConflictError,
  BatchProviderInputError,
  BatchTemplateUnavailableError,
  createBatchJob,
  getBatchStatus,
  processBatchTick,
  toCustomerBatchStatus,
} from "@/lib/services/batch-service";
import { customerApiError } from "@/lib/api/customer-generation-error";
import { quotaErrorResponse } from "@/lib/api-quota";
import {
  authorizeBatchQuotaForSession,
  BatchQuotaAuthorizationError,
} from "@/lib/services/quota-service";
import {
  batchCreateRequestSchema,
  batchIdempotencyKeySchema,
} from "@/lib/contracts/batch-request";
import { batchStatusResponseSchema } from "@/lib/contracts/batch-api";
import { VideoGenerationRuntimeUnavailableError } from "@/lib/config/env";
import {
  MediaAssetNotFoundError,
  MediaAssetTypeError,
  resolveOwnedImageAssets,
} from "@/lib/services/media-asset-service";

export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const parsed = batchCreateRequestSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        ...customerApiError({
          code: "VALIDATION_FAILED",
          message: "批量生成参数不合法",
          retryable: false,
          action: "fix_request",
        }),
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }
  const rawIdempotencyKey =
    req.headers.get("idempotency-key") ?? parsed.data.idempotencyKey;
  if (!rawIdempotencyKey) {
    return NextResponse.json(
      customerApiError({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "缺少 Idempotency-Key",
        retryable: false,
        action: "fix_request",
      }),
      { status: 400 },
    );
  }
  const parsedIdempotencyKey = batchIdempotencyKeySchema.safeParse(
    rawIdempotencyKey,
  );
  if (!parsedIdempotencyKey.success) {
    return NextResponse.json(
      customerApiError({
        code: "VALIDATION_FAILED",
        message: "Idempotency-Key 必须是 1–200 个字符。",
        retryable: false,
        action: "fix_request",
      }),
      { status: 400 },
    );
  }
  const idempotencyKey = parsedIdempotencyKey.data;

  try {
    const ownedAssets = await resolveOwnedImageAssets({
      userId: guard.session.user.id,
      assetIds: parsed.data.assetIds,
    });
    const batch = await createBatchJob({
      ...parsed.data,
      images: ownedAssets.map((asset) => ({ id: asset.id, url: asset.url })),
      userId: guard.session.user.id,
      idempotencyKey,
      isInternalStaff:
        guard.session.user.role === "OPERATOR" ||
        guard.session.user.role === "SUPER_ADMIN",
    });
    const authorization = await authorizeBatchQuotaForSession(
      guard.session,
      batch.id,
    );
    // 同一请求内启动首个受控并发 wave；后续由单一 batch status 轮询续跑。
    await processBatchTick(batch.id).catch((error) => {
      console.error("[batch:create] initial tick failed", {
        batchId: batch.id,
        error: (error as Error).message,
      });
    });
    const status = await getBatchStatus(batch.id, guard.session.user.id);
    return NextResponse.json(
      batchStatusResponseSchema.parse({
        batch: toCustomerBatchStatus(status),
      }),
      { status: authorization.replayed ? 200 : 201 },
    );
  } catch (error) {
    const quotaResponse = quotaErrorResponse(error);
    if (quotaResponse) return quotaResponse;
    if (error instanceof MediaAssetNotFoundError) {
      return NextResponse.json(
        customerApiError({
          code: "RESOURCE_NOT_FOUND",
          message: "素材不存在或无权访问。",
          retryable: false,
          action: "contact_support",
        }),
        { status: 404 },
      );
    }
    if (error instanceof MediaAssetTypeError) {
      return NextResponse.json(
        customerApiError({
          code: "VALIDATION_FAILED",
          message: "批量素材只支持图片。",
          retryable: false,
          action: "fix_request",
        }),
        { status: 400 },
      );
    }
    if (error instanceof BatchImageIdConflictError) {
      return NextResponse.json(
        customerApiError({
          code: "VALIDATION_FAILED",
          message: error.message,
          retryable: false,
          action: "fix_request",
        }),
        { status: error.httpStatus },
      );
    }
    if (error instanceof BatchInsufficientAssetsError) {
      return NextResponse.json(
        customerApiError({
          code: "VALIDATION_FAILED",
          message: error.message,
          retryable: false,
          action: "fix_request",
        }),
        { status: error.httpStatus },
      );
    }
    if (error instanceof BatchProviderInputError) {
      return NextResponse.json(
        customerApiError({
          code: "VALIDATION_FAILED",
          message: error.message,
          retryable: false,
          action: "fix_request",
        }),
        { status: error.httpStatus },
      );
    }
    if (error instanceof BatchTemplateUnavailableError) {
      return NextResponse.json(
        customerApiError({
          code: "VALIDATION_FAILED",
          message: error.message,
          retryable: false,
          action: "fix_request",
        }),
        { status: 422 },
      );
    }
    if (error instanceof VideoGenerationRuntimeUnavailableError) {
      console.error("[batch:create] video runtime unavailable", {
        reason: error.reason,
      });
      return NextResponse.json(
        customerApiError({
          code: "SERVICE_UNAVAILABLE",
          message: "视频生成服务正在配置中，请稍后再试。",
          retryable: true,
          action: "wait",
        }),
        { status: error.httpStatus },
      );
    }
    if (error instanceof BatchIdempotencyConflictError) {
      return NextResponse.json(
        customerApiError({
          code: "IDEMPOTENCY_CONFLICT",
          message: error.message,
          retryable: false,
          action: "contact_support",
        }),
        { status: 409 },
      );
    }
    if (error instanceof BatchQuotaAuthorizationError) {
      return NextResponse.json(
        customerApiError({
          code: "QUOTA_CHECK_UNAVAILABLE",
          message: "暂时无法确认批次额度，请稍后重试。",
          retryable: true,
          action: "retry",
        }),
        { status: 503 },
      );
    }
    console.error("[batch:create] request failed", {
      userId: guard.session.user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      customerApiError({
        code: "INTERNAL_ERROR",
        message: "暂时无法创建批次，请稍后重试。",
        retryable: true,
        action: "retry",
      }),
      { status: 500 },
    );
  }
}
