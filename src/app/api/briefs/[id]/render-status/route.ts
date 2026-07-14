import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkBriefAccess } from "@/lib/services/brief-access";
import {
  reconcileBriefRenderStatus,
  summarizeBriefRender,
  toCustomerBriefRenderSummary,
} from "@/lib/services/video-service";
import { customerApiError } from "@/lib/api/customer-generation-error";

function canSeeRenderDebug(userType: string | null | undefined): boolean {
  return userType === "OPERATOR" || userType === "SUPER_ADMIN";
}

function presentSummary<T>(summary: T, userType: string | null | undefined) {
  return canSeeRenderDebug(userType)
    ? summary
    : toCustomerBriefRenderSummary(
        summary as Awaited<ReturnType<typeof summarizeBriefRender>>,
      );
}

function accessError(reason: "not-found" | "forbidden") {
  return NextResponse.json(
    customerApiError({
      code: "INTERNAL_ERROR",
      message: reason === "not-found" ? "生成记录不存在。" : "无权访问该生成记录。",
      retryable: false,
      action: "contact_support",
    }),
    { status: reason === "not-found" ? 404 : 403 },
  );
}

/**
 * GET：返回该 brief 的视频生成进度概要（用户安全字段 + debug 字段分离）。
 *      不会触碰 Provider，只读 DB —— UI 频繁刷新成本可控。
 *
 * POST：调用方主动调和 Provider 状态后再返回最新概要。
 *       调用代价：每次会向 Seedance 查 N 次（N = 在飞 job 数）。
 *       前端「刷新状态」按钮使用此端点。
 *
 * Phase 6 鉴权：任何登录账号 + brief 归属权（自己创建 OR 内部 staff）。
 * 客户用户只能查 / 调和自己的 brief；内部 staff 可看任意 brief 用于调试。
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const access = await checkBriefAccess(id, guard.session);
  if (!access.allowed) {
    return accessError(access.reason === "not-found" ? "not-found" : "forbidden");
  }

  try {
    const summary = await summarizeBriefRender(id);
    return NextResponse.json(
      presentSummary(summary, guard.session.user.userType),
    );
  } catch (err) {
    console.error("[render-status:get] summary failed", {
      briefId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      customerApiError({
        code: "INTERNAL_ERROR",
        message: "暂时无法读取生成进度，请稍后重试。",
        retryable: true,
        action: "retry",
      }),
      { status: 500 },
    );
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const access = await checkBriefAccess(id, guard.session);
  if (!access.allowed) {
    return accessError(access.reason === "not-found" ? "not-found" : "forbidden");
  }

  try {
    const summary = await reconcileBriefRenderStatus(id);
    return NextResponse.json(
      presentSummary(summary, guard.session.user.userType),
    );
  } catch (err) {
    console.error("[render-status:post] reconciliation failed", {
      briefId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      customerApiError({
        code: "INTERNAL_ERROR",
        message: "暂时无法刷新生成进度，请稍后重试。",
        retryable: true,
        action: "retry",
      }),
      { status: 500 },
    );
  }
}
