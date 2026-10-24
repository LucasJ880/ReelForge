import type {
  FinalVideoStatus,
  Prisma,
  StoryboardRunStatus,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import type { Locale } from "@/i18n/config";
import {
  customerSafeFinalVideoUrl,
  derivePersonalStatus,
  type PersonalVideoStatus,
} from "@/lib/video-generation/personal-status";
import { summarizeRunningJobs } from "@/lib/video-generation/business-status";
import {
  unifiedLibraryRowSchema,
  type UnifiedLibraryRow,
  type UnifiedLibraryStatus,
} from "@/lib/contracts/unified-library";
import { readBatchPostProductionFromSnapshot } from "@/lib/services/batch-service";
import { resolveShowcaseSourceFor } from "@/lib/services/showcase-library";
import { bgmAttributionFor } from "@/lib/video-generation/bgm-attribution";
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
                  /// 后期快照：读配乐署名（CC BY 要求随交付署名）。
                  postProduction: true,
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

/**
 * 客户取消过的单条（1025 · 单条可取消）：有被取消的段、且没有在跑 / 排队 / 暂停 / 失败的段。
 * 取消不是失败——成品库写「已取消」，不叫客户「重试失败片段」。
 */
export function isCancelledOrderJobs(jobStatuses: readonly string[]): boolean {
  return (
    jobStatuses.includes("CANCELLED") &&
    !jobStatuses.some((status) => ["QUEUED", "RUNNING", "PAUSED", "FAILED"].includes(status))
  );
}

export function deriveMakingProcess(
  evidence: MakingProcessEvidence,
): MakingProcessStep[] {
  const cancelled =
    !evidence.hasPlayableVideo && isCancelledOrderJobs(evidence.videoJobs.map((job) => job.status));
  const briefFailed =
    !cancelled &&
    (evidence.briefStatus === "RENDER_FAILED" ||
      evidence.briefStatus === "QA_REJECTED" ||
      evidence.briefStatus === "DROPPED");
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
  } else if (cancelled) {
    generationStatus = "failed";
    generationSummary = "generation_cancelled";
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
  } else if (cancelled) {
    postStatus = "pending";
    postSummary = "post_cancelled";
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

/**
 * 成品库行状态的最后一道收口（1025 · B1.4）：派生状态说「生成中 / 准备中」时，按分段的真实状态改判。
 * 只有供应商侧真有分段在跑才叫「生成中」；排队的是「排队中」，暂停的是「已暂停」，
 * 没有分段还在路上却有失败的是「失败」（等你重试失败片段），全被取消的是「已取消」。
 * 与 exchange-readings 的 orderGeneratingWhere / orderQueuedWhere / orderFailureWhere 同口径。
 */
export function refineOrderLibraryStatus(
  derived: PersonalVideoStatus,
  jobStatuses: VideoJobStatus[],
): UnifiedLibraryStatus {
  if (derived !== "generating" && derived !== "planning") return derived;
  if (jobStatuses.length === 0) return "planning";
  if (jobStatuses.includes("RUNNING")) return "generating";
  if (jobStatuses.includes("QUEUED")) return "planning";
  if (jobStatuses.includes("PAUSED")) return "paused";
  if (jobStatuses.includes("FAILED")) return "failed";
  if (jobStatuses.includes("CANCELLED")) return "cancelled";
  /// 分段都好了、还没合成：合成中。
  return "assembling";
}

/** 坏行不拖垮整页（bughunt #24）：丢掉这一行并上报，别的行照常显示。 */
function parseLibraryRow(candidate: Record<string, unknown>): UnifiedLibraryRow | null {
  const parsed = unifiedLibraryRowSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  console.error("[unified-library] dropped invalid row", {
    id: candidate.id,
    source: candidate.source,
    issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
  });
  return null;
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
  const playable = Boolean(finalVideo?.stitchedVideoUrl ?? brief?.finalVideoUrl);
  const status =
    !playable && isCancelledOrderJobs(jobStatuses)
      ? "cancelled"
      : refineOrderLibraryStatus(derived.status, jobStatuses);
  const active = status === "generating" || status === "assembling";

  return parseLibraryRow({
    id: order.id,
    briefId: brief?.id ?? null,
    source: "order",
    videoJobId: null,
    batchId: null,
    isShowcase,
    brandedVideoUrl: customerSafeFinalVideoUrl(brief?.brandedVideoUrl ?? null),
    bgmAttribution: bgmAttributionFor(finalVideo?.postProduction ?? null),
    title: order.title,
    updatedAt: order.updatedAt,
    status,
    label: derived.label,
    /// 排队与暂停不显示进度（之前暂停写「0%」被读成卡死）。
    progress: status === "ready" ? 100 : active ? Math.round(derived.progressHint * 100) : 0,
    videoUrl: customerSafeFinalVideoUrl(
      finalVideo?.stitchedVideoUrl ?? brief?.finalVideoUrl ?? null,
    ),
    thumbnailUrl: customerSafeFinalVideoUrl(
      finalVideo?.thumbnailUrl ?? brief?.finalThumbnailUrl ?? null,
    ),
    durationSec: brief?.durationSec ?? null,
    aspectRatio: brief?.aspectRatio ?? null,
    failedSceneCount,
    canRetry: status === "failed" || failedSceneCount > 0,
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
/// 暂停是暂停、取消是取消：之前 PAUSED 归「生成中」、CANCELLED 归「失败」（1025 · B1.4）。
export function batchJobStatusToLibraryStatus(status: VideoJobStatus): UnifiedLibraryStatus {
  switch (status) {
    case "SUCCEEDED":
      return "ready";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    case "PAUSED":
      return "paused";
    case "QUEUED":
      return "planning";
    default:
      return "generating";
  }
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

/**
 * 模板在客户界面上的名字：英文界面用 name，中文界面用 nameZh。
 * 成品库行、需要处理、大屏与生产带的标题都从这里取——标题拼在服务端、来自数据库，
 * 文案门禁扫不到，之前英文界面就一直挂着「价值感证明」这类中文模板名（B2.5）。
 */
export function templateDisplayName(
  template: { name: string; nameZh: string | null },
  locale: Locale,
): string {
  return locale === "en-US" ? template.name : (template.nameZh ?? template.name);
}

export function toBatchLibraryRow(
  job: BatchLibraryJob,
  isShowcase = false,
  locale: Locale = "zh-CN",
): UnifiedLibraryRow | null {
  if (!job.batchJob) return null;
  const status = batchJobStatusToLibraryStatus(job.status);
  /// 曾经这里读的是 snapshot.durationSec / snapshot.aspectRatio —— 顶层没有这两个 key，
  /// 于是所有批量成片的时长与画幅在成品库里恒为空。它们其实冻在 lockedParams 里。
  const snapshot = readTemplateSnapshot(job.templateSnapshot);
  const templateName = templateDisplayName(job.batchJob.template, locale);
  const index = (job.batchIndex ?? 0) + 1;
  return parseLibraryRow({
    id: `batch-${job.id}`,
    briefId: null,
    source: "batch",
    videoJobId: job.id,
    batchId: job.batchJob.id,
    isShowcase,
    brandedVideoUrl: customerSafeFinalVideoUrl(job.brandedVideoUrl),
    bgmAttribution: bgmAttributionFor(readBatchPostProductionFromSnapshot(job.templateSnapshot)),
    /// 序号放在产品名后面：窄屏截断时吃掉的是模板名，不是唯一能区分的「#12 / #11」。
    title: `${job.batchJob.productName ?? templateName} #${index} · ${templateName}`,
    updatedAt: job.updatedAt,
    status,
    label: status,
    progress:
      status === "ready" ? 100 : status === "generating" ? Math.round(job.lastProgress ?? 0) : 0,
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
  /// 未出图 ≠ 生成中：没有任何任务在跑，显示「生成中 0%」会让商家以为卡死了
  /// （0802 录屏抓到的误导）。planning（准备中）才是实情 —— 等商家点「生成配图」。
  /// 短视频帖只有脚本，视频还没拍：是「待生产」，不是成片（1025 · B1.2：成片只数视频）。
  const status = (needsImage && !hasImages) || post.format === "VIDEO" ? "planning" : "ready";

  return parseLibraryRow({
    id: `post-${post.id}`,
    briefId: null,
    source: "post",
    videoJobId: null,
    batchId: null,
    planId: post.plan.id,
    postFormat: post.format,
    isShowcase,
    brandedVideoUrl: null,
    /// 标题用帖子自己的钩子文案：同一计划的多个帖子若都叫「主题 · 形态」，
    /// 在成品库里看起来就是一堆重复行（0802 Lucas 实测反馈）。
    title: `${post.copyHook}（${POST_FORMAT_LABEL[post.format] ?? post.format}）`,
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
 *
 * 失败行由「需要处理」区单独列出（exchange-readings.loadNeedsAttention，与导轨徽标同一个查询），
 * 取消的没有媒体也不进列表——取消是商家自己的决定，不是待办。
 */
export function filterCustomerLibraryRows(
  rows: UnifiedLibraryRow[],
): UnifiedLibraryRow[] {
  /// 图文帖没有 videoUrl 也可能是完整成品（纯文案帖），
  /// 所以只对视频来源套「失败 / 取消且无可播放媒体则隐藏」这条规则。
  return rows.filter(
    (row) =>
      row.source === "post" ||
      (row.status !== "failed" && row.status !== "cancelled") ||
      Boolean(row.videoUrl),
  );
}

/** 每个来源最多读这么多行；超出时页面写明截断（游标分页在下一轮）。 */
export const LIBRARY_ROWS_PER_SOURCE = 300;

export type UnifiedLibraryResult = {
  rows: UnifiedLibraryRow[];
  /** 本人数据里有来源超过了每来源上限（只显示最近的 LIBRARY_ROWS_PER_SOURCE 条）。 */
  truncated: boolean;
  perSourceLimit: number;
};

function mapRows(
  orders: UnifiedLibraryOrder[],
  batchJobs: BatchLibraryJob[],
  contentPosts: ContentPostLibraryRow[],
  isShowcase: boolean,
  locale: Locale,
): UnifiedLibraryRow[] {
  return [
    ...orders.map((order) => toUnifiedLibraryRow(order, isShowcase)),
    ...batchJobs.map((job) => toBatchLibraryRow(job, isShowcase, locale)),
    ...contentPosts.map((post) => toContentPostLibraryRow(post, isShowcase)),
  ]
    .filter((row): row is UnifiedLibraryRow => row !== null)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

async function loadRowsForOwner(
  ownerId: string,
  isShowcase: boolean,
  locale: Locale,
): Promise<{ rows: UnifiedLibraryRow[]; truncated: boolean }> {
  /// 多取一行用来判断是否截断。
  const take = LIBRARY_ROWS_PER_SOURCE + 1;
  const [orders, batchJobs, contentPosts] = await Promise.all([
    db.deliveryOrder.findMany({
      where: { createdById: ownerId, productCategory: "unified_input" },
      orderBy: { updatedAt: "desc" },
      take,
      select: unifiedLibraryOrderSelect,
    }),
    db.videoJob.findMany({
      where: { batchJob: { userId: ownerId } },
      orderBy: { updatedAt: "desc" },
      take,
      select: batchLibraryJobSelect,
    }),
    /// PRD §4.3：图文帖与轮播也要进素材库，否则商家出完图就找不到它们了。
    db.contentPost.findMany({
      where: { plan: { userId: ownerId } },
      orderBy: { updatedAt: "desc" },
      take,
      select: contentPostLibrarySelect,
    }),
  ]);
  const truncated = [orders, batchJobs, contentPosts].some((list) => list.length > LIBRARY_ROWS_PER_SOURCE);
  const rows = mapRows(
    orders.slice(0, LIBRARY_ROWS_PER_SOURCE),
    batchJobs.slice(0, LIBRARY_ROWS_PER_SOURCE),
    contentPosts.slice(0, LIBRARY_ROWS_PER_SOURCE),
    isShowcase,
    locale,
  );

  // 样片只暴露已完成成片，避免把半成品/失败的 demo 内容展示给其他用户。
  return {
    rows: isShowcase ? rows.filter((row) => row.status === "ready") : filterCustomerLibraryRows(rows),
    truncated,
  };
}

export async function loadUnifiedLibrary(
  userId: string,
  { locale = "zh-CN" }: { locale?: Locale } = {},
): Promise<UnifiedLibraryResult> {
  const showcaseUserId = await resolveShowcaseSourceFor(userId);
  const [own, showcase] = await Promise.all([
    loadRowsForOwner(userId, false, locale),
    showcaseUserId
      ? loadRowsForOwner(showcaseUserId, true, locale)
      : Promise.resolve({ rows: [] as UnifiedLibraryRow[], truncated: false }),
  ]);
  // 访问者本人成片在前，SunnyShutter 客户样片在后（新注册用户仅见样片）。
  return {
    rows: [...own.rows, ...showcase.rows],
    truncated: own.truncated,
    perSourceLimit: LIBRARY_ROWS_PER_SOURCE,
  };
}

/**
 * 大屏用的「最近几条视频」：只读本人、只取最近 take 条（单条 + 批量，不含图文帖），
 * 不扫整个成品库。readyWithMedia = 只要可播放的成片。
 */
export async function loadRecentVideoRows(
  userId: string,
  {
    take,
    readyWithMedia = false,
    locale = "zh-CN",
  }: { take: number; readyWithMedia?: boolean; locale?: Locale },
): Promise<UnifiedLibraryRow[]> {
  const [orders, batchJobs] = await Promise.all([
    db.deliveryOrder.findMany({
      where: { createdById: userId, productCategory: "unified_input" },
      orderBy: { updatedAt: "desc" },
      /// 订单的派生状态在内存里算；成片墙多取几行再筛。
      take: readyWithMedia ? take * 3 : take,
      select: unifiedLibraryOrderSelect,
    }),
    db.videoJob.findMany({
      where: {
        batchJob: { userId },
        ...(readyWithMedia ? { status: "SUCCEEDED" as const, outputVideoUrl: { not: null } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take,
      select: batchLibraryJobSelect,
    }),
  ]);
  const rows = filterCustomerLibraryRows(mapRows(orders, batchJobs, [], false, locale));
  return (readyWithMedia ? rows.filter((row) => row.status === "ready" && row.videoUrl) : rows).slice(0, take);
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
