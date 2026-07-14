import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  BatchDispatchNotAuthorizedError,
  BatchNotFoundError,
  getBatchStatus,
  processBatchTick,
  toCustomerBatchStatus,
} from "@/lib/services/batch-service";
import { customerApiError } from "@/lib/api/customer-generation-error";
import { batchStatusResponseSchema } from "@/lib/contracts/batch-api";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  try {
    const batch = await getBatchStatus(id, guard.session.user.id);
    return NextResponse.json(
      batchStatusResponseSchema.parse({
        batch: toCustomerBatchStatus(batch),
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
    console.error("[batch:status] lookup failed", {
      batchId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      customerApiError({
        code: "INTERNAL_ERROR",
        message: "暂时无法读取批次，请稍后重试。",
        retryable: true,
        action: "retry",
      }),
      { status: 500 },
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
    return NextResponse.json(
      batchStatusResponseSchema.parse({
        batch: toCustomerBatchStatus(batch),
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
    if (error instanceof BatchDispatchNotAuthorizedError) {
      return NextResponse.json(
        customerApiError({
          code: "INVALID_STATE",
          message: "批次额度尚未确认，暂时不能开始生成。",
          retryable: false,
          action: "contact_support",
        }),
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[batch:status] tick failed", { batchId: id, error: message });
    return NextResponse.json(
      customerApiError({
        code: "INTERNAL_ERROR",
        message: "暂时无法刷新批次，请稍后重试。",
        retryable: true,
        action: "retry",
      }),
      { status: 500 },
    );
  }
}
