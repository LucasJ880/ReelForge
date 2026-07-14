import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  BatchImageIdConflictError,
  BatchIdempotencyConflictError,
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
} from "@/lib/contracts/batch-request";

export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const parsed = batchCreateRequestSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "批量生成参数不合法", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const idempotencyKey =
    req.headers.get("idempotency-key") ?? parsed.data.idempotencyKey;
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "缺少 Idempotency-Key" },
      { status: 400 },
    );
  }

  try {
    const batch = await createBatchJob({
      ...parsed.data,
      userId: guard.session.user.id,
      idempotencyKey,
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
      { batch: toCustomerBatchStatus(status) },
      { status: authorization.replayed ? 200 : 201 },
    );
  } catch (error) {
    const quotaResponse = quotaErrorResponse(error);
    if (quotaResponse) return quotaResponse;
    if (error instanceof BatchImageIdConflictError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
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
          code: "INTERNAL_ERROR",
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
