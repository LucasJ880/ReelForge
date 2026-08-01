import type {
  FinalVideoStatus,
  Prisma,
  StoryboardRunStatus,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  customerSafeFinalVideoUrl,
  derivePersonalStatus,
  type PersonalVideoStatus,
} from "@/lib/video-generation/personal-status";
import { summarizeRunningJobs } from "@/lib/video-generation/business-status";
import {
  unifiedLibraryRowSchema,
  type UnifiedLibraryRow,
} from "@/lib/contracts/unified-library";
import { resolveShowcaseSourceFor } from "@/lib/services/showcase-library";
import { readTemplateSnapshot } from "@/lib/video-generation/creative-recipe";

export type { UnifiedLibraryRow } from "@/lib/contracts/unified-library";

export type MakingProcessStepKey =
  | "brief"
  | "storyboard"
  | "generation"
  | "post-production";

export type MakingProcessStepStatus =
  | "completed"
  | "current"
  | "pending"
  | "failed";

export type MakingProcessStep = {
  key: MakingProcessStepKey;
  status: MakingProcessStepStatus;
  timestamp: Date | null;
  summary: string;
  completed?: number;
  total?: number;
};

export type MakingProcessEvidence = {
  orderCreatedAt: Date;
  briefCreatedAt?: Date | null;
  briefStatus?: VideoBriefStatus | null;
  storyboardStatus?: StoryboardRunStatus | null;
  storyboardCreatedAt?: Date | null;
  storyboardApprovedAt?: Date | null;
  storyboardUpdatedAt?: Date | null;
  videoJobs: Array<{
    status: VideoJobStatus;
    submittedAt?: Date | null;
    finishedAt?: Date | null;
    createdAt?: Date | null;
  }>;
  finalVideoStatus?: FinalVideoStatus | null;
  finalVideoStartedAt?: Date | null;
  finalVideoFinishedAt?: Date | null;
  hasPlayableVideo: boolean;
};

const unifiedLibraryOrderSelect = {
  id: true,
  title: true,
  createdAt: true,
  updatedAt: true,
  rounds: {
    orderBy: { roundIndex: "desc" },
    take: 1,
    select: {
      angles: {
        orderBy: { sortOrder: "asc" },
        take: 1,
        select: {
          videoBrief: {
            select: {
              id: true,
              status: true,
              durationSec: true,
              aspectRatio: true,
              finalVideoUrl: true,
              finalThumbnailUrl: true,
              brandedVideoUrl: true,
              takedownAt: true,
              createdAt: true,
              storyboardRun: {
                select: {
                  status: true,
                  createdAt: true,
                  approvedAt: true,
                  updatedAt: true,
                },
              },
              finalVideo: {
                select: {
                  status: true,
                  stitchedVideoUrl: true,
                  thumbnailUrl: true,
                  subtitleFileUrl: true,
                  segmentCount: true,
                  startedAt: true,
                  finishedAt: true,
                },
              },
              videoJobs: {
                select: {
                  status: true,
                  lastProgress: true,
                  submittedAt: true,
                  finishedAt: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.DeliveryOrderSelect;

type UnifiedLibraryOrder = Prisma.DeliveryOrderGetPayload<{
  select: typeof unifiedLibraryOrderSelect;
}>;

function latestDate(
  values: Array<Date | null | undefined>,
): Date | null {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    return !latest || value > latest ? value : latest;
  }, null);
}

export function deriveMakingProcess(
  evidence: MakingProcessEvidence,
): MakingProcessStep[] {
  const briefFailed =
    evidence.briefStatus === "RENDER_FAILED" ||
    evidence.briefStatus === "QA_REJECTED" ||
    evidence.briefStatus === "DROPPED";
  const brief: MakingProcessStep = {
    key: "brief",
    status: briefFailed ? "failed" : "completed",
    timestamp: evidence.briefCreatedAt ?? evidence.orderCreatedAt,
    summary: briefFailed ? "brief_failed" : "brief_locked",
  };

  let storyboard: MakingProcessStep;
  if (evidence.storyboardStatus === "APPROVED") {
    storyboard = {
      key: "storyboard",
      status: "completed",
      timestamp:
        evidence.storyboardApprovedAt ?? evidence.storyboardCreatedAt ?? null,
      summary: "storyboard_approved",
    };
  } else if (evidence.storyboardStatus === "FAILED") {
    storyboard = {
      key: "storyboard",
      status: "failed",
      timestamp:
        evidence.storyboardUpdatedAt ?? evidence.storyboardCreatedAt ?? null,
      summary: "storyboard_failed",
    };
  } else if (
    evidence.storyboardStatus === "GENERATING" ||
    evidence.storyboardStatus === "AWAITING_APPROVAL"
  ) {
    storyboard = {
      key: "storyboard",
      status: "current",
      timestamp: evidence.storyboardCreatedAt ?? null,
      summary:
        evidence.storyboardStatus === "GENERATING"
          ? "storyboard_generating"
          : "storyboard_waiting",
    };
  } else {
    storyboard = {
      key: "storyboard",
      status: "pending",
      timestamp: null,
      summary: "storyboard_not_recorded",
    };
  }

  const total = evidence.videoJobs.length;
  const completed = evidence.videoJobs.filter(
    (job) => job.status === "SUCCEEDED",
  ).length;
  const hasActiveGeneration = evidence.videoJobs.some((job) =>
    ["QUEUED", "PAUSED", "RUNNING"].includes(job.status),
  );
  const hasFailedGeneration = evidence.videoJobs.some((job) =>
    ["FAILED", "CANCELLED"].includes(job.status),
  );
  let generationStatus: MakingProcessStepStatus = "pending";
  let generationSummary = "generation_pending";
  if (total > 0 && completed === total) {
    generationStatus = "completed";
    generationSummary = "generation_completed";
  } else if (hasActiveGeneration) {
    generationStatus = "current";
    generationSummary = "generation_running";
  } else if (hasFailedGeneration) {
    generationStatus = "failed";
    generationSummary = "generation_failed";
  }
  const generation: MakingProcessStep = {
    key: "generation",
    status: generationStatus,
    timestamp:
      generationStatus === "completed" || generationStatus === "failed"
        ? latestDate(evidence.videoJobs.map((job) => job.finishedAt))
        : latestDate(
            evidence.videoJobs.map(
              (job) => job.submittedAt ?? job.createdAt,
            ),
          ),
    summary: generationSummary,
    completed,
    total,
  };

  let postStatus: MakingProcessStepStatus = "pending";
  let postSummary = "post_pending";
  if (
    evidence.hasPlayableVideo ||
    evidence.finalVideoStatus === "READY"
  ) {
    postStatus = "completed";
    postSummary = "post_ready";
  } else if (evidence.finalVideoStatus === "FAILED") {
    postStatus = "failed";
    postSummary = "post_failed";
  } else if (
    evidence.finalVideoStatus === "PENDING" ||
    evidence.finalVideoStatus === "STITCHING" ||
    generationStatus === "completed"
  ) {
    postStatus = "current";
    postSummary = "post_processing";
  }
  const postProduction: MakingProcessStep = {
    key: "post-production",
    status: postStatus,
    timestamp:
      postStatus === "completed" || postStatus === "failed"
        ? evidence.finalVideoFinishedAt ?? null
        : evidence.finalVideoStartedAt ?? null,
    summary: postSummary,
  };

  return [brief, storyboard, generation, postProduction];
}

export function toUnifiedLibraryRow(
  order: UnifiedLibraryOrder,
  isShowcase = false,
): UnifiedLibraryRow | null {
  const brief = order.rounds[0]?.angles[0]?.videoBrief ?? null;
  if (brief?.takedownAt) return null;
  const finalVideo = brief?.finalVideo ?? null;
  const jobStatuses = (brief?.videoJobs.map((job) => job.status) ?? []) as VideoJobStatus[];
  const segmentCount = finalVideo?.segmentCount ?? jobStatuses.length;
  const segmentsSucceeded = jobStatuses.filter((status) => status === "SUCCEEDED").length;
  const failedSceneCount = jobStatuses.filter((status) => status === "FAILED").length;
  const derived = derivePersonalStatus({
    briefStatus: (brief?.status ?? null) as VideoBriefStatus | null,
    finalVideoStatus: (finalVideo?.status ?? null) as FinalVideoStatus | null,
    segmentsSucceeded,
    segmentsTotal: segmentCount,
    jobStatuses,
    ...summarizeRunningJobs(brief?.videoJobs ?? []),
  });

  return unifiedLibraryRowSchema.parse({
    id: order.id,
    briefId: brief?.id ?? null,
    source: "order",
    videoJobId: null,
    batchId: null,
    isShowcase,
    brandedVideoUrl: customerSafeFinalVideoUrl(brief?.brandedVideoUrl ?? null),
    title: order.title,
    updatedAt: order.updatedAt,
    status: derived.status satisfies PersonalVideoStatus,
    label: derived.label,
    progress: Math.round(derived.progressHint * 100),
    videoUrl: customerSafeFinalVideoUrl(
      finalVideo?.stitchedVideoUrl ?? brief?.finalVideoUrl ?? null,
    ),
    thumbnailUrl: customerSafeFinalVideoUrl(
      finalVideo?.thumbnailUrl ?? brief?.finalThumbnailUrl ?? null,
    ),
    durationSec: brief?.durationSec ?? null,
    aspectRatio: brief?.aspectRatio ?? null,
    failedSceneCount,
    canRetry: derived.status === "failed" || failedSceneCount > 0,
  });
}

function toUnifiedLibraryDetail(
  order: UnifiedLibraryOrder,
  isShowcase = false,
) {
  const row = toUnifiedLibraryRow(order, isShowcase);
  if (!row) return null;
  const brief = order.rounds[0]?.angles[0]?.videoBrief ?? null;
  const finalVideo = brief?.finalVideo ?? null;
  return {
    ...row,
    subtitleFileUrl: customerSafeFinalVideoUrl(
      finalVideo?.subtitleFileUrl ?? null,
    ),
    makingProcess: deriveMakingProcess({
      orderCreatedAt: order.createdAt,
      briefCreatedAt: brief?.createdAt,
      briefStatus: brief?.status ?? null,
      storyboardStatus: brief?.storyboardRun?.status ?? null,
      storyboardCreatedAt: brief?.storyboardRun?.createdAt,
      storyboardApprovedAt: brief?.storyboardRun?.approvedAt,
      storyboardUpdatedAt: brief?.storyboardRun?.updatedAt,
      videoJobs: brief?.videoJobs ?? [],
      finalVideoStatus: finalVideo?.status ?? null,
      finalVideoStartedAt: finalVideo?.startedAt,
      finalVideoFinishedAt: finalVideo?.finishedAt,
      hasPlayableVideo: Boolean(row.videoUrl),
    }),
  };
}

/// 批量生产的 VideoJob → 成品库行。成品库文案承诺「单条与批量都汇总在这里」，
/// 因此批量视频与订单行合并展示；品牌封装按 videoJobId 粒度操作。
function batchJobStatusToLibraryStatus(
  status: VideoJobStatus,
): "planning" | "generating" | "ready" | "failed" {
  if (status === "SUCCEEDED") return "ready";
  if (status === "FAILED" || status === "CANCELLED") return "failed";
  if (status === "QUEUED") return "planning";
  return "generating";
}

type BatchLibraryJob = Prisma.VideoJobGetPayload<{
  select: typeof batchLibraryJobSelect;
}>;

const batchLibraryJobSelect = {
  id: true,
  batchIndex: true,
  status: true,
  lastProgress: true,
  outputVideoUrl: true,
  outputThumbUrl: true,
  brandedVideoUrl: true,
  templateSnapshot: true,
  updatedAt: true,
  batchJob: {
    select: {
      id: true,
      productName: true,
      template: { select: { nameZh: true, name: true } },
    },
  },
} satisfies Prisma.VideoJobSelect;

export function toBatchLibraryRow(
  job: BatchLibraryJob,
  isShowcase = false,
): UnifiedLibraryRow | null {
  if (!job.batchJob) return null;
  const status = batchJobStatusToLibraryStatus(job.status);
  /// 曾经这里读的是 snapshot.durationSec / snapshot.aspectRatio —— 顶层没有这两个 key，
  /// 于是所有批量成片的时长与画幅在成品库里恒为空。它们其实冻在 lockedParams 里。
  const snapshot = readTemplateSnapshot(job.templateSnapshot);
  const templateName =
    job.batchJob.template.nameZh ?? job.batchJob.template.name;
  const index = (job.batchIndex ?? 0) + 1;
  return unifiedLibraryRowSchema.parse({
    id: `batch-${job.id}`,
    briefId: null,
    source: "batch",
    videoJobId: job.id,
    batchId: job.batchJob.id,
    isShowcase,
    brandedVideoUrl: customerSafeFinalVideoUrl(job.brandedVideoUrl),
    title: `${job.batchJob.productName ?? templateName} · ${templateName} #${index}`,
    updatedAt: job.updatedAt,
    status,
    label: status,
    progress:
      status === "ready" ? 100 : Math.round((job.lastProgress ?? 0)),
    videoUrl: customerSafeFinalVideoUrl(job.outputVideoUrl),
    thumbnailUrl: customerSafeFinalVideoUrl(job.outputThumbUrl),
    durationSec: snapshot?.durationSec ?? null,
    aspectRatio: snapshot?.aspectRatio ?? null,
    failedSceneCount: 0,
    canRetry: false,
  });
}


/**
 * PRD §4.3：素材库要收纳「上传原图、生成产品图、分镜、成片、**图文帖与轮播**、
 * 字幕/导出件」，按业务对象组织。
 *
 * 图文帖没有视频 URL，所以它的「可用」判据是**有没有出图**，
 * 而不是复用视频那套 videoUrl 判空 —— 纯文案帖本来就没有配图，
 * 它一样是可发布的成品，不能因为没有 videoUrl 就被当成半成品过滤掉。
 */
const contentPostLibrarySelect = {
  id: true,
  key: true,
  format: true,
  status: true,
  copyHook: true,
  renderedImageUrls: true,
  updatedAt: true,
  plan: { select: { id: true, theme: true } },
} satisfies Prisma.ContentPostSelect;

type ContentPostLibraryRow = Prisma.ContentPostGetPayload<{
  select: typeof contentPostLibrarySelect;
}>;

const POST_FORMAT_LABEL: Record<string, string> = {
  TEXT: "文案帖",
  SINGLE_IMAGE: "单图帖",
  CAROUSEL: "轮播",
  VIDEO: "短视频",
};

export function toContentPostLibraryRow(
  post: ContentPostLibraryRow,
  isShowcase = false,
): UnifiedLibraryRow | null {
  /// 商家主动弃用的内容不进素材库，但记录仍在（不物理删除）。
  if (post.status === "DISCARDED") return null;

  const needsImage = post.format === "SINGLE_IMAGE" || post.format === "CAROUSEL";
  const hasImages = post.renderedImageUrls.length > 0;
  const status = needsImage && !hasImages ? "generating" : "ready";

  return unifiedLibraryRowSchema.parse({
    id: `post-${post.id}`,
    briefId: null,
    source: "post",
    videoJobId: null,
    batchId: null,
    planId: post.plan.id,
    isShowcase,
    brandedVideoUrl: null,
    title: `${post.plan.theme} · ${POST_FORMAT_LABEL[post.format] ?? post.format}`,
    updatedAt: post.updatedAt,
    status,
    label: status,
    progress: status === "ready" ? 100 : 0,
    /// 图文帖没有视频；配图走 imageUrls，UI 据此渲染图而不是播放器。
    videoUrl: null,
    thumbnailUrl: post.renderedImageUrls[0] ?? null,
    imageUrls: post.renderedImageUrls,
    durationSec: null,
    aspectRatio: needsImage ? "2:3" : null,
    failedSceneCount: 0,
    canRetry: needsImage && !hasImages,
  });
}

/**
 * Terminal failures without playable media are operational records, not useful
 * customer library items. Keep recoverable outputs visible even when their
 * status is failed so support and customers do not lose access to media.
 */
export function filterCustomerLibraryRows(
  rows: UnifiedLibraryRow[],
): UnifiedLibraryRow[] {
  /// 图文帖没有 videoUrl 也可能是完整成品（纯文案帖），
  /// 所以只对视频来源套「失败且无可播放媒体则隐藏」这条规则。
  return rows.filter(
    (row) =>
      row.source === "post" || row.status !== "failed" || Boolean(row.videoUrl),
  );
}

async function loadRowsForOwner(
  ownerId: string,
  isShowcase: boolean,
): Promise<UnifiedLibraryRow[]> {
  const [orders, batchJobs, contentPosts] = await Promise.all([
    db.deliveryOrder.findMany({
      where: { createdById: ownerId, productCategory: "unified_input" },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: unifiedLibraryOrderSelect,
    }),
    db.videoJob.findMany({
      where: { batchJob: { userId: ownerId } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: batchLibraryJobSelect,
    }),
    /// PRD §4.3：图文帖与轮播也要进素材库，否则商家出完图就找不到它们了。
    db.contentPost.findMany({
      where: { plan: { userId: ownerId } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: contentPostLibrarySelect,
    }),
  ]);

  const rows = [
    ...orders
      .map((order) => toUnifiedLibraryRow(order, isShowcase))
      .filter((row): row is UnifiedLibraryRow => row !== null),
    ...batchJobs
      .map((job) => toBatchLibraryRow(job, isShowcase))
      .filter((row): row is UnifiedLibraryRow => row !== null),
    ...contentPosts
      .map((post) => toContentPostLibraryRow(post, isShowcase))
      .filter((row): row is UnifiedLibraryRow => row !== null),
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  // 样片只暴露已完成成片，避免把半成品/失败的 demo 内容展示给其他用户。
  return isShowcase
    ? rows.filter((row) => row.status === "ready")
    : filterCustomerLibraryRows(rows);
}

export async function loadUnifiedLibrary(
  userId: string,
): Promise<UnifiedLibraryRow[]> {
  const showcaseUserId = await resolveShowcaseSourceFor(userId);
  const [ownRows, showcaseRows] = await Promise.all([
    loadRowsForOwner(userId, false),
    showcaseUserId
      ? loadRowsForOwner(showcaseUserId, true)
      : Promise.resolve<UnifiedLibraryRow[]>([]),
  ]);
  // 访问者本人成片在前，SunnyShutter 客户样片在后（新注册用户仅见样片）。
  return [...ownRows, ...showcaseRows];
}

export async function getUnifiedLibraryItem(userId: string, orderId: string) {
  const own = await db.deliveryOrder.findFirst({
    where: {
      id: orderId,
      createdById: userId,
      productCategory: "unified_input",
    },
    select: unifiedLibraryOrderSelect,
  });
  if (own) return toUnifiedLibraryDetail(own);

  // 命中样片账号的成片则以只读样片形式返回。
  const showcaseUserId = await resolveShowcaseSourceFor(userId);
  if (!showcaseUserId) return null;
  const showcase = await db.deliveryOrder.findFirst({
    where: {
      id: orderId,
      createdById: showcaseUserId,
      productCategory: "unified_input",
    },
    select: unifiedLibraryOrderSelect,
  });
  return showcase ? toUnifiedLibraryDetail(showcase, true) : null;
}
