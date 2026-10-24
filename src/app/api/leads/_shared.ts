import { NextResponse, type NextRequest } from "next/server";
import type { Session } from "next-auth";
import type { ZodError } from "zod";
import { requireAuth, requireSuperAdmin } from "@/lib/api-auth";
import { customerApiError } from "@/lib/contracts/customer-api";
import { db } from "@/lib/db";

/**
 * 工作台「询盘」管理接口（/api/leads/**）的共用件。middleware 不放行这些路径；
 * handler 里仍各自查会话（铁律：路由只做鉴权 + 参数校验，业务在 service）。
 */

export type LeadsGuard =
  | { ok: true; session: Session; workspaceId: string }
  | { ok: false; response: NextResponse };

/** 当前登录者的默认工作区（一人一个，ownerId 唯一）。 */
export async function requireLeadsWorkspace(): Promise<LeadsGuard> {
  const guard = await requireAuth();
  if (!guard.ok) return guard;
  const workspace = await db.workspace.findUnique({
    where: { ownerId: guard.session.user.id },
    select: { id: true },
  });
  if (!workspace) {
    return {
      ok: false,
      response: NextResponse.json(
        customerApiError({ code: "RESOURCE_NOT_FOUND", message: "工作台不存在", retryable: false, action: "contact_support" }),
        { status: 404 },
      ),
    };
  }
  return { ok: true, session: guard.session, workspaceId: workspace.id };
}

export { requireSuperAdmin };

export async function readJson(req: NextRequest): Promise<unknown | undefined> {
  try {
    return (await req.json()) as unknown;
  } catch {
    return undefined;
  }
}

export function validationFailed(error?: ZodError, reason?: string) {
  const first = error?.issues[0];
  return NextResponse.json(
    {
      ...customerApiError({
        code: "VALIDATION_FAILED",
        message: first ? `参数不合法：${first.path.join(".") || first.message}` : "参数不合法",
        retryable: false,
        action: "fix_request",
      }),
      reason: reason ?? first?.message ?? "invalid",
    },
    { status: 400 },
  );
}

export function notFound(message = "记录不存在") {
  return NextResponse.json(
    customerApiError({ code: "RESOURCE_NOT_FOUND", message, retryable: false, action: "contact_support" }),
    { status: 404 },
  );
}

export function invalidState(message: string, reason: string) {
  return NextResponse.json(
    {
      ...customerApiError({ code: "INVALID_STATE", message, retryable: false, action: "refresh_status" }),
      reason,
    },
    { status: 409 },
  );
}

export function internalError(scope: string, error: unknown) {
  console.error(`[leads:${scope}] request failed`, {
    error: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json(
    customerApiError({ code: "INTERNAL_ERROR", message: "暂时没保存成功，请稍后再试", retryable: true, action: "retry" }),
    { status: 500 },
  );
}
