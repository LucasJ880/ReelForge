import { getServerSession, type Session } from "next-auth";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

export type AuthGuardResult =
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse };

type Role = "SUPER_ADMIN" | "OPERATOR" | "REVIEWER";

export async function requireAuth(): Promise<AuthGuardResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    };
  }
  return { ok: true, session };
}

export async function requireRole(
  allowed: readonly Role[],
): Promise<AuthGuardResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    };
  }
  if (!allowed.includes(session.user.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "权限不足" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session };
}

export async function requireSuperAdmin(): Promise<AuthGuardResult> {
  return requireRole(["SUPER_ADMIN"]);
}

export async function requireOperator(): Promise<AuthGuardResult> {
  return requireRole(["SUPER_ADMIN", "OPERATOR"]);
}

export async function requireReviewer(): Promise<AuthGuardResult> {
  return requireRole(["SUPER_ADMIN", "OPERATOR", "REVIEWER"]);
}

/**
 * Server Component / Page 层的 role guard。
 * - 未登录 → /login
 * - 登录但角色不在允许列表 → /orders（用户可见的安全 fallback）
 * 直接 throw 'NEXT_REDIRECT'，调用方拿到 session 即可继续。
 */
export async function requirePageRole(allowed: readonly Role[]): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login");
  }
  if (!allowed.includes(session.user.role)) {
    redirect("/orders");
  }
  return session;
}

/** Wizard 全部页面用：仅 SUPER_ADMIN / OPERATOR
 *
 * @deprecated Phase 5 — Wizard 已下线，保留 helper 仅为兼容旧 import；
 * 任何调用都会 redirect 到 /business/create-ad-video。
 */
export function requireWizardPage() {
  return requirePageRole(["SUPER_ADMIN", "OPERATOR"]);
}

/**
 * Phase 5 — persona-aware guards.
 *
 * Phase 1：所有 helper 都等价于 requireOperator（因为还没有真实的客户账号 + persona 分流）。
 * Phase 2 会改成根据 session.user.userType 真实分流：
 *   - requireBusinessUser → only userType=BUSINESS / OPERATOR / SUPER_ADMIN
 *   - requirePersonalUser → only userType=PERSONAL / OPERATOR / SUPER_ADMIN
 *   - requireInternal     → only userType=OPERATOR / SUPER_ADMIN
 */
export async function requireBusinessUser(): Promise<AuthGuardResult> {
  return requireRole(["SUPER_ADMIN", "OPERATOR", "REVIEWER"]);
}

export async function requirePersonalUser(): Promise<AuthGuardResult> {
  return requireRole(["SUPER_ADMIN", "OPERATOR", "REVIEWER"]);
}

export async function requireInternal(): Promise<AuthGuardResult> {
  return requireRole(["SUPER_ADMIN", "OPERATOR"]);
}
