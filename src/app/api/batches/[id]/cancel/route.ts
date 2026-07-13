import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  cancelPendingBatchJobs,
  getBatchStatus,
} from "@/lib/services/batch-service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  try {
    await getBatchStatus(id, guard.session.user.id);
    const cancelled = await cancelPendingBatchJobs(id);
    return NextResponse.json({
      cancelled,
      batch: await getBatchStatus(id, guard.session.user.id),
    });
  } catch {
    return NextResponse.json({ error: "批次不存在" }, { status: 404 });
  }
}
