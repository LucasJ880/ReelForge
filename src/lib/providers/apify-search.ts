/**
 * Apify 跨平台爆款短视频搜索 Provider
 *
 * 支持平台：TikTok / Instagram Reels / Facebook Reels
 * 通过 Apify Actor 关键词搜索，返回统一的 TrendCandidate 格式
 */

import { ApifyClient } from "apify-client";

const client = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

export type Platform = "tiktok" | "instagram" | "facebook";

export interface TrendCandidate {
  sourceUrl: string;
  platform: Platform;
  title: string;
  description?: string;
  authorName?: string;
  thumbnailUrl?: string;
  viewCount: number;
  likeCount: number;
  commentCount?: number;
  shareCount?: number;
  duration?: number;
  publishedAt?: string;
  hashtags?: string[];
}

const ACTOR_IDS: Record<Platform, string> = {
  tiktok: "patient_discovery/tiktok-api-search-video",
  instagram: "patient_discovery/instagram-search-reels",
  facebook: "apify/facebook-video-search-scraper",
};

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w\u4e00-\u9fff]+/g);
  return matches ? [...new Set(matches)] : [];
}

// --------------- Platform-specific normalizers ---------------

function normalizeTikTok(item: Record<string, unknown>): TrendCandidate {
  const desc = (item.desc ?? item.description ?? item.text ?? "") as string;
  const title = (item.title ?? desc.slice(0, 100)) as string;
  return {
    sourceUrl: (item.webVideoUrl ?? item.url ?? item.videoUrl ?? "") as string,
    platform: "tiktok",
    title,
    description: desc,
    authorName: (item.authorName ?? (item.author as Record<string, unknown>)?.nickname ?? "") as string,
    thumbnailUrl: (item.coverUrl ?? item.thumbnail ?? item.cover ?? "") as string,
    viewCount: Number(item.playCount ?? item.views ?? item.viewCount ?? 0),
    likeCount: Number(item.diggCount ?? item.likes ?? item.likeCount ?? 0),
    commentCount: Number(item.commentCount ?? item.comments ?? 0),
    shareCount: Number(item.shareCount ?? item.shares ?? 0),
    duration: Number(item.duration ?? 0) || undefined,
    publishedAt: (item.createTime ?? item.publishedAt ?? undefined) as string | undefined,
    hashtags: extractHashtags(desc),
  };
}

function normalizeInstagram(item: Record<string, unknown>): TrendCandidate {
  const caption = (item.caption ?? item.text ?? item.description ?? "") as string;
  return {
    sourceUrl: (item.url ?? item.shortcode ? `https://www.instagram.com/reel/${item.shortcode}/` : "") as string,
    platform: "instagram",
    title: caption.slice(0, 100),
    description: caption,
    authorName: (item.ownerUsername ?? item.authorName ?? item.username ?? "") as string,
    thumbnailUrl: (item.thumbnailUrl ?? item.displayUrl ?? item.thumbnail ?? "") as string,
    viewCount: Number(item.videoViewCount ?? item.viewCount ?? item.views ?? item.playCount ?? 0),
    likeCount: Number(item.likesCount ?? item.likeCount ?? item.likes ?? 0),
    commentCount: Number(item.commentsCount ?? item.commentCount ?? item.comments ?? 0),
    shareCount: 0,
    duration: Number(item.videoDuration ?? item.duration ?? 0) || undefined,
    publishedAt: (item.timestamp ?? item.takenAt ?? undefined) as string | undefined,
    hashtags: extractHashtags(caption),
  };
}

function normalizeFacebook(item: Record<string, unknown>): TrendCandidate {
  const title = (item.title ?? item.description ?? "") as string;
  return {
    sourceUrl: (item.url ?? item.videoUrl ?? "") as string,
    platform: "facebook",
    title: title.slice(0, 100),
    description: title,
    authorName: (item.ownerName ?? item.pageName ?? item.author ?? "") as string,
    thumbnailUrl: (item.thumbnailUrl ?? item.thumbnail ?? "") as string,
    viewCount: Number(item.viewCount ?? item.views ?? 0),
    likeCount: Number(item.likeCount ?? item.likes ?? item.reactions ?? 0),
    commentCount: Number(item.commentCount ?? item.comments ?? 0),
    shareCount: Number(item.shareCount ?? item.shares ?? 0),
    duration: Number(item.duration ?? 0) || undefined,
    publishedAt: (item.date ?? item.postedAt ?? undefined) as string | undefined,
    hashtags: extractHashtags(title),
  };
}

const NORMALIZERS: Record<Platform, (item: Record<string, unknown>) => TrendCandidate> = {
  tiktok: normalizeTikTok,
  instagram: normalizeInstagram,
  facebook: normalizeFacebook,
};

// --------------- Search functions ---------------

async function searchPlatform(
  platform: Platform,
  keyword: string,
  limit: number
): Promise<TrendCandidate[]> {
  const actorId = ACTOR_IDS[platform];
  const normalize = NORMALIZERS[platform];

  const run = await client.actor(actorId).call(
    { keyword, maxResults: limit },
    { waitSecs: 120 }
  );

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  return (items as Record<string, unknown>[])
    .map((item) => {
      try {
        return normalize(item);
      } catch {
        return null;
      }
    })
    .filter((c): c is TrendCandidate => c !== null && !!c.sourceUrl);
}

export async function searchTikTok(keyword: string, limit = 50): Promise<TrendCandidate[]> {
  return searchPlatform("tiktok", keyword, limit);
}

export async function searchInstagram(keyword: string, limit = 50): Promise<TrendCandidate[]> {
  return searchPlatform("instagram", keyword, limit);
}

export async function searchFacebook(keyword: string, limit = 50): Promise<TrendCandidate[]> {
  return searchPlatform("facebook", keyword, limit);
}

export interface SearchAllOptions {
  platforms?: Platform[];
  limitPerPlatform?: number;
}

export async function searchAllPlatforms(
  keyword: string,
  opts: SearchAllOptions = {}
): Promise<TrendCandidate[]> {
  const platforms = opts.platforms ?? (["tiktok", "instagram", "facebook"] as Platform[]);
  const limit = opts.limitPerPlatform ?? 50;

  const results = await Promise.allSettled(
    platforms.map((p) => searchPlatform(p, keyword, limit))
  );

  const all: TrendCandidate[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  const seen = new Set<string>();
  const deduped = all.filter((c) => {
    if (seen.has(c.sourceUrl)) return false;
    seen.add(c.sourceUrl);
    return true;
  });

  deduped.sort((a, b) => b.viewCount - a.viewCount);

  return deduped;
}
