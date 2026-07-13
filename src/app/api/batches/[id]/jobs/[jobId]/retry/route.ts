import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  getBatchStatus,
  processBatchTick,
  retryFailedBatchJob,
} from "@/lib/services/batch-service";

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
        { error: "该任务不是可重试的失败状态" },
        { status: 409 },
      );
    }
    await processBatchTick(id);
    return NextResponse.json({
      batch: await getBatchStatus(id, guard.session.user.id),
    });
  } catch {
    return NextResponse.json({ error: "批次不存在" }, { status: 404 });
  }
}
