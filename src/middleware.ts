import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { customerApiError } from "@/lib/contracts/customer-api";

/**
 * Phase 5 — middleware whitelist:
 *
 *  - `/login`, `/register`, `/api/auth/*` → 登录 / 公开注册 / NextAuth
 *  - `/persona`, `/showcase`, `/privacy`, `/terms` → public landing / legal pages
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
  "/api/auth",
  "/persona",
  "/showcase",
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
const exactPublicPaths = ["/api/webhooks/stripe"];

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
    publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/internal/");

  if (isPublic) return NextResponse.next();

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
  });

  if (!token) {
    if (pathname.startsWith("/api/")) {
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
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
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
