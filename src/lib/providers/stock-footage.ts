import { z } from "zod";

/**
 * 免费图库视频素材适配器（Pexels + Pixabay）。
 *
 * 借鉴自 MoneyPrinterTurbo `app/services/material.py`（MIT），
 * 见 docs/roadmap/2026-08-01-moneyprinterturbo-review.md。
 * 它踩过的坑这里直接继承解法：空结果不缓存、多 key 轮换、日志脱敏、
 * 时长下限 + 画幅筛选。
 *
 * 定位（PRD 风险 #5 / C2）：给「视频」形态一条**趋零成本的 b-roll 线路**，
 * 做第三线路与兜底 —— 不替代产品锚定主线，b-roll 做不了产品一致性。
 *
 * 无 key 时诚实不可用（与 remove-bg 抠图适配器同一模式）：
 * `isStockFootageAvailable()` 返回 false，调用方停等并标「即将上线」，
 * **绝不 mock 出假素材充当验收**。
 */

export type StockAspect = "portrait" | "landscape";

export const stockClipSchema = z.object({
  /// `pexels:12345` / `pixabay:67890`，跨来源唯一，做去重键。
  id: z.string().min(1),
  provider: z.enum(["pexels", "pixabay"]),
  /// 可直接下载的视频文件 URL（已按目标画幅挑好的那一档）。
  downloadUrl: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationSec: z.number().positive(),
  /**
   * 来源记录（MPT 的 _material_source_record 思路）：
   * Pexels/Pixabay 许可虽不强制署名，但保留创作者与页面链接，
   * 客户被平台问「素材哪来的」时我们答得出来。
   */
  creator: z.string().nullable(),
  sourcePageUrl: z.string().url().nullable(),
});

export type StockClip = z.infer<typeof stockClipSchema>;

/// 短于这个的素材没有剪辑价值（还没进入画面就切走了）。
export const MIN_CLIP_DURATION_SEC = 3;

function parseKeys(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

/**
 * 多 key 轮换（MPT 的 _api_key_counter 思路）。
 * env 里逗号分隔多个 key 即自动轮换，单 key 也照常工作。
 */
let pexelsCounter = 0;
let pixabayCounter = 0;

function nextKey(keys: string[], counter: number): string {
  return keys[counter % keys.length];
}

export function isStockFootageAvailable(): boolean {
  return (
    parseKeys(process.env.PEXELS_API_KEYS).length > 0 ||
    parseKeys(process.env.PIXABAY_API_KEYS).length > 0
  );
}

export class StockFootageUnavailableError extends Error {
  constructor() {
    super(
      "图库素材线路尚未接入（缺 PEXELS_API_KEYS / PIXABAY_API_KEYS）。" +
        "该功能即将上线，等 key 配好后无需改代码。",
    );
    this.name = "StockFootageUnavailableError";
  }
}

/**
 * 日志脱敏（MPT 的 _redact_request_error 思路）：
 * 错误信息里可能带完整请求 URL，Pixabay 的 key 就在 query 上。
 */
export function redactSecrets(message: string): string {
  return message
    .replace(/([?&]key=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/(authorization[":\s]+)[\w-]+/gi, "$1[REDACTED]");
}

function matchesAspect(
  width: number,
  height: number,
  aspect: StockAspect,
): boolean {
  return aspect === "portrait" ? height > width : width >= height;
}

/**
 * Pexels 视频搜索。
 * https://api.pexels.com/videos/search —— key 走 Authorization header。
 */
async function searchPexels(args: {
  term: string;
  aspect: StockAspect;
  key: string;
  fetchImpl: typeof fetch;
}): Promise<StockClip[]> {
  const url = new URL("https://api.pexels.com/videos/search");
  url.searchParams.set("query", args.term);
  url.searchParams.set("per_page", "20");
  url.searchParams.set("orientation", args.aspect);

  const res = await args.fetchImpl(url.toString(), {
    headers: { Authorization: args.key },
  });
  if (!res.ok) {
    throw new Error(`Pexels ${res.status}: ${redactSecrets(await res.text())}`);
  }
  const body = (await res.json()) as {
    videos?: Array<{
      id: number;
      duration: number;
      user?: { name?: string };
      url?: string;
      video_files?: Array<{
        link: string;
        width?: number;
        height?: number;
        file_type?: string;
      }>;
    }>;
  };

  const clips: StockClip[] = [];
  for (const video of body.videos ?? []) {
    if ((video.duration ?? 0) < MIN_CLIP_DURATION_SEC) continue;
    /// 同一条视频有多档文件，选符合画幅方向里分辨率最高的一档。
    const files = (video.video_files ?? [])
      .filter(
        (file) =>
          file.link &&
          (file.file_type ?? "video/mp4").includes("mp4") &&
          file.width &&
          file.height &&
          matchesAspect(file.width, file.height, args.aspect),
      )
      .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
    const best = files[0];
    if (!best) continue;
    clips.push({
      id: `pexels:${video.id}`,
      provider: "pexels",
      downloadUrl: best.link,
      width: best.width!,
      height: best.height!,
      durationSec: video.duration,
      creator: video.user?.name ?? null,
      sourcePageUrl: video.url ?? null,
    });
  }
  return clips;
}

/**
 * Pixabay 视频搜索。
 * https://pixabay.com/api/videos/ —— key 走 query 参数（所以日志必须脱敏）。
 */
async function searchPixabay(args: {
  term: string;
  aspect: StockAspect;
  key: string;
  fetchImpl: typeof fetch;
}): Promise<StockClip[]> {
  const url = new URL("https://pixabay.com/api/videos/");
  url.searchParams.set("key", args.key);
  url.searchParams.set("q", args.term);
  url.searchParams.set("per_page", "50");
  url.searchParams.set("video_type", "film");

  const res = await args.fetchImpl(url.toString());
  if (!res.ok) {
    throw new Error(
      `Pixabay ${res.status}: ${redactSecrets(await res.text())}`,
    );
  }
  const body = (await res.json()) as {
    hits?: Array<{
      id: number;
      duration: number;
      user?: string;
      pageURL?: string;
      videos?: Record<
        string,
        { url?: string; width?: number; height?: number }
      >;
    }>;
  };

  const clips: StockClip[] = [];
  for (const hit of body.hits ?? []) {
    if ((hit.duration ?? 0) < MIN_CLIP_DURATION_SEC) continue;
    const variants = Object.values(hit.videos ?? {})
      .filter(
        (variant) =>
          variant.url &&
          variant.width &&
          variant.height &&
          matchesAspect(variant.width, variant.height, args.aspect),
      )
      .sort(
        (a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
      );
    const best = variants[0];
    if (!best) continue;
    clips.push({
      id: `pixabay:${hit.id}`,
      provider: "pixabay",
      downloadUrl: best.url!,
      width: best.width!,
      height: best.height!,
      durationSec: hit.duration,
      creator: hit.user ?? null,
      sourcePageUrl: hit.pageURL ?? null,
    });
  }
  return clips;
}

/**
 * 搜索一个词的可用素材。两个图库都配了 key 就都查并合并去重；
 * 一个失败不拖死另一个（MPT 同款容错），但**两个都失败要抛** ——
 * 静默返回空数组会被上游当成「没搜到」，而真相是「服务出错」。
 */
export async function searchStockClips(args: {
  term: string;
  aspect: StockAspect;
  fetchImpl?: typeof fetch;
}): Promise<StockClip[]> {
  const pexelsKeys = parseKeys(process.env.PEXELS_API_KEYS);
  const pixabayKeys = parseKeys(process.env.PIXABAY_API_KEYS);
  if (pexelsKeys.length === 0 && pixabayKeys.length === 0) {
    throw new StockFootageUnavailableError();
  }
  const fetchImpl = args.fetchImpl ?? fetch;

  const tasks: Promise<StockClip[]>[] = [];
  if (pexelsKeys.length) {
    tasks.push(
      searchPexels({
        term: args.term,
        aspect: args.aspect,
        key: nextKey(pexelsKeys, pexelsCounter++),
        fetchImpl,
      }),
    );
  }
  if (pixabayKeys.length) {
    tasks.push(
      searchPixabay({
        term: args.term,
        aspect: args.aspect,
        key: nextKey(pixabayKeys, pixabayCounter++),
        fetchImpl,
      }),
    );
  }

  const results = await Promise.allSettled(tasks);
  const clips = results
    .filter(
      (result): result is PromiseFulfilledResult<StockClip[]> =>
        result.status === "fulfilled",
    )
    .flatMap((result) => result.value);

  if (clips.length === 0) {
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => redactSecrets(String(result.reason)));
    if (errors.length === results.length && errors.length > 0) {
      throw new Error(`图库搜索全部失败：${errors.join(" | ")}`);
    }
  }

  /// 跨来源去重（同一条素材可能同时在两个库上架）。
  const seen = new Set<string>();
  return clips.filter((clip) => {
    if (seen.has(clip.id)) return false;
    seen.add(clip.id);
    return true;
  });
}

export const __test__ = {
  parseKeys,
  matchesAspect,
  nextKey,
};
