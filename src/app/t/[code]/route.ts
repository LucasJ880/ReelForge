import { NextResponse, type NextRequest } from "next/server";
import { clientIpFromHeaders, handleTrackedLinkVisit } from "@/lib/services/tracked-link-service";

export const dynamic = "force-dynamic";

/**
 * /t/[code] —— 追踪链接（匿名，middleware 只放行单段 /t/<code>）。
 * 302 + no-store：浏览器不缓存跳转，每次点开都经过这里计数。
 * 跳转目标只可能是本工作区询盘页或超管登记的 https 商家域名（见 tracked-link-service）。
 */
const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

async function visit(req: NextRequest, params: Promise<{ code: string }>, method: "GET" | "HEAD") {
  const { code } = await params;
  try {
    const result = await handleTrackedLinkVisit({
      code,
      method,
      userAgent: req.headers.get("user-agent"),
      referer: req.headers.get("referer"),
      ip: clientIpFromHeaders(req.headers),
    });
    if (result.status === "not_found") {
      return new NextResponse(method === "HEAD" ? null : "链接不存在或已停用 / This link is no longer active.\n", {
        status: 404,
        headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    const response = NextResponse.redirect(new URL(result.location, req.url), 302);
    for (const [key, value] of Object.entries(NO_STORE)) response.headers.set(key, value);
    return response;
  } catch (error) {
    console.error("[tracked-link] visit failed", {
      code,
      error: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse(method === "HEAD" ? null : "暂时打不开，请稍后再试 / Please try again shortly.\n", {
      status: 503,
      headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8", "Retry-After": "30" },
    });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  return visit(req, params, "GET");
}

/// HEAD 是预取 / 探活：照样跳转（预览能拿到目标），但只记录不计数。
export async function HEAD(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  return visit(req, params, "HEAD");
}
