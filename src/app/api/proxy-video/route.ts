import { NextRequest, NextResponse } from "next/server";

/**
 * 通用代理路由：让浏览器端 ffmpeg.wasm（Brand Lock / 视频拼接）
 * 能绕过 CORS 拉取远端视频（即梦 / Vercel Blob / 其他 CDN）。
 *
 * 直接流式转发上游响应，避免 Vercel Function 内存限制。
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "missing url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (!["http:", "https:"].includes(target.protocol)) {
    return NextResponse.json({ error: "unsupported protocol" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: "video/mp4,video/*,*/*;q=0.9",
      },
      redirect: "follow",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "upstream fetch failed",
        reason: err instanceof Error ? err.message : String(err),
        upstreamUrl: target.toString(),
      },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      {
        error: `Upstream ${upstream.status}`,
        reason: upstream.statusText,
        upstreamUrl: target.toString(),
      },
      { status: upstream.status >= 400 ? upstream.status : 502 },
    );
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  const contentLength = upstream.headers.get("content-length");
  if (contentType) headers.set("content-type", contentType);
  if (contentLength) headers.set("content-length", contentLength);
  headers.set("access-control-allow-origin", "*");
  headers.set("cache-control", "public, max-age=300");

  return new NextResponse(upstream.body, { status: 200, headers });
}
