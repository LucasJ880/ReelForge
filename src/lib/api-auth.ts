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

/** Wizard 全部页面用：仅 SUPER_ADMIN / OPERATOR */
export function requireWizardPage() {
  return requirePageRole(["SUPER_ADMIN", "OPERATOR"]);
}
