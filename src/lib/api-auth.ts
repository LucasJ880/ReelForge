import { getServerSession, type Session } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

export type AuthGuardResult =
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse };

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

export async function requireAdmin(): Promise<AuthGuardResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    };
  }
  if (session.user.role !== "ADMIN") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "此操作需要管理员权限" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session };
}

/**
 * 创作类 API 守卫：ADMIN 直接放行；普通用户必须有活跃 PRO 订阅。
 * 返回 402 Payment Required，前端可识别并跳转到 /pricing。
 */
export async function requirePro(): Promise<AuthGuardResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    };
  }
  if (session.user.role === "ADMIN") {
    return { ok: true, session };
  }

  const expiresAtStr = session.user.planExpiresAt;
  const isActivePro =
    session.user.planTier === "PRO" &&
    !!expiresAtStr &&
    new Date(expiresAtStr).getTime() > Date.now();

  if (!isActivePro) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "需要 Pro 订阅才能执行此操作",
          code: "SUBSCRIPTION_REQUIRED",
          upgradeUrl: "/pricing",
        },
        { status: 402 },
      ),
    };
  }

  return { ok: true, session };
}
