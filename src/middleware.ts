import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { customerApiError } from "@/lib/contracts/customer-api";
import { decideDemoAccess, demoBlockedBody } from "@/lib/demo-account";
import { evaluateSessionClaims } from "@/lib/session-policy";

const SESSION_COOKIE = /^(__Secure-)?next-auth\.session-token(\.\d+)?$/;

/// 作废的会话顺手把 cookie 清掉（含分片），浏览器不再拿着死 token 来回撞。
/// `__Secure-` 前缀的 cookie 必须带 Secure 才清得掉。
function clearSessionCookies(req: NextRequest, res: NextResponse): NextResponse {
  for (const { name } of req.cookies.getAll()) {
    if (!SESSION_COOKIE.test(name)) continue;
    res.cookies.set({
      name,
      value: "",
      expires: new Date(0),
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: name.startsWith("__Secure-"),
    });
  }
  return res;
}

/**
 * Phase 5 — middleware whitelist:
 *
 *  - `/login`, `/register`, `/api/auth/*` → 登录 / 公开注册 / NextAuth
 *  - `/forgot-password`, `/reset-password` → 密码找回两页（接口在 `/api/auth/password-reset/*`，随 `/api/auth` 放行）
 *  - `/privacy`, `/terms` → public legal pages
 *  - `/demo`, `/api/demo` → 旧 demo（Step 8 会删 /demo/ai-video；这里先保留 /demo/real-footage-ads）
 *  - `/api/cron/*` → 定时任务（带 cron secret 鉴权，不走 NextAuth）
 *  - `/api/internal/*` → 外部 runner（stitch / digital-human 等）回调与领单。
 *    这些路由统一不走 NextAuth，而是各自在 handler 内用 `Bearer ${CRON_SECRET}` 自鉴权
 *    （见 src/app/api/internal/**\/route.ts）。新增 internal runner 路由时务必保持这一约定，
 *    否则放行后会绕过鉴权。
 *
 * 旧路由迁移（Step 7 才落地实际页面，这里先准备 redirect）：
 *  - `/orders`, `/rounds`, `/briefs`, `/qa`, `/publish`, `/metrics`, `/distillation`,
 *    `/demo-leads`, `/admin`, `/settings`, `/projects`, `/videos` 在 Step 7 之前依旧可访问；
 *    Step 7 之后这些路径会被 308 重定向到 /internal/*。
 *
 *  - `/wizard/*` 在 Step 8 被删除；这里先返回 410 Gone 提示用户。
 */
const publicPaths = [
  "/login",
  "/register",
  /// 忘记密码 / 设置新密码：没登录的人才用得上
  "/forgot-password",
  "/reset-password",
  "/api/auth",
  "/privacy",
  "/terms",
  "/demo",
  "/api/demo",
  // 健康检查端点：设计上无鉴权、已脱敏（见 src/app/api/health/route.ts 安全约定），
  // 供监控 / Vercel 探活直接拉，否则会被当作未登录 401 拦截。
  "/api/health",
];

// Stripe cannot present a NextAuth session. Only the exact webhook endpoint is
// allowed through middleware; the handler still rejects missing/invalid Stripe
// signatures before applying any billing state.
// 青砚 aivora-sync 是外部定时任务，同样出示不了 NextAuth 会话（PRD §9）。
// 只放行精确路径，不用前缀：以后新增 /api/videos/* 子路由时必须各自单独评估，
// 不能被这一条顺带放开。route handler 里的 machineAuthFailure 是 fail-closed 的
// （CRON_SECRET 缺失直接 503），它才是真正的守卫。
const exactPublicPaths = [
  "/api/webhooks/stripe",
  "/api/videos",
  /// 青砚回灌渠道指标（PRD §4 R2）。同样由 machineAuthFailure fail-closed 守卫。
  "/api/performance",
  /// 公开表单（询盘 / 试点申请）：只放行这两个精确的提交端点，handler 内做蜜罐、
  /// 限流与校验；工作台的询盘管理接口在 /api/leads 下，仍走会话鉴权。
  "/api/public/leads",
  "/api/public/pilot-applications",
];

/// 匿名访客入口：商家询盘页 /l/[slug] 与追踪链接 /t/[code]，只放行单段路径。
const publicPatterns = [/^\/l\/[a-z0-9-]{2,64}$/, /^\/t\/[A-Za-z0-9_-]{4,32}$/];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /wizard/* 已下线 → 410 Gone
  if (pathname === "/wizard" || pathname.startsWith("/wizard/")) {
    return NextResponse.json(
      {
        error: "Wizard has been deprecated. Please use /app/create.",
      },
      { status: 410 },
    );
  }

  const isPublic =
    pathname === "/" ||
    exactPublicPaths.includes(pathname) ||
    publicPatterns.some((pattern) => pattern.test(pathname)) ||
    publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/internal/");

  if (isPublic) return NextResponse.next();

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
  });

  /// 演示账号：生产环境的会话一律作废（不等 AUTH_SECRET 轮换）；允许登录的环境
  /// 里也只读，写请求 403。判定见 src/lib/demo-account.ts。
  const demoAccess = token
    ? decideDemoAccess({
        email: typeof token.email === "string" ? token.email : null,
        method: req.method,
        pathname,
      })
    : "allow";

  /// 会话安全闸（session-policy）：登录满 7 天、或不是本次发布签发的登录一律作废。
  /// 闲置超时由 token 自己的 exp 管，getToken 已经判过。
  const sessionExpired = token !== null && evaluateSessionClaims(token) !== "ok";

  if (!token || sessionExpired || demoAccess === "unauthenticated") {
    if (pathname.startsWith("/api/")) {
      const response = NextResponse.json(
        customerApiError({
          code: "AUTH_REQUIRED",
          message: sessionExpired ? "登录已失效，请重新登录" : "未登录",
          retryable: false,
          action: "sign_in",
        }),
        { status: 401 },
      );
      return token ? clearSessionCookies(req, response) : response;
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    if (sessionExpired) loginUrl.searchParams.set("reason", "expired");
    const response = NextResponse.redirect(loginUrl);
    return token ? clearSessionCookies(req, response) : response;
  }

  if (demoAccess === "blocked") {
    return NextResponse.json(demoBlockedBody(), { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /**
     * 排除以下路径不进入 middleware：
     *   - Next.js 内部资源（_next/static / _next/image / favicon.ico）
     *   - 图片扩展名（png/jpg/jpeg/svg/ico/webp/gif）—— 自带公开访问语义
     *   - 视频 / 音频扩展名（mp4/webm/mov/m4v/mp3/wav/ogg）—— public/generated/
     *     下的 demo 视频是公开素材，未登录用户也应能直接播放；如果不排除，
     *     <video> 标签会被 NextAuth 重定向到 /login，浏览器静默失败
     *
     * 注意：personal / business 用户自己的私人视频必须走 Vercel Blob 私有 token 或
     *      签名 API 路径，不会用 public/ 直链，因此放开静态视频扩展不会泄漏私密资源。
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|gif|mp4|webm|mov|m4v|mp3|wav|ogg)).*)",
  ],
};
