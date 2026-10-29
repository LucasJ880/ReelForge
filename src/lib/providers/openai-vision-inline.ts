import {
  fetchMediaBytes,
  isTrustedMediaUrl,
  trustedMediaHosts,
} from "@/lib/storage/trusted-media-url";

/**
 * 看图时 OpenAI 拉图失败的兜底（10-29 视频评测集复现）。
 *
 * analyzeImages 默认把图片 URL 交给 OpenAI 自己下载，它只等约 3 秒（10-29 真机探测：慢地址 3.3s 就回
 * `400 Unable to download content from the provided URL before the timeout`）。Blob 冷缓存下 2–3MB 的
 * 商品 PNG 偶尔赶不上，约 20 次看图里有 1 次。调用方（参考图理解 / 抽卡评审 / 产品图读事实）把它当
 * 「看图失败」吞掉走兜底，一致性设定里的商品描述就只能凭文件名写。
 *
 * 兜底：认出这类下载失败 → 服务端限时、限大小取图 → sharp 缩到 OpenAI 实际会看的尺寸 → data URL 重试一次。
 * 只取可信主机（本项目自己的 Blob store + MEDIA_FETCH_HOST_ALLOWLIST）：产品图读事实的 URL 来自商家
 * 输入，服务端替人去抓任意 URL 就是 SSRF 口子（见 trusted-media-url）。
 *
 * 这类错误是「图没拉到」，不是 key / 额度问题：调用方不该据此把「AI 看图」标成故障。
 */

/** 服务端取一张图的总超时：比 OpenAI 的 ~3 秒宽得多，但不能拖垮调用方自己的预算（抽卡评审 60s、审帧 25s）。 */
export const VISION_INLINE_FETCH_TIMEOUT_MS = 12_000;
/** 单张原图上限，与 OpenAI 单图上限同为 20MB。 */
export const VISION_INLINE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * OpenAI 拉图失败的报文。10-29 真机探测四种都是 400 + code `invalid_image_url`：
 * 超时「Unable to download content from the provided URL before the timeout」、
 * 「Error while downloading file.（Upstream status code: 404.）」、「Failed to download file.」。
 * 报文兜底一并认，免得哪天 code 改名又静默降级。
 */
const DOWNLOAD_FAILURE_PATTERN =
  /unable to download|error while downloading|failed to download|timeout while downloading/i;

/** 服务端也没能把图转成 data URL（不可信主机 / 下载失败 / 解不开）。同属「图没拉到」。 */
export class VisionImageInlineError extends Error {
  readonly code = "vision_image_inline_failed";

  constructor(message: string) {
    super(message);
    this.name = "VisionImageInlineError";
  }
}

export function isImageDownloadError(err: unknown): boolean {
  if (err instanceof VisionImageInlineError) return true;
  if (!err || typeof err !== "object") return false;
  const { status, code, message } = err as { status?: unknown; code?: unknown; message?: unknown };
  /// 只有 400 是「图没拉到」；429 / 5xx 是限流或上游抖动，换成 data URL 也没用。
  if (typeof status === "number" && status !== 400) return false;
  if (code === "invalid_image_url") return true;
  return typeof message === "string" && DOWNLOAD_FAILURE_PATTERN.test(message);
}

/**
 * 本项目 Blob store 的公开主机：`vercel_blob_rw_<storeId>_<secret>` → `<storeid>.public.blob.vercel-storage.com`，
 * 与 @vercel/blob 拼公开 URL 是同一条规则。不能放行整个 `*.blob.vercel-storage.com`：任何人都能开自己的 store。
 */
export function ownBlobPublicHost(env: Record<string, string | undefined> = process.env): string | null {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim() ?? "";
  if (!token.startsWith("vercel_blob_rw_")) return null;
  const storeId = token.split("_")[3] ?? "";
  return /^[a-z0-9]+$/i.test(storeId) ? `${storeId.toLowerCase()}.public.blob.vercel-storage.com` : null;
}

export function visionInlineHosts(): string[] {
  const own = ownBlobPublicHost();
  return [...(own ? [own] : []), ...trustedMediaHosts()];
}

/** OpenAI 实际看的尺寸：low 一律压成 512²，high / auto 先压进 2048²。再大只是白传字节。 */
export function inlineMaxEdge(detail: "low" | "high" | "auto" | undefined): number {
  return detail === "high" || detail === "auto" ? 2048 : 768;
}

/**
 * 缩图转 JPEG data URL。透明底（商品抠图）铺白：JPEG 没有透明通道，默认会铺成黑底，商品颜色就看错了。
 * sharp 按需加载：这条兜底很少走，不该让每个引了 openai provider 的函数冷启动都加载原生模块。
 */
export async function toInlineDataUrl(bytes: Buffer, maxEdge: number): Promise<string> {
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(bytes)
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

export interface InlineRemoteImagesResult {
  urls: string[];
  inlined: number;
  /** 没转成的图：`#序号 原因`（原因不带 URL）。 */
  failures: string[];
}

/**
 * 把可信主机上的远程图换成 data URL，其余原样保留（data: 本来就不用下载；不可信主机不替人去抓）。
 * 逐张并行，单张失败不影响其它张。
 */
export async function inlineRemoteImages(
  urls: string[],
  options: { detail?: "low" | "high" | "auto"; hosts?: readonly string[]; fetchImpl?: typeof fetch } = {},
): Promise<InlineRemoteImagesResult> {
  const hosts = options.hosts ?? visionInlineHosts();
  const maxEdge = inlineMaxEdge(options.detail);
  const settled = await Promise.all(
    urls.map(async (url, index): Promise<{ url: string; failure?: string; inlined?: true }> => {
      if (!/^https?:/i.test(url)) return { url };
      if (!isTrustedMediaUrl(url, hosts)) return { url, failure: `#${index + 1} 不在可信主机上` };
      try {
        const bytes = await fetchMediaBytes(url, {
          maxBytes: VISION_INLINE_MAX_BYTES,
          timeoutMs: VISION_INLINE_FETCH_TIMEOUT_MS,
          fetchImpl: options.fetchImpl,
        });
        return { url: await toInlineDataUrl(bytes, maxEdge), inlined: true };
      } catch (err) {
        return { url, failure: `#${index + 1} ${(err as Error).message}` };
      }
    }),
  );
  return {
    urls: settled.map((item) => item.url),
    inlined: settled.filter((item) => item.inlined).length,
    failures: settled.flatMap((item) => (item.failure ? [item.failure] : [])),
  };
}

/**
 * OpenAI 拉图失败后的那一步：转成 data URL 交回去重试。一张都没转成就不重试——原样再发只会再失败一次，
 * 抛 VisionImageInlineError，把 OpenAI 的原话和服务端没转成的原因都写进去。
 */
export async function inlineImagesAfterDownloadFailure(
  urls: string[],
  detail: "low" | "high" | "auto" | undefined,
  cause: unknown,
  options: { hosts?: readonly string[]; fetchImpl?: typeof fetch } = {},
): Promise<string[]> {
  const result = await inlineRemoteImages(urls, { detail, ...options });
  const reason = (cause as Error)?.message ?? String(cause);
  if (result.inlined === 0) {
    throw new VisionImageInlineError(
      `OpenAI 拉图失败（${reason}），服务端也没能转成 data URL：${result.failures.join("；") || "没有可转的远程图"}`,
    );
  }
  console.warn(
    `[openai] stage=vision OpenAI 拉图失败（${reason}），服务端已把 ${result.inlined}/${urls.length} 张图转成 data URL 重试` +
      (result.failures.length ? `；没转成：${result.failures.join("；")}` : ""),
  );
  return result.urls;
}
