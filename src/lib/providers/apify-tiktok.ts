/**
 * Apify TikTok 抓取 Provider
 *
 * 用途：让 discovery-service 拿到真实的 TikTok 数据（而不是让 LLM 凭常识猜）。
 *
 * 关键点：
 * - 如果 APIFY_TOKEN 未配置，返回空数组（discovery-service 自动降级为纯 LLM 模式）
 * - Actor 选择：
 *   - clockworks/tiktok-scraper：按 search keyword 或 hashtag 抓 Top 视频（最稳定最便宜）
 *   - clockworks/tiktok-comments-scraper：按视频 url 抓 top 评论
 *
 * Cost guardrails：默认每次 discovery 最多 25 个视频 + 每视频 30 条评论，
 * 单次总成本 < $0.10，MVP 阶段完全可承受。
 */
import { ApifyClient } from "apify-client";

export interface TikTokVideoSample {
  id: string;
  url: string;
  caption: string;
  hashtags: string[];
  playCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  authorName?: string;
  musicName?: string;
  durationSec?: number;
  createdAt?: string;
}

export interface TikTokCommentSample {
  videoUrl: string;
  text: string;
  likeCount: number;
  authorName?: string;
}

export interface TikTokResearchSignals {
  videos: TikTokVideoSample[];
  comments: TikTokCommentSample[];
  source: "apify" | "none";
}

const DEFAULT_VIDEO_ACTOR = "clockworks/tiktok-scraper";
const DEFAULT_COMMENTS_ACTOR = "clockworks/tiktok-comments-scraper";

export function isApifyAvailable(): boolean {
  return !!process.env.APIFY_TOKEN;
}

function getClient(): ApifyClient | null {
  const token = process.env.APIFY_TOKEN;
  if (!token) return null;
  return new ApifyClient({ token });
}

/**
 * 主入口：给定一组 search keyword，抓 Top 视频 + 高赞评论。
 */
export async function fetchTikTokSignals(
  keywords: string[],
  options: {
    maxVideosPerKeyword?: number;
    maxCommentsPerVideo?: number;
    country?: string;
    language?: string;
  } = {},
): Promise<TikTokResearchSignals> {
  const client = getClient();
  if (!client) {
    return { videos: [], comments: [], source: "none" };
  }

  const maxVideosPerKeyword = Math.min(options.maxVideosPerKeyword ?? 10, 25);
  const maxCommentsPerVideo = Math.min(options.maxCommentsPerVideo ?? 20, 50);
  const keywordList = keywords.filter(Boolean).slice(0, 3);
  if (keywordList.length === 0) {
    return { videos: [], comments: [], source: "none" };
  }

  let videos: TikTokVideoSample[] = [];
  try {
    videos = await searchVideos(client, keywordList, maxVideosPerKeyword, options);
  } catch (err) {
    console.warn("[apify-tiktok] video search failed:", (err as Error).message);
    return { videos: [], comments: [], source: "none" };
  }

  // 只抓 Top 8 视频的评论，避免单次 Apify 费用超支
  const topForComments = videos
    .slice()
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, 8);

  let comments: TikTokCommentSample[] = [];
  try {
    comments = await fetchComments(
      client,
      topForComments.map((v) => v.url),
      maxCommentsPerVideo,
    );
  } catch (err) {
    console.warn("[apify-tiktok] comments fetch failed:", (err as Error).message);
  }

  return { videos, comments, source: "apify" };
}

async function searchVideos(
  client: ApifyClient,
  keywords: string[],
  maxPerKeyword: number,
  opts: { country?: string; language?: string },
): Promise<TikTokVideoSample[]> {
  const actor = process.env.APIFY_TIKTOK_SEARCH_ACTOR || DEFAULT_VIDEO_ACTOR;
  const input: Record<string, unknown> = {
    searchQueries: keywords,
    resultsPerPage: maxPerKeyword,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
    shouldDownloadAvatars: false,
    proxyCountryCode: opts.country ?? "US",
    scrapeRelatedVideos: false,
    excludePinnedPosts: true,
    maxProfilesPerQuery: 1,
    searchSection: "/video",
  };

  const run = await client.actor(actor).call(input, {
    timeout: 180, // 3 分钟内必须完成
    memory: 2048,
  });

  const { items } = await client
    .dataset(run.defaultDatasetId)
    .listItems({ limit: maxPerKeyword * keywords.length });

  return items
    .map((it): TikTokVideoSample | null => {
      const i = it as Record<string, unknown>;
      const id = pickStr(i, ["id", "videoId"]);
      const url = pickStr(i, ["webVideoUrl", "videoUrl", "url"]);
      if (!id || !url) return null;
      return {
        id,
        url,
        caption: pickStr(i, ["text", "desc", "description"]) ?? "",
        hashtags: extractHashtags(i),
        playCount: pickNum(i, ["playCount", "stats.playCount", "viewCount"]) ?? 0,
        likeCount: pickNum(i, ["diggCount", "likes", "stats.diggCount", "heartCount"]) ?? 0,
        commentCount: pickNum(i, ["commentCount", "stats.commentCount"]) ?? 0,
        shareCount: pickNum(i, ["shareCount", "stats.shareCount"]) ?? 0,
        authorName:
          pickStr(i, ["authorMeta.name", "authorMeta.uniqueId", "author"]) ?? undefined,
        musicName: pickStr(i, ["musicMeta.musicName", "music.title"]) ?? undefined,
        durationSec: pickNum(i, ["videoMeta.duration", "duration"]) ?? undefined,
        createdAt: pickStr(i, ["createTimeISO", "createTime"]) ?? undefined,
      };
    })
    .filter((v): v is TikTokVideoSample => !!v);
}

async function fetchComments(
  client: ApifyClient,
  videoUrls: string[],
  maxPerVideo: number,
): Promise<TikTokCommentSample[]> {
  if (videoUrls.length === 0) return [];
  const actor = process.env.APIFY_TIKTOK_COMMENTS_ACTOR || DEFAULT_COMMENTS_ACTOR;
  const input: Record<string, unknown> = {
    postURLs: videoUrls,
    commentsPerPost: maxPerVideo,
    maxRepliesPerComment: 0,
  };

  const run = await client.actor(actor).call(input, {
    timeout: 180,
    memory: 1024,
  });

  const { items } = await client
    .dataset(run.defaultDatasetId)
    .listItems({ limit: videoUrls.length * maxPerVideo });

  return items
    .map((it): TikTokCommentSample | null => {
      const i = it as Record<string, unknown>;
      const videoUrl = pickStr(i, ["videoWebUrl", "postURL", "webVideoUrl"]);
      const text = pickStr(i, ["text", "commentText", "comment"]);
      if (!videoUrl || !text) return null;
      return {
        videoUrl,
        text,
        likeCount: pickNum(i, ["diggCount", "likesCount", "likeCount"]) ?? 0,
        authorName: pickStr(i, ["uniqueId", "userUniqueId", "username"]) ?? undefined,
      };
    })
    .filter((c): c is TikTokCommentSample => !!c);
}

function pickStr(obj: Record<string, unknown>, paths: string[]): string | null {
  for (const p of paths) {
    const v = readPath(obj, p);
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function pickNum(obj: Record<string, unknown>, paths: string[]): number | null {
  for (const p of paths) {
    const v = readPath(obj, p);
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function readPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    if (typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function extractHashtags(obj: Record<string, unknown>): string[] {
  const tags = obj["hashtags"];
  if (Array.isArray(tags)) {
    return tags
      .map((t) => {
        if (typeof t === "string") return t;
        if (t && typeof t === "object" && "name" in (t as object)) {
          const n = (t as { name?: unknown }).name;
          if (typeof n === "string") return n;
        }
        return null;
      })
      .filter((s): s is string => !!s);
  }
  const caption = obj["text"] || obj["desc"];
  if (typeof caption === "string") {
    return Array.from(caption.matchAll(/#(\w+)/g)).map((m) => m[1]);
  }
  return [];
}
