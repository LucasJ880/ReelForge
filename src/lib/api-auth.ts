import { getServerSession, type Session } from "next-auth";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { customerApiError } from "@/lib/contracts/customer-api";

function authRequiredResponse() {
  return NextResponse.json(
    customerApiError({
      code: "AUTH_REQUIRED",
      message: "未登录",
      retryable: false,
      action: "sign_in",
    }),
    { status: 401 },
  );
}

function forbiddenResponse(message = "权限不足") {
  return NextResponse.json(
    customerApiError({
      code: "FORBIDDEN",
      message,
      retryable: false,
      action: "contact_support",
    }),
    { status: 403 },
  );
}

export type AuthGuardResult =
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse };

type Role = "SUPER_ADMIN" | "OPERATOR" | "REVIEWER" | "CUSTOMER";

/**
 * Persona discriminator on AdminUser.userType.
 * - "OPERATOR" / "SUPER_ADMIN"  → 内部员工，通常 bypass persona 校验
 * - "BUSINESS"                   → 商家用户，访问 /business/*
 * - "PERSONAL"                   → 个人用户，访问 /personal/*
 * - null                         → 老账号或未选 persona，需要走 /persona 选一次
 */
export type UserPersona = "BUSINESS" | "PERSONAL" | "OPERATOR" | "SUPER_ADMIN";

export async function requireAuth(): Promise<AuthGuardResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      ok: false,
      response: authRequiredResponse(),
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
      response: authRequiredResponse(),
    };
  }
  if (!allowed.includes(session.user.role)) {
    return {
      ok: false,
      response: forbiddenResponse(),
    };
  }
  return { ok: true, session };
}

export async function requireSuperAdmin(): Promise<AuthGuardResult> {
  return requireRole(["SUPER_ADMIN"]);
}

/**
 * 内部 admin 端点专用（delivery-orders / qa / publish / metrics 等）。
 *
 * Phase 5 收紧：除了原本的 role 检查，还要确保 userType 是内部 persona
 * （OPERATOR / SUPER_ADMIN），防止 PERSONAL/BUSINESS 自助注册账号
 * 因 default role=OPERATOR 而误得到管理员权限。
 *
 * 旧账号兼容：normalizeUserType 在 src/lib/auth.ts 会把 userType=null
 * 的旧 OPERATOR/SUPER_ADMIN 账号 normalize 成 "OPERATOR" / "SUPER_ADMIN"，
 * 因此对存量数据无副作用。
 */
export async function requireOperator(): Promise<AuthGuardResult> {
  const auth = await requireRole(["SUPER_ADMIN", "OPERATOR"]);
  if (!auth.ok) return auth;
  const userType = auth.session.user.userType;
  if (userType === "PERSONAL" || userType === "BUSINESS") {
    return {
      ok: false,
      response: forbiddenResponse(),
    };
  }
  return auth;
}

export async function requireReviewer(): Promise<AuthGuardResult> {
  const auth = await requireRole(["SUPER_ADMIN", "OPERATOR", "REVIEWER"]);
  if (!auth.ok) return auth;
  const userType = auth.session.user.userType;
  if (userType === "PERSONAL" || userType === "BUSINESS") {
    return {
      ok: false,
      response: forbiddenResponse(),
    };
  }
  return auth;
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
 * Server Component / Page 层的 persona guard。
 *
 * - 未登录          → /login?from=<intended>
 * - 登录但 persona 不匹配（且非内部 staff） → 跳到他自己 persona 的根页面，
 *   避免「BUSINESS 用户跑去 /personal 被踢回 /login，看到登录框，懵」。
 * - 内部 staff     → 直接放行
 *
 * 使用方式：在 layout.tsx 顶部 await，函数永不 return 给错误用户。
 */
export async function requirePersonaPage(
  allowed: readonly ("BUSINESS" | "PERSONAL")[],
  intendedPath: string,
): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect(`/login?from=${encodeURIComponent(intendedPath)}`);
  }
  const userType = session.user.userType;

  if (userType === "OPERATOR" || userType === "SUPER_ADMIN") {
    return session;
  }

  if (
    (userType === "BUSINESS" || userType === "PERSONAL") &&
    allowed.includes(userType)
  ) {
    return session;
  }

  /// 已登录但 persona 不在允许列表 → 跳他自己的家
  if (userType === "BUSINESS") {
    redirect("/business");
  }
  if (userType === "PERSONAL") {
    redirect("/personal");
  }
  /// 没选过 persona → /persona 选一次
  redirect("/persona");
}

/**
 * Phase 5 — Persona-aware guards.
 *
 * 通用模型：
 *   - 内部 staff（userType=OPERATOR / SUPER_ADMIN）拥有"全通行"权限，可以
 *     访问 BUSINESS / PERSONAL 表面。这是工程必要：运维 / 客服 / QA 都要能
 *     进客户视图调试。
 *   - 客户用户（userType=BUSINESS / PERSONAL）只能访问对应 persona 的表面。
 *   - 没有 userType 的账号（理论上不应该出现，session 已 normalize）按拒绝处理。
 *
 * Phase 6+ 想要的"客服 view-as 用户"等更细的能力另做。
 */
export async function requireUserOfPersona(
  allowed: readonly ("BUSINESS" | "PERSONAL")[],
): Promise<AuthGuardResult> {
  const auth = await requireAuth();
  if (!auth.ok) return auth;
  const userType = auth.session.user.userType;

  /// 内部 staff 永远 bypass
  if (userType === "OPERATOR" || userType === "SUPER_ADMIN") {
    return auth;
  }

  if (
    userType === "BUSINESS" ||
    userType === "PERSONAL"
  ) {
    if (allowed.includes(userType)) return auth;
  }

  return {
    ok: false,
    response: forbiddenResponse(),
  };
}

export async function requireBusinessUser(): Promise<AuthGuardResult> {
  return requireUserOfPersona(["BUSINESS"]);
}

export async function requirePersonalUser(): Promise<AuthGuardResult> {
  return requireUserOfPersona(["PERSONAL"]);
}

/**
 * 内部 only 入口（与 requireOperator 等价；保留命名做意图区分）。
 */
export async function requireInternal(): Promise<AuthGuardResult> {
  return requireOperator();
}

/**
 * Server Component / Page 层的 internal guard。
 * - 未登录 → /login?from=…
 * - PERSONAL / BUSINESS 已登录但无 internal 权限 → 各自 persona 首页（与 requirePersonaPage 对称）
 * - 内部 staff → 放行
 */
export async function requireInternalPage(
  intendedPath = "/internal",
): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect(`/login?from=${encodeURIComponent(intendedPath)}`);
  }
  const userType = session.user.userType;
  if (userType === "PERSONAL") redirect("/personal");
  if (userType === "BUSINESS") redirect("/business");

  const guard = await requireOperator();
  if (!guard.ok) {
    redirect("/persona");
  }
  return guard.session;
}

/**
 * 共享 video generation 端点专用（plan / dispatch / classify-asset / blob upload）。
 *
 * 任何已选 persona 的客户用户（BUSINESS 或 PERSONAL）都可调用；内部 staff bypass。
 * 调用方拿到 guard.ok=true 后，应再把请求 body 里的 `request.userType` 与
 * session.user.userType 做一致性校验（内部 staff 可代任意 persona 调用）。
 */
export async function requireUserOfTypeForGeneration(): Promise<AuthGuardResult> {
  const auth = await requireRole(["SUPER_ADMIN", "OPERATOR", "REVIEWER", "CUSTOMER"]);
  if (!auth.ok) return auth;
  if (auth.session.user.role !== "CUSTOMER") return auth;

  const { db } = await import("@/lib/db");
  const workspace = await db.workspace.findUnique({
    where: { ownerId: auth.session.user.id },
    select: { id: true },
  });
  if (!workspace) {
    return {
      ok: false,
      response: forbiddenResponse("账号工作区尚未就绪，请联系支持"),
    };
  }
  return auth;
}

/// 仅供测试 / 文档用：暴露内部判定逻辑给单测无 IO 时使用。
export const __test__ = {
  /// pure：只看 role + userType，不做 db / network；和实际 require* 同步演变
  classifyAccess(args: {
    role: Role | null | undefined;
    userType: UserPersona | null | undefined;
    hasWorkspace?: boolean;
    expecting: "operator" | "reviewer" | "platform" | "generation" | "internal";
  }): "allow" | "deny-not-logged-in" | "deny-forbidden" {
    if (!args.role) return "deny-not-logged-in";
    const isInternalRole = args.role === "OPERATOR" || args.role === "SUPER_ADMIN";
    const isReviewerRole = args.role === "REVIEWER" || isInternalRole;

    switch (args.expecting) {
      case "operator":
      case "internal":
        return isInternalRole ? "allow" : "deny-forbidden";
      case "reviewer":
        return isReviewerRole ? "allow" : "deny-forbidden";
      case "platform":
      case "generation":
        if (args.role === "CUSTOMER" && args.hasWorkspace !== true) return "deny-forbidden";
        return "allow";
    }
  },
};
