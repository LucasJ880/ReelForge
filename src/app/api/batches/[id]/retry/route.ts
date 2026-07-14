import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  BatchNotFoundError,
  getBatchStatus,
  processBatchTick,
  retryFailedBatchJobs,
  toCustomerBatchStatus,
} from "@/lib/services/batch-service";
import { customerApiError } from "@/lib/api/customer-generation-error";
import { batchRetryAllResponseSchema } from "@/lib/contracts/batch-api";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  try {
    await getBatchStatus(id, guard.session.user.id);
    const retried = await retryFailedBatchJobs(id);
    await processBatchTick(id);
    return NextResponse.json(
      batchRetryAllResponseSchema.parse({
        retried,
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
    console.error("[batch:retry-all] request failed", {
      batchId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      customerApiError({
        code: "INTERNAL_ERROR",
        message: "暂时无法重试批次，请稍后再试。",
        retryable: true,
        action: "retry",
      }),
      { status: 500 },
    );
  }
}
