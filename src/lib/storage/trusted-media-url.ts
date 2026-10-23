/**
 * 服务端代用户去抓的媒体 URL 必须落在明确放行的主机上。
 *
 * brand-packaging 曾直接 `fetch(用户给的任意 URL)`：没有白名单、不限大小、错误信息
 * 回显 URL，等于给任何登录用户一个探测内网的 SSRF 口子。界面只传 videoJobId /
 * briefId / brandPackageId，从不传 URL，所以默认一个主机都不放行（fail-closed）；
 * 确实需要时用 `MEDIA_FETCH_HOST_ALLOWLIST` 显式放行，写法同
 * SHUYU_OUTPUT_HOST_ALLOWLIST（`*.example.com` 表示子域）。
 * 注意不要放行 `*.blob.vercel-storage.com`：任何 Vercel 用户都能开自己的 store。
 */

export function trustedMediaHosts(): string[] {
  return (process.env.MEDIA_FETCH_HOST_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function hostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  const candidate = hostname.toLowerCase();
  return allowedHosts.some((entry) => {
    const allowed = entry.trim().toLowerCase();
    if (allowed.startsWith("*.")) {
      const suffix = allowed.slice(1);
      return candidate.endsWith(suffix) && candidate !== suffix.slice(1);
    }
    return candidate === allowed;
  });
}

export function isTrustedMediaUrl(
  value: string,
  allowedHosts: readonly string[] = trustedMediaHosts(),
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    hostAllowed(url.hostname, allowedHosts)
  );
}

export class MediaFetchError extends Error {}

const DEFAULT_MEDIA_FETCH_TIMEOUT_MS = 60_000;

/**
 * 抓取媒体：边读边计数，超过上限立刻中止；整体超时；错误信息不带 URL。
 * 用户给的 URL 先用 isTrustedMediaUrl 校验，且不跟随重定向（防止放行的主机把请求
 * 转去内网）；库里由服务端写入的 URL 可以传 followRedirects: true，保持原有行为。
 */
export async function fetchMediaBytes(
  url: string,
  options: {
    maxBytes: number;
    followRedirects?: boolean;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_MEDIA_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      redirect: options.followRedirects ? "follow" : "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new MediaFetchError(`media download failed (${response.status})`);
    }
    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      throw new MediaFetchError("media file is too large");
    }
    if (!response.body) return Buffer.alloc(0);

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > options.maxBytes) {
        controller.abort();
        throw new MediaFetchError("media file is too large");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof MediaFetchError) throw error;
    if (controller.signal.aborted) {
      throw new MediaFetchError("media download timed out");
    }
    throw new MediaFetchError("media download failed");
  } finally {
    clearTimeout(timer);
  }
}
