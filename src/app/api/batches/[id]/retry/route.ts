import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  getBatchStatus,
  processBatchTick,
  retryFailedBatchJobs,
  toCustomerBatchStatus,
} from "@/lib/services/batch-service";
import { customerApiError } from "@/lib/api/customer-generation-error";

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
    return NextResponse.json({
      retried,
      batch: toCustomerBatchStatus(
        await getBatchStatus(id, guard.session.user.id),
      ),
    });
  } catch (error) {
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
