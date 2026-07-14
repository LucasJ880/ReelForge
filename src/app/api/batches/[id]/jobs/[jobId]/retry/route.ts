import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  BatchNotFoundError,
  getBatchStatus,
  processBatchTick,
  retryFailedBatchJob,
  toCustomerBatchStatus,
} from "@/lib/services/batch-service";
import { customerApiError } from "@/lib/api/customer-generation-error";
import { batchRetryOneResponseSchema } from "@/lib/contracts/batch-api";

export async function POST(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; jobId: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id, jobId } = await params;
  try {
    await getBatchStatus(id, guard.session.user.id);
    const result = await retryFailedBatchJob(id, jobId);
    if (result.outcome === "not_found") {
      return NextResponse.json(
        customerApiError({
          code: "RESOURCE_NOT_FOUND",
          message: "批次任务不存在。",
          retryable: false,
          action: "contact_support",
        }),
        { status: 404 },
      );
    }
    if (result.outcome === "invalid_state") {
      return NextResponse.json(
        customerApiError({
          code: "INVALID_STATE",
          message: "只有失败且尚未重试的任务可以重试，请刷新批次状态。",
          retryable: false,
          action: "refresh_status",
        }),
        { status: 409 },
      );
    }
    if (result.outcome === "billing_unsafe") {
      return NextResponse.json(
        customerApiError({
          code: "SUBMISSION_ACK_UNKNOWN",
          message: "该任务暂不可安全重试，请联系支持核对。",
          retryable: false,
          action: "contact_support",
        }),
        { status: 409 },
      );
    }
    await processBatchTick(id);
    return NextResponse.json(
      batchRetryOneResponseSchema.parse({
        retried: 1,
        batch: toCustomerBatchStatus(
          await getBatchStatus(id, guard.session.user.id),
        ),
      }),
    );
  } catch (error) {
    if (error instanceof BatchNotFoundError) {
      return NextResponse.json(
        customerApiError({
          code: "RESOURCE_NOT_FOUND",
          message: "批次不存在。",
          retryable: false,
          action: "contact_support",
        }),
        { status: 404 },
      );
    }
    console.error("[batch:retry-one] request failed", {
      batchId: id,
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      customerApiError({
        code: "INTERNAL_ERROR",
        message: "暂时无法重试该任务，请稍后再试。",
        retryable: true,
        action: "retry",
      }),
      { status: 500 },
    );
  }
}
