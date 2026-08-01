import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getShowcaseUserId } from "@/lib/services/showcase-library";
import {
  isBrandPlacement,
  isHookType,
  readTemplateSnapshot,
} from "@/lib/video-generation/creative-recipe";
import {
  videosApiResponseSchema,
  type VideosApiItem,
  type VideosApiQuery,
  type VideosApiResponse,
} from "@/lib/contracts/videos-api";

/**
 * 青砚 `aivora-sync` 的成片来源（PRD §9）。
 *
 * 两个刻意的过滤，都不能放宽：
 *
 * 1. **只给已品牌封装的成片。** schema 写死「只有 branded 可对外交付」——
 *    未封装的片子发出去就是没有 logo 与尾卡的裸片，挂在客户账号上。
 *    被过滤掉的条数在 meta.skipped_unbranded 里显式报出来，
 *    这样「拉到 0 条」能立刻分辨是没产出还是封装管线掉队。
 *
 * 2. **排除 takedown 与样片账号。** takedownAt 是客户要求下架的证据，
 *    样片是注入给所有用户的只读 demo，两者都绝不能被当成客户自己的内容发布出去。
 */

const briefSelect = {
  id: true,
  durationSec: true,
  aspectRatio: true,
  brandedVideoUrl: true,
  finalVideoUrl: true,
  finalThumbnailUrl: true,
  brandedAt: true,
  takedownAt: true,
  updatedAt: true,
  contentAngle: {
    select: {
      title: true,
      round: {
        select: {
          deliveryOrder: { select: { title: true, createdById: true } },
        },
      },
    },
  },
  /// 配方快照落在 VideoJob 上；同一 brief 的各段共享同一配方，取任意一段即可。
  videoJobs: {
    take: 1,
    where: { recipeId: { not: null } },
    select: {
      recipeId: true,
      hookType: true,
      templateId: true,
      aspectRatio: true,
      brandPlacement: true,
    },
  },
} satisfies Prisma.VideoBriefSelect;

const batchJobSelect = {
  id: true,
  batchIndex: true,
  brandedVideoUrl: true,
  outputThumbUrl: true,
  finishedAt: true,
  brandedAt: true,
  recipeId: true,
  hookType: true,
  templateId: true,
  aspectRatio: true,
  brandPlacement: true,
  templateSnapshot: true,
  batchJob: {
    select: {
      productName: true,
      userId: true,
      template: { select: { nameZh: true, name: true } },
    },
  },
} satisfies Prisma.VideoJobSelect;

type SyncableBrief = Prisma.VideoBriefGetPayload<{ select: typeof briefSelect }>;
type SyncableBatchJob = Prisma.VideoJobGetPayload<{
  select: typeof batchJobSelect;
}>;

function recipeFields(
  source: {
    recipeId: string | null;
    hookType: string | null;
    templateId: string | null;
    aspectRatio: string | null;
    brandPlacement: string | null;
  } | null,
): Pick<
  VideosApiItem,
  "recipe_id" | "hook_type" | "template_id" | "aspect_ratio" | "brand_placement"
> {
  return {
    recipe_id: source?.recipeId ?? null,
    /// 校验而不是直接透传：DB 里是自由字符串列，契约里是枚举。
    /// 脏值宁可报 null（未知），也不要让青砚落一个它枚举里没有的值。
    hook_type: isHookType(source?.hookType) ? source.hookType : null,
    template_id: source?.templateId ?? null,
    aspect_ratio: source?.aspectRatio ?? null,
    brand_placement: isBrandPlacement(source?.brandPlacement)
      ? source.brandPlacement
      : null,
  };
}

function briefToItem(brief: SyncableBrief): VideosApiItem | null {
  if (!brief.brandedVideoUrl || !brief.brandedAt) return null;
  const order = brief.contentAngle?.round?.deliveryOrder ?? null;
  const title = brief.contentAngle?.title?.trim() || order?.title?.trim();
  if (!title) return null;
  return {
    id: `brief-${brief.id}`,
    video_url: brief.brandedVideoUrl,
    title,
    cover_url: brief.finalThumbnailUrl,
    duration: brief.durationSec > 0 ? brief.durationSec : null,
    topic: order?.title?.trim() || null,
    language: null,
    completed_at: brief.brandedAt.toISOString(),
    ...recipeFields(brief.videoJobs[0] ?? null),
  };
}

function batchJobToItem(job: SyncableBatchJob): VideosApiItem | null {
  if (!job.brandedVideoUrl || !job.brandedAt || !job.batchJob) return null;
  const templateName =
    job.batchJob.template.nameZh ?? job.batchJob.template.name;
  const frozen = readTemplateSnapshot(job.templateSnapshot);
  const index = (job.batchIndex ?? 0) + 1;
  const recipe = recipeFields(job);
  return {
    id: `batch-${job.id}`,
    video_url: job.brandedVideoUrl,
    title: `${job.batchJob.productName ?? templateName} · ${templateName} #${index}`,
    cover_url: job.outputThumbUrl,
    duration: frozen?.durationSec ?? null,
    topic: job.batchJob.productName?.trim() || null,
    language: null,
    completed_at: job.brandedAt.toISOString(),
    ...recipe,
    /// 快照只在列为空时兜底：列是权威，快照是历史行的补充。
    template_id: recipe.template_id ?? frozen?.templateKey ?? null,
    recipe_id:
      recipe.recipe_id ??
      (frozen?.templateKey ? `tpl:${frozen.templateKey}` : null),
    aspect_ratio: recipe.aspect_ratio ?? frozen?.aspectRatio ?? null,
  };
}

export async function listSyncableVideos(
  query: VideosApiQuery,
): Promise<VideosApiResponse> {
  const showcaseUserId = await getShowcaseUserId();
  const brandedSince = query.since ? { gt: query.since } : undefined;

  const [briefs, batchJobs] = await Promise.all([
    db.videoBrief.findMany({
      where: {
        takedownAt: null,
        brandedVideoUrl: { not: null },
        brandedAt: brandedSince ? brandedSince : { not: null },
        ...(showcaseUserId
          ? {
              contentAngle: {
                round: {
                  deliveryOrder: { createdById: { not: showcaseUserId } },
                },
              },
            }
          : {}),
      },
      orderBy: { brandedAt: "desc" },
      take: query.limit,
      select: briefSelect,
    }),
    db.videoJob.findMany({
      where: {
        status: "SUCCEEDED",
        brandedVideoUrl: { not: null },
        brandedAt: brandedSince ? brandedSince : { not: null },
        batchJobId: { not: null },
        ...(showcaseUserId
          ? { batchJob: { is: { userId: { not: showcaseUserId } } } }
          : {}),
      },
      orderBy: { brandedAt: "desc" },
      take: query.limit,
      select: batchJobSelect,
    }),
  ]);

  /// 未封装计数单独查：上面的 where 已经把它们排除了，不查就报不出来。
  const [unbrandedBriefs, unbrandedBatchJobs] = await Promise.all([
    db.videoBrief.count({
      where: {
        takedownAt: null,
        finalVideoUrl: { not: null },
        brandedVideoUrl: null,
      },
    }),
    db.videoJob.count({
      where: {
        status: "SUCCEEDED",
        batchJobId: { not: null },
        outputVideoUrl: { not: null },
        brandedVideoUrl: null,
      },
    }),
  ]);

  const videos = [
    ...briefs.map(briefToItem),
    ...batchJobs.map(batchJobToItem),
  ]
    .filter((item): item is VideosApiItem => item !== null)
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at))
    .slice(0, query.limit);

  return videosApiResponseSchema.parse({
    videos,
    meta: {
      count: videos.length,
      skipped_unbranded: unbrandedBriefs + unbrandedBatchJobs,
      next_since: videos.at(-1)?.completed_at ?? null,
    },
  });
}
