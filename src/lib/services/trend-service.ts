import { db } from "@/lib/db";
import { analyzeTrendFromUrl } from "@/lib/providers/trend-discovery";
import { analyzeViralStyle, analyzeThumbnail } from "@/lib/providers/openai";
import {
  searchAllPlatforms,
  type TrendCandidate,
  type Platform,
  type SearchAllOptions,
} from "@/lib/providers/apify-search";

// ============================================================
// Discovery — search via Apify, return candidates (no DB write)
// ============================================================

export async function discoverTrends(
  keyword: string,
  opts?: SearchAllOptions
): Promise<TrendCandidate[]> {
  return searchAllPlatforms(keyword, opts);
}

// ============================================================
// Analyze & Save — run GPT analysis on a candidate and persist
// ============================================================

export async function analyzeAndSave(candidate: TrendCandidate) {
  const [styleResult, visualResult] = await Promise.allSettled([
    analyzeViralStyle({
      title: candidate.title,
      description: candidate.description ?? null,
      hashtags: candidate.hashtags ?? [],
      authorName: candidate.authorName ?? null,
      viewCount: candidate.viewCount,
      likeCount: candidate.likeCount,
      commentCount: candidate.commentCount,
      shareCount: candidate.shareCount,
    }),
    candidate.thumbnailUrl
      ? analyzeThumbnail(candidate.thumbnailUrl, {
          title: candidate.title,
          platform: candidate.platform,
        })
      : Promise.resolve(null),
  ]);

  const style =
    styleResult.status === "fulfilled" ? styleResult.value : null;
  const visual =
    visualResult.status === "fulfilled" ? visualResult.value : null;

  const trendRef = await db.trendReference.create({
    data: {
      sourceUrl: candidate.sourceUrl,
      platform: candidate.platform,
      title: candidate.title,
      description: candidate.description,
      authorName: candidate.authorName,
      hashtags: candidate.hashtags ?? [],
      thumbnailUrl: candidate.thumbnailUrl,
      viewCount: candidate.viewCount,
      likeCount: candidate.likeCount,
      commentCount: candidate.commentCount ?? 0,
      shareCount: candidate.shareCount ?? 0,
      duration: candidate.duration,
      publishedAt: candidate.publishedAt ? new Date(candidate.publishedAt) : null,
      styleAnalysis: style
        ? {
            narrativeStyle: style.narrativeStyle,
            emotionalTone: style.emotionalTone,
            hookStrategy: style.hookStrategy,
            contentStructure: style.contentStructure,
            visualStyle: style.visualStyle,
            successFactors: style.successFactors,
          }
        : undefined,
      visualAnalysis: visual
        ? {
            colorPalette: visual.colorPalette,
            lightingStyle: visual.lightingStyle,
            sceneType: visual.sceneType,
            overallMood: visual.overallMood,
            productPresentation: visual.productPresentation,
            suggestedVideoStyle: visual.suggestedVideoStyle,
          }
        : undefined,
    },
  });

  return trendRef;
}

// ============================================================
// Batch Analyze — analyze multiple candidates with concurrency
// ============================================================

export async function batchAnalyze(
  candidates: TrendCandidate[],
  concurrency = 3
) {
  const results: { url: string; success: boolean; id?: string; error?: string }[] = [];

  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((c) => analyzeAndSave(c))
    );

    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j];
      const c = batch[j];
      if (r.status === "fulfilled") {
        results.push({ url: c.sourceUrl, success: true, id: r.value.id });
      } else {
        results.push({
          url: c.sourceUrl,
          success: false,
          error: r.reason instanceof Error ? r.reason.message : "未知错误",
        });
      }
    }
  }

  return results;
}

// ============================================================
// Legacy: create from URL (single URL input, kept for backward compat)
// ============================================================

export async function createTrendFromUrl(videoUrl: string) {
  const meta = await analyzeTrendFromUrl(videoUrl);

  const styleResult = await analyzeViralStyle({
    title: meta.title,
    description: meta.description,
    hashtags: meta.hashtags,
    authorName: meta.authorName,
  });

  const visualResult = meta.thumbnailUrl
    ? await analyzeThumbnail(meta.thumbnailUrl, {
        title: meta.title ?? undefined,
        platform: meta.platform,
      }).catch(() => null)
    : null;

  const trendRef = await db.trendReference.create({
    data: {
      sourceUrl: meta.sourceUrl,
      platform: meta.platform,
      title: meta.title,
      description: meta.description,
      authorName: meta.authorName,
      hashtags: meta.hashtags,
      thumbnailUrl: meta.thumbnailUrl,
      styleAnalysis: {
        narrativeStyle: styleResult.narrativeStyle,
        emotionalTone: styleResult.emotionalTone,
        hookStrategy: styleResult.hookStrategy,
        contentStructure: styleResult.contentStructure,
        visualStyle: styleResult.visualStyle,
        successFactors: styleResult.successFactors,
      },
      visualAnalysis: visualResult
        ? {
            colorPalette: visualResult.colorPalette,
            lightingStyle: visualResult.lightingStyle,
            sceneType: visualResult.sceneType,
            overallMood: visualResult.overallMood,
            productPresentation: visualResult.productPresentation,
            suggestedVideoStyle: visualResult.suggestedVideoStyle,
          }
        : undefined,
    },
  });

  return trendRef;
}

// ============================================================
// Read — query persisted references
// ============================================================

export async function getTrendReference(trendRefId: string) {
  const ref = await db.trendReference.findUnique({
    where: { id: trendRefId },
  });
  if (!ref) throw new Error("参考爆款不存在");
  return ref;
}

export interface ListTrendsOptions {
  platform?: Platform;
  search?: string;
  limit?: number;
}

export async function listTrendReferences(opts: ListTrendsOptions = {}) {
  const { platform, search, limit = 50 } = opts;

  return db.trendReference.findMany({
    where: {
      ...(platform ? { platform } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" as const } },
              { description: { contains: search, mode: "insensitive" as const } },
              { hashtags: { has: search } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { _count: { select: { projects: true } } },
  });
}

// ============================================================
// Keywords CRUD
// ============================================================

export async function listKeywords() {
  return db.searchKeyword.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function createKeyword(keyword: string) {
  return db.searchKeyword.upsert({
    where: { keyword },
    create: { keyword },
    update: { isActive: true },
  });
}

export async function deleteKeyword(id: string) {
  return db.searchKeyword.update({
    where: { id },
    data: { isActive: false },
  });
}
