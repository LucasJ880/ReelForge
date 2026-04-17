import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 通用媒体代理 —— 把第三方 CDN 的视频/音频/图片转给浏览器，解决两类问题：
 *   1. 浏览器侧 CORS（Pexels/Unsplash 等 CDN 不返回 Access-Control-Allow-Origin）
 *   2. Hotlink 防护（Pexels CDN 对裸请求返回 403，必须带 UA/Referer）
 *
 * 额外：
 *   - 自动跟随 3xx（fetch 默认就会）
 *   - 对 4xx/5xx 返回带 upstreamUrl 的 JSON，方便前端区分"下载失败"和"合成失败"
 *   - 流式转发 —— 不把 mp4 全量加载到内存，绕开 Vercel Serverless 4.5MB 响应体限制
 */

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

function guessReferer(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("pexels.com")) return "https://www.pexels.com/";
    if (u.hostname.endsWith("pixabay.com")) return "https://pixabay.com/";
    if (u.hostname.endsWith("unsplash.com")) return "https://unsplash.com/";
    return `${u.protocol}//${u.hostname}/`;
  } catch {
    return "https://www.google.com/";
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Referer: guessReferer(url),
        Accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      },
      redirect: "follow",
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Proxy fetch failed",
        reason: e instanceof Error ? e.message : String(e),
        upstreamUrl: url,
      },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: `Upstream ${upstream.status}`,
        reason: upstream.statusText,
        upstreamUrl: url,
      },
      { status: upstream.status >= 500 ? 502 : upstream.status },
    );
  }

  const contentType =
    upstream.headers.get("content-type") || "application/octet-stream";
  const contentLength = upstream.headers.get("content-length");

  // 流式转发，不在 Serverless 内存里堆整个 mp4
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=86400",
    "Access-Control-Allow-Origin": "*",
  };
  if (contentLength) headers["Content-Length"] = contentLength;

  return new NextResponse(upstream.body, { headers });
}
