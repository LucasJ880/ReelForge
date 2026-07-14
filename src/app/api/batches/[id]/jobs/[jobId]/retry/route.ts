import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  getBatchStatus,
  processBatchTick,
  retryFailedBatchJob,
  toCustomerBatchStatus,
} from "@/lib/services/batch-service";
import { customerApiError } from "@/lib/api/customer-generation-error";

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
    const retried = await retryFailedBatchJob(id, jobId);
    if (!retried) {
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
    return NextResponse.json({
      batch: toCustomerBatchStatus(
        await getBatchStatus(id, guard.session.user.id),
      ),
    });
  } catch (error) {
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
