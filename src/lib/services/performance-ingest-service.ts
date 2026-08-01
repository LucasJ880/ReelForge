import { db } from "@/lib/db";
import type {
  PerformanceIngestResponse,
  PerformanceSample,
} from "@/lib/contracts/performance-api";

/**
 * R2 · 表现回流落库（PRD §4 / M2）。
 *
 * 核心约束：**配方是从我方 subject 上读的，不接受回流方传**。
 * 青砚传什么我们都不该信它对配方的判断 —— 配方是我们生成时确定的事实，
 * 让外部系统能覆盖它，等于给赛马开了一个可以被写脏的口子。
 */

/// 青砚拿到的 id 带来源前缀（batch- / brief-）。回流时可能原样传回来。
function normalizeSubjectId(subjectId: string): string {
  return subjectId.replace(/^(batch-|brief-)/, "");
}

export async function ingestPerformanceSamples(
  samples: PerformanceSample[],
): Promise<PerformanceIngestResponse> {
  const videoIds = new Set<string>();
  const postIds = new Set<string>();
  for (const sample of samples) {
    const id = normalizeSubjectId(sample.subjectId);
    if (sample.subjectType === "video") videoIds.add(id);
    else postIds.add(id);
  }

  const [videos, posts] = await Promise.all([
    videoIds.size
      ? db.videoJob.findMany({
          where: { id: { in: [...videoIds] } },
          select: { id: true, recipeId: true },
        })
      : Promise.resolve([]),
    postIds.size
      ? db.contentPost.findMany({
          where: { id: { in: [...postIds] } },
          select: { id: true, recipeId: true },
        })
      : Promise.resolve([]),
  ]);

  const recipeByVideo = new Map(videos.map((v) => [v.id, v.recipeId]));
  const recipeByPost = new Map(posts.map((p) => [p.id, p.recipeId]));

  let accepted = 0;
  let unmatched = 0;
  let withoutRecipe = 0;

  for (const sample of samples) {
    const subjectId = normalizeSubjectId(sample.subjectId);
    const known =
      sample.subjectType === "video"
        ? recipeByVideo.has(subjectId)
        : recipeByPost.has(subjectId);

    /// 对不上就丢弃并计数。存下来也没法归因，只会让「有多少数据」这个问题失真。
    if (!known) {
      unmatched += 1;
      continue;
    }

    const recipeId =
      (sample.subjectType === "video"
        ? recipeByVideo.get(subjectId)
        : recipeByPost.get(subjectId)) ?? null;
    if (!recipeId) withoutRecipe += 1;

    const subjectType = sample.subjectType === "video" ? "VIDEO" : "POST";
    const numbers = {
      recipeId,
      externalPostId: sample.externalPostId ?? null,
      observedAt: sample.observedAt,
      impressions: sample.impressions ?? null,
      views: sample.views ?? null,
      likes: sample.likes ?? null,
      comments: sample.comments ?? null,
      shares: sample.shares ?? null,
      saves: sample.saves ?? null,
      clicks: sample.clicks ?? null,
      conversions: sample.conversions ?? null,
    };

    /// 同窗口重复回流覆盖数值（指标会随时间修正），
    /// 但不同窗口各存一行 —— 12h 与 48h 是两个独立的观测。
    await db.contentPerformance.upsert({
      where: {
        subjectType_subjectId_platform_windowHours: {
          subjectType,
          subjectId,
          platform: sample.platform,
          windowHours: sample.windowHours,
        },
      },
      create: {
        subjectType,
        subjectId,
        platform: sample.platform,
        windowHours: sample.windowHours,
        ...numbers,
      },
      update: numbers,
    });
    accepted += 1;
  }

  return { accepted, unmatched, withoutRecipe };
}

/**
 * 取某用户名下所有内容的表现行，喂给 judgeRecipes。
 *
 * 按窗口过滤：混着 12h 和 48h 的数据比较配方，等于拿不同成熟度的样本比大小。
 */
export async function loadPerformanceRows(args: {
  userId: string;
  windowHours: number;
}) {
  const [posts, videos] = await Promise.all([
    db.contentPost.findMany({
      where: { plan: { userId: args.userId } },
      select: { id: true },
    }),
    db.videoJob.findMany({
      where: { batchJob: { is: { userId: args.userId } } },
      select: { id: true },
    }),
  ]);

  const ids = [...posts.map((p) => p.id), ...videos.map((v) => v.id)];
  if (ids.length === 0) return [];

  return db.contentPerformance.findMany({
    where: { subjectId: { in: ids }, windowHours: args.windowHours },
    select: {
      recipeId: true,
      subjectId: true,
      impressions: true,
      views: true,
      likes: true,
      comments: true,
      shares: true,
      saves: true,
      clicks: true,
      conversions: true,
    },
  });
}
