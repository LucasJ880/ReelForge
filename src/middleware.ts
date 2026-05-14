import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

/**
 * Phase 5 — middleware whitelist:
 *
 *  - `/login`, `/api/auth/*` → 登录页 / NextAuth
 *  - `/persona`, `/showcase` → public landing
 *  - `/demo`, `/api/demo` → 旧 demo（Step 8 会删 /demo/ai-video；这里先保留 /demo/real-footage-ads）
 *  - `/api/cron/*` → 定时任务（带 cron secret 鉴权，不走 NextAuth）
 *  - `/api/internal/stitch/*` → 外部 stitch runner 回调（同样带 cron secret 鉴权，不走 NextAuth）
 *
 * 旧路由迁移（Step 7 才落地实际页面，这里先准备 redirect）：
 *  - `/orders`, `/rounds`, `/briefs`, `/qa`, `/publish`, `/metrics`, `/distillation`,
 *    `/demo-leads`, `/admin`, `/settings`, `/projects`, `/videos` 在 Step 7 之前依旧可访问；
 *    Step 7 之后这些路径会被 308 重定向到 /internal/*。
 *
 *  - `/wizard/*` 在 Step 8 被删除；这里先返回 410 Gone 提示用户。
 */
const publicPaths = ["/login", "/api/auth", "/persona", "/showcase", "/demo", "/api/demo"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /wizard/* 已下线 → 410 Gone
  if (pathname === "/wizard" || pathname.startsWith("/wizard/")) {
    return NextResponse.json(
      {
        error: "Wizard has been deprecated. Please use /business/create-ad-video or /personal/create-video.",
      },
      { status: 410 },
    );
  }

  const isPublic =
    pathname === "/" ||
    publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/internal/stitch");

  if (isPublic) return NextResponse.next();

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie: process.env.NODE_ENV === "production",
  });

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)).*)",
  ],
};
