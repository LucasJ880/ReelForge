import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  getBatchStatus,
  processBatchTick,
  toCustomerBatchStatus,
} from "@/lib/services/batch-service";
import { customerApiError } from "@/lib/api/customer-generation-error";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  try {
    const batch = await getBatchStatus(id, guard.session.user.id);
    return NextResponse.json({ batch: toCustomerBatchStatus(batch) });
  } catch {
    return NextResponse.json(
      customerApiError({
        code: "INTERNAL_ERROR",
        message: "批次不存在。",
        retryable: false,
        action: "contact_support",
      }),
      { status: 404 },
    );
  }
}

/**
 * 单一聚合轮询端点：一次 tick 内批量 reconcile + 受控提交，然后返回 N 条状态。
 * 前端每 15 秒只调用此端点 1 次，连接数与 requestedCount 无关（INV-B7）。
 */
export async function POST(_req: NextRequest, context: RouteContext) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  try {
    await getBatchStatus(id, guard.session.user.id);
    await processBatchTick(id);
    const batch = await getBatchStatus(id, guard.session.user.id);
    return NextResponse.json({ batch: toCustomerBatchStatus(batch) });
  } catch (error) {
    const message = (error as Error).message;
    console.error("[batch:status] tick failed", { batchId: id, error: message });
    const notFound = message.includes("无权") || message.includes("不存在");
    return NextResponse.json(
      customerApiError({
        code: "INTERNAL_ERROR",
        message: notFound ? "批次不存在。" : "暂时无法刷新批次，请稍后重试。",
        retryable: !notFound,
        action: notFound ? "contact_support" : "retry",
      }),
      { status: notFound ? 404 : 500 },
    );
  }
}
