/**
 * 多平台视频 URL 验证 + TikTok oEmbed 元数据获取
 *
 * 支持：TikTok / Instagram / Facebook
 * 主要用途：验证用户手动输入的 URL，检测平台类型
 * 搜索发现由 apify-search.ts 负责
 */

import type { Platform } from "./apify-search";

export interface TikTokOEmbedResult {
  title: string;
  authorName: string;
  authorUrl: string;
  thumbnailUrl: string | null;
  thumbnailWidth: number;
  thumbnailHeight: number;
  html: string;
}

export interface TrendVideoMeta {
  sourceUrl: string;
  platform: Platform;
  title: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
  description: string | null;
  hashtags: string[];
}

const PLATFORM_PATTERNS: Record<Platform, RegExp[]> = {
  tiktok: [
    /^https?:\/\/(www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/,
    /^https?:\/\/vm\.tiktok\.com\/[\w]+/,
    /^https?:\/\/(www\.)?tiktok\.com\/t\/[\w]+/,
  ],
  instagram: [
    /^https?:\/\/(www\.)?instagram\.com\/reel\/[\w-]+/,
    /^https?:\/\/(www\.)?instagram\.com\/reels\/[\w-]+/,
    /^https?:\/\/(www\.)?instagram\.com\/p\/[\w-]+/,
  ],
  facebook: [
    /^https?:\/\/(www\.)?(facebook|fb)\.com\/[\w.]+\/videos\/\d+/,
    /^https?:\/\/(www\.)?(facebook|fb)\.com\/reel\/\d+/,
    /^https?:\/\/(www\.)?(facebook|fb)\.com\/watch\/?\?v=\d+/,
    /^https?:\/\/fb\.watch\/[\w]+/,
  ],
};

export function detectPlatform(url: string): Platform | null {
  const trimmed = url.trim();
  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS) as [Platform, RegExp[]][]) {
    if (patterns.some((p) => p.test(trimmed))) return platform;
  }
  return null;
}

export function isValidVideoUrl(url: string): boolean {
  return detectPlatform(url) !== null;
}

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w\u4e00-\u9fff]+/g);
  return matches ? [...new Set(matches)] : [];
}

export async function fetchTikTokOEmbed(
  videoUrl: string
): Promise<TikTokOEmbedResult> {
  const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`;

  const res = await fetch(endpoint, {
    headers: { "User-Agent": "Aivora/1.0" },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `TikTok oEmbed 请求失败: ${res.status} ${errText.slice(0, 200)}`
    );
  }

  const data = await res.json();

  return {
    title: data.title || "",
    authorName: data.author_name || "",
    authorUrl: data.author_url || "",
    thumbnailUrl: data.thumbnail_url || null,
    thumbnailWidth: data.thumbnail_width || 0,
    thumbnailHeight: data.thumbnail_height || 0,
    html: data.html || "",
  };
}

export async function analyzeTrendFromUrl(
  videoUrl: string
): Promise<TrendVideoMeta> {
  const platform = detectPlatform(videoUrl);
  if (!platform) {
    throw new Error("请输入有效的视频链接（支持 TikTok / Instagram / Facebook）");
  }

  if (platform === "tiktok") {
    const oembed = await fetchTikTokOEmbed(videoUrl);
    const hashtags = extractHashtags(oembed.title);
    return {
      sourceUrl: videoUrl.trim(),
      platform: "tiktok",
      title: oembed.title || null,
      authorName: oembed.authorName || null,
      thumbnailUrl: oembed.thumbnailUrl,
      description: oembed.title || null,
      hashtags,
    };
  }

  return {
    sourceUrl: videoUrl.trim(),
    platform,
    title: null,
    authorName: null,
    thumbnailUrl: null,
    description: null,
    hashtags: [],
  };
}
