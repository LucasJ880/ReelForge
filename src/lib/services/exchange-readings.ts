import type { Prisma, VideoBriefStatus } from "@prisma/client";
import { db } from "@/lib/db";
import type { Locale } from "@/i18n/config";
import { classifyCustomerGenerationError } from "@/lib/api/customer-generation-error";
import type { CustomerRecoveryAction } from "@/lib/contracts/customer-api";
import type { ExchangePulse, PulsePlan, TapeEntry } from "@/lib/exchange/pulse";
import { countNewLeads } from "@/lib/services/lead-service";
import { getUsageSummary } from "@/lib/services/quota-service";
import { CUSTOMER_CANCELLED_CLASS } from "@/lib/services/single-video-cancel-service";
import {
  loadRecentVideoRows,
  templateDisplayName,
  type UnifiedLibraryRow,
} from "@/lib/services/unified-library-service";

/**
 * 交易台读数的唯一口径（1025 · B1.1 / B1.2）：壳层、创作台、批量页、新建批次、成品库、
 * 模板库、大屏共用。名字与口径写在 src/lib/exchange/readings-registry.ts，数值只从这里来。
 *
 * 规则：
 *  - 一律 DB count / groupBy，不再扫成品库列表（之前每个来源只取 100 行，重度账号的
 *    成片数被截断、成功率被系统性压低）。
 *  - 只数访问者本人的数据（成品库样片一律不计）；零就是零。
 *  - 「生成中」只指供应商侧真有活跃任务的视频（不含排队、暂停与图文帖）；
 *    「进行中批次」不含暂停；「成片」只数视频，图文帖与短视频帖不算。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const NEEDS_ATTENTION_WINDOW_DAYS = 7;

/** 单条订单「失败」的 brief 状态（与 business-status 的 pickStatus 同口径）。 */
const FAILED_BRIEF_STATUSES: VideoBriefStatus[] = ["RENDER_FAILED", "QA_REJECTED", "DROPPED"];
/** 单条订单「已成片」的 brief 状态（QA_PENDING 起即已写入成片）。 */
const READY_BRIEF_STATUSES: VideoBriefStatus[] = [
  "QA_PENDING",
  "QA_APPROVED",
  "PUBLISH_PENDING",
  "PUBLISHED",
  "METRICS_COLLECTING",
  "SCORED",
  "ARCHIVED",
];

type Range = { gte: Date; lt?: Date };

/* ── 共用的 where 片段：计数与「需要处理」列表必须用同一份，才能同名必同值 ── */

/** 本人自助创作（unified_input）的单条订单的 brief，未下架。 */
export function ownedBriefWhere(userId: string): Prisma.VideoBriefWhereInput {
  return {
    takedownAt: null,
    contentAngle: { round: { deliveryOrder: { createdById: userId, productCategory: "unified_input" } } },
  };
}

/**
 * 「失败那一刻」落在窗口内：取 finishedAt（只在这一轮进入终态时写；重试会清空、再失败重写），
 * 旧数据没有 finishedAt 才退回 updatedAt。不能直接用 updatedAt：返还打标（quotaRefundedAt）、
 * 刷新状态这类与失败无关的写入都会刷新它，「看过了」之后失败又冒回徽标、7 天窗口也被重新起算。
 */
function failedAtIn(range: Range) {
  return { OR: [{ finishedAt: range }, { finishedAt: null, updatedAt: range }] };
}

/**
 * brief 判失败的那一刻：失败分段或失败成片的 finishedAt；两者都没有时间戳（无任务 brief、
 * QA 驳回等）才退回 brief 的 updatedAt。
 */
function briefFailedAtIn(range: Range): Prisma.VideoBriefWhereInput {
  const stamped = { status: "FAILED" as const, finishedAt: { not: null } };
  return {
    OR: [
      { videoJobs: { some: { status: "FAILED", finishedAt: range } } },
      { finalVideo: { is: { status: "FAILED", finishedAt: range } } },
      { videoJobs: { none: stamped }, NOT: { finalVideo: { is: stamped } }, updatedAt: range },
    ],
  };
}

/** 批量里失败的那一条：当前状态仍是 FAILED（重试会把它改回排队，成功就不再是失败）。 */
export function batchFailureWhere(userId: string, range: Range): Prisma.VideoJobWhereInput {
  return { status: "FAILED", batchJob: { userId }, ...failedAtIn(range) };
}

/** 还在路上的分段：排队 / 生成中 / 暂停。 */
const ACTIVE_JOB_STATUSES = ["QUEUED", "RUNNING", "PAUSED"] as const;

/** 已成片：成片合成完成，或 brief 已进入成片之后的状态。 */
const ORDER_READY: Prisma.VideoBriefWhereInput = {
  OR: [{ finalVideo: { is: { status: "READY" } } }, { status: { in: READY_BRIEF_STATUSES } }],
};

/**
 * 单条订单失败的四种情形（与 business-status 的 pickStatus + 成品库 refineOrderLibraryStatus 同口径）：
 * brief 判失败 / 成片合成失败 / 分段全部失败 / 有分段失败且没有分段还在路上（也没成片、没在合成）。
 * 传 range 时按「失败那一刻」落在窗口内筛（finishedAt 为准，见 failedAtIn / briefFailedAtIn）。
 */
function orderFailureClauses(range?: Range): Prisma.VideoBriefWhereInput[] {
  const at = range ? failedAtIn(range) : {};
  return [
    { status: { in: FAILED_BRIEF_STATUSES }, ...(range ? briefFailedAtIn(range) : {}) },
    { finalVideo: { is: { status: "FAILED", ...at } } },
    { videoJobs: { some: { status: "FAILED", ...at }, every: { status: "FAILED" } } },
    {
      videoJobs: { some: { status: "FAILED", ...at }, none: { status: { in: [...ACTIVE_JOB_STATUSES] } } },
      NOT: [ORDER_READY, { finalVideo: { is: { status: "STITCHING" } } }],
    },
  ];
}

/**
 * 客户自己取消的单条（cancelUnifiedOrderForUser 打了 customer_cancelled 标记、且没有失败段）：
 * 取消不是失败——不进「需要处理」、不拉低成片率（与成品库 isCancelledOrderJobs 同口径）。
 */
const CUSTOMER_CANCELLED_ORDER: Prisma.VideoBriefWhereInput = {
  videoJobs: {
    some: { status: "CANCELLED", submissionErrorClass: CUSTOMER_CANCELLED_CLASS },
    none: { status: "FAILED" },
  },
};

/** 单条订单失败，时间按各自那一刻算。 */
export function orderFailureWhere(userId: string, range: Range): Prisma.VideoBriefWhereInput {
  return { ...ownedBriefWhere(userId), OR: orderFailureClauses(range), NOT: CUSTOMER_CANCELLED_ORDER };
}

/** 不看时间的单条失败判据（用来把失败排除在「成片 / 生成中 / 排队中」之外）。 */
const ORDER_FAILED_ANY: Prisma.VideoBriefWhereInput = { OR: orderFailureClauses(), NOT: CUSTOMER_CANCELLED_ORDER };

/** 批量成片：成片时刻取 finishedAt，旧数据没有就退回 updatedAt。 */
export function batchReadyWhere(userId: string, range?: Range): Prisma.VideoJobWhereInput {
  return {
    status: "SUCCEEDED",
    batchJob: { userId },
    ...(range ? { OR: [{ finishedAt: range }, { finishedAt: null, updatedAt: range }] } : {}),
  };
}

/** 单条成片；成片时刻取合成完成时间（旧的单段流程没有 FinalVideo，退回 brief 更新时间）。 */
export function orderReadyWhere(userId: string, range?: Range): Prisma.VideoBriefWhereInput {
  return {
    ...ownedBriefWhere(userId),
    NOT: ORDER_FAILED_ANY,
    AND: [
      ORDER_READY,
      ...(range
        ? [{ OR: [{ finalVideo: { is: { finishedAt: range } } }, { finalVideoId: null, updatedAt: range }] }]
        : []),
    ],
  };
}

/** 单条「真在生成」：有分段在供应商侧跑，或分段都好了正在合成。 */
export function orderGeneratingWhere(userId: string): Prisma.VideoBriefWhereInput {
  return {
    ...ownedBriefWhere(userId),
    NOT: [ORDER_FAILED_ANY, ORDER_READY],
    OR: [
      { videoJobs: { some: { status: "RUNNING", batchJobId: null } } },
      { finalVideo: { is: { status: "STITCHING" } } },
    ],
  };
}

/** 单条「排队中」：有分段在排队、没有分段在跑、也没在合成。 */
export function orderQueuedWhere(userId: string): Prisma.VideoBriefWhereInput {
  return {
    ...ownedBriefWhere(userId),
    NOT: [ORDER_FAILED_ANY, ORDER_READY, { finalVideo: { is: { status: "STITCHING" } } }],
    videoJobs: { some: { status: "QUEUED", batchJobId: null }, none: { status: "RUNNING" } },
  };
}

/** 待出图：排好但还没出图的单图帖与轮播（短视频帖是「待生产」，不算这里）。 */
export function awaitingImagesWhere(userId: string): Prisma.ContentPostWhereInput {
  return {
    plan: { userId },
    status: { not: "DISCARDED" },
    format: { in: ["SINGLE_IMAGE", "CAROUSEL"] },
    renderedImageUrls: { isEmpty: true },
  };
}

/** 「需要处理」从哪一刻算起：近 7 天，与「看过了」之后，取较晚的那个。 */
export function needsAttentionSince(now: Date, acknowledgedAt: Date | null | undefined): Date {
  const windowStart = new Date(now.getTime() - NEEDS_ATTENTION_WINDOW_DAYS * DAY_MS);
  return acknowledgedAt && acknowledgedAt > windowStart ? acknowledgedAt : windowStart;
}

function pulsePlan(plan: string): PulsePlan {
  if (plan === "trial") return "trial";
  if (plan === "studio" || plan === "pro") return "studio";
  return "starter";
}

/** 本月视频额度：读 UserUsagePeriod（UTC 自然月），上限按生效档（试用 3 条，不是 PlanEntitlement 的 30）。 */
export async function loadVideoQuota(userId: string): Promise<ExchangePulse["quota"]> {
  const summary = await getUsageSummary(userId);
  const meter = summary.meters.find((item) => item.resource === "VIDEO_DISPATCH");
  return { used: meter?.used ?? 0, limit: meter?.limit ?? 0, plan: pulsePlan(summary.plan) };
}

const TAPE_SIZE = 12;

async function loadTape(userId: string, locale: Locale): Promise<TapeEntry[]> {
  const batches = await db.batchJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: TAPE_SIZE,
    select: {
      id: true,
      productName: true,
      status: true,
      requestedCount: true,
      completedCount: true,
      failedCount: true,
      updatedAt: true,
      template: { select: { nameZh: true, name: true } },
    },
  });
  return batches.map((batch) => ({
    id: batch.id,
    name: batch.productName ?? templateDisplayName(batch.template, locale),
    status: batch.status,
    done: batch.completedCount,
    total: batch.requestedCount,
    failed: batch.failedCount,
    at: batch.updatedAt.toISOString(),
  }));
}

async function countNeedsAttention(userId: string, since: Date): Promise<number> {
  const [batch, orders] = await Promise.all([
    db.videoJob.count({ where: batchFailureWhere(userId, { gte: since }) }),
    db.videoBrief.count({ where: orderFailureWhere(userId, { gte: since }) }),
  ]);
  return batch + orders;
}

export type ProductionCounts = Pick<ExchangePulse, "generating" | "queued" | "activeBatches" | "pausedBatches" | "awaitingImages">;

/** 生产线现在的样子：生成中 / 排队中 / 进行中与暂停的批次 / 待出图。页面读数与壳层同源。 */
export async function loadProductionCounts(userId: string): Promise<ProductionCounts> {
  const [batchStatuses, batchJobStatuses, orderGenerating, orderQueued, awaitingImages] = await Promise.all([
    db.batchJob.groupBy({
      by: ["status"],
      where: { userId, status: { in: ["EXPANDING", "RUNNING", "PAUSED"] } },
      _count: { _all: true },
    }),
    db.videoJob.groupBy({
      by: ["status"],
      where: { batchJob: { userId }, status: { in: ["RUNNING", "QUEUED"] } },
      _count: { _all: true },
    }),
    db.videoBrief.count({ where: orderGeneratingWhere(userId) }),
    db.videoBrief.count({ where: orderQueuedWhere(userId) }),
    db.contentPost.count({ where: awaitingImagesWhere(userId) }),
  ]);
  const batchCount = (status: string) => batchStatuses.find((group) => group.status === status)?._count._all ?? 0;
  const jobCount = (status: string) => batchJobStatuses.find((group) => group.status === status)?._count._all ?? 0;
  return {
    generating: jobCount("RUNNING") + orderGenerating,
    queued: jobCount("QUEUED") + orderQueued,
    /// 「进行中批次」不含暂停：暂停的批次没有在出片，算进来就是顶栏「生成中 2」配表格里只有 1 行在跑。
    activeBatches: batchCount("EXPANDING") + batchCount("RUNNING"),
    pausedBatches: batchCount("PAUSED"),
    awaitingImages,
  };
}

/**
 * 脉搏：壳层市场状态、导轨徽标、生产带、月度额度。全部是 DB count / groupBy，
 * 30 秒拉一次也不扫成品库。
 */
export async function loadPulse(
  userId: string,
  { now = new Date(), locale = "zh-CN" }: { now?: Date; locale?: Locale } = {},
): Promise<ExchangePulse> {
  const workspace = await db.workspace.findUnique({
    where: { ownerId: userId },
    select: { id: true, failuresAckedAt: true },
  });
  const since = needsAttentionSince(now, workspace?.failuresAckedAt);
  const [production, needsAttention, newLeads, quota, tape] = await Promise.all([
    loadProductionCounts(userId),
    countNeedsAttention(userId, since),
    workspace ? countNewLeads(workspace.id) : Promise.resolve(0),
    loadVideoQuota(userId),
    loadTape(userId, locale),
  ]);
  return { ...production, needsAttention, newLeads, quota, tape, at: now.toISOString() };
}

/* ── 需要处理：成品库列出的那一批，与徽标同一个 where ─────────────────── */

export type NeedsAttentionItem = {
  kind: "batch" | "order";
  /** 成品库行 id（batch-<jobId> / 订单 id），?highlight= 用它。 */
  rowId: string;
  title: string;
  /** 客户可见原因（中文）；英文界面按 code 取译文。 */
  reason: string;
  code: string;
  action: CustomerRecoveryAction;
  /** 批量失败链到批次详情（重试在那里）；单条失败重新生成并预填原素材。 */
  href: string;
  retryHref: string | null;
  at: Date;
};

export const NEEDS_ATTENTION_LIST_LIMIT = 50;

export async function loadNeedsAttention(
  userId: string,
  {
    now = new Date(),
    take = NEEDS_ATTENTION_LIST_LIMIT,
    locale = "zh-CN",
  }: { now?: Date; take?: number; locale?: Locale } = {},
): Promise<{ items: NeedsAttentionItem[]; total: number; since: Date }> {
  const workspace = await db.workspace.findUnique({ where: { ownerId: userId }, select: { failuresAckedAt: true } });
  const since = needsAttentionSince(now, workspace?.failuresAckedAt);
  const range = { gte: since };
  const [jobs, briefs, total] = await Promise.all([
    db.videoJob.findMany({
      where: batchFailureWhere(userId, range),
      /// 与计数同一个时间口径：失败那一刻（finishedAt），旧数据退回 updatedAt
      orderBy: [{ finishedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
      take,
      select: {
        id: true,
        batchIndex: true,
        status: true,
        submissionState: true,
        submissionErrorClass: true,
        errorMessage: true,
        userSafeError: true,
        finishedAt: true,
        updatedAt: true,
        batchJob: { select: { id: true, productName: true, template: { select: { nameZh: true, name: true } } } },
      },
    }),
    db.videoBrief.findMany({
      where: orderFailureWhere(userId, range),
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        id: true,
        errorMessage: true,
        updatedAt: true,
        finalVideo: { select: { status: true, finishedAt: true } },
        videoJobs: {
          where: { status: "FAILED", finishedAt: { not: null } },
          select: { finishedAt: true },
          orderBy: { finishedAt: "desc" },
          take: 1,
        },
        contentAngle: { select: { round: { select: { deliveryOrder: { select: { id: true, title: true } } } } } },
      },
    }),
    countNeedsAttention(userId, since),
  ]);

  const items: NeedsAttentionItem[] = [
    ...jobs.flatMap((job): NeedsAttentionItem[] => {
      if (!job.batchJob) return [];
      const templateName = templateDisplayName(job.batchJob.template, locale);
      const error = classifyCustomerGenerationError({
        status: job.status,
        submissionState: job.submissionState,
        submissionErrorClass: job.submissionErrorClass,
        errorMessage: job.errorMessage,
        userSafeError: job.userSafeError,
      });
      return [{
        kind: "batch",
        rowId: `batch-${job.id}`,
        /// 与成品库批量行同一个标题（unified-library-service.toBatchLibraryRow）。
        title: `${job.batchJob.productName ?? templateName} #${(job.batchIndex ?? 0) + 1} · ${templateName}`,
        reason: error?.message ?? "视频生成失败。",
        code: error?.code ?? "PROVIDER_ERROR",
        action: error?.action ?? "retry",
        href: `/app/batches/${job.batchJob.id}`,
        retryHref: null,
        at: job.finishedAt ?? job.updatedAt,
      }];
    }),
    ...briefs.map((brief): NeedsAttentionItem => {
      const order = brief.contentAngle.round.deliveryOrder;
      const error = classifyCustomerGenerationError({ status: "FAILED", errorMessage: brief.errorMessage });
      /// 失败那一刻：失败成片 / 失败分段的 finishedAt 取较晚者，都没有才退回 brief 的 updatedAt
      const failedAt = [
        brief.finalVideo?.status === "FAILED" ? brief.finalVideo.finishedAt : null,
        brief.videoJobs[0]?.finishedAt ?? null,
      ].filter((value): value is Date => value instanceof Date);
      const at = failedAt.length > 0 ? new Date(Math.max(...failedAt.map((value) => value.getTime()))) : brief.updatedAt;
      return {
        kind: "order",
        rowId: order.id,
        title: order.title,
        reason: error?.message ?? "视频生成失败。",
        code: error?.code ?? "PROVIDER_ERROR",
        action: error?.action ?? "retry",
        href: `/app/library/${order.id}`,
        retryHref: `/app/create?retry=${encodeURIComponent(order.id)}`,
        at,
      };
    }),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, take);

  return { items, total, since };
}

/** 「看过了」：把这一刻之前的失败从徽标与「需要处理」里清掉（记录本身不动）。 */
export async function acknowledgeFailures(userId: string, now = new Date()): Promise<Date> {
  await db.workspace.update({ where: { ownerId: userId }, data: { failuresAckedAt: now } });
  return now;
}

/* ── 成片 / 失败 / 成功率 ───────────────────────────────────────────── */

export type ExchangeReadings = {
  filled24h: number;
  filled7d: number;
  filled30d: number;
  /** 近 7 天失败条数（单条 + 批量），取消不算失败。 */
  failed7d: number;
  /** 近 7 天成片率 = 成片 ÷ (成片 + 失败)，0–100；没有样本时为 null，界面写「—」。 */
  successRate7d: number | null;
  /** 上一个同长窗口（24–48 小时前 / 7–14 天前）的同口径读数，用来画涨跌方向。 */
  previous: { filled24h: number; filled7d: number; failed7d: number };
  /** 最近成片（可播放的真实媒体），按更新时间倒序。 */
  media: UnifiedLibraryRow[];
  /** 生产回报：最近有动静的视频行，按更新时间倒序；默认不取。 */
  recent: UnifiedLibraryRow[];
};

async function countReady(userId: string, range?: Range): Promise<number> {
  const [batch, orders] = await Promise.all([
    db.videoJob.count({ where: batchReadyWhere(userId, range) }),
    db.videoBrief.count({ where: orderReadyWhere(userId, range) }),
  ]);
  return batch + orders;
}

async function countFailed(userId: string, range: Range): Promise<number> {
  const [batch, orders] = await Promise.all([
    db.videoJob.count({ where: batchFailureWhere(userId, range) }),
    db.videoBrief.count({ where: orderFailureWhere(userId, range) }),
  ]);
  return batch + orders;
}

/** 成品（成品库 03 格）：全部已成片视频 + 已出图的单图 / 轮播 + 纯文案帖；短视频帖是「待生产」不算。 */
export async function countFinished(userId: string): Promise<number> {
  const [videos, posts] = await Promise.all([
    countReady(userId),
    db.contentPost.count({
      where: {
        plan: { userId },
        status: { not: "DISCARDED" },
        OR: [{ format: "TEXT" }, { format: { in: ["SINGLE_IMAGE", "CAROUSEL"] }, renderedImageUrls: { isEmpty: false } }],
      },
    }),
  ]);
  return videos + posts;
}

export async function loadExchangeReadings(
  userId: string,
  {
    now = new Date(),
    mediaLimit = 0,
    recentLimit = 0,
    locale = "zh-CN",
  }: { now?: Date; mediaLimit?: number; recentLimit?: number; locale?: Locale } = {},
): Promise<ExchangeReadings> {
  const at = now.getTime();
  const ago = (days: number) => new Date(at - days * DAY_MS);
  const [filled24h, filledPrev24h, filled7d, filledPrev7d, filled30d, failed7d, failedPrev7d, media, recent] =
    await Promise.all([
      countReady(userId, { gte: ago(1) }),
      countReady(userId, { gte: ago(2), lt: ago(1) }),
      countReady(userId, { gte: ago(7) }),
      countReady(userId, { gte: ago(14), lt: ago(7) }),
      countReady(userId, { gte: ago(30) }),
      countFailed(userId, { gte: ago(7) }),
      countFailed(userId, { gte: ago(14), lt: ago(7) }),
      mediaLimit > 0 ? loadRecentVideoRows(userId, { take: mediaLimit, readyWithMedia: true, locale }) : Promise.resolve([]),
      recentLimit > 0 ? loadRecentVideoRows(userId, { take: recentLimit, locale }) : Promise.resolve([]),
    ]);
  return {
    filled24h,
    filled7d,
    filled30d,
    failed7d,
    successRate7d: filled7d + failed7d > 0 ? Math.round((filled7d / (filled7d + failed7d)) * 100) : null,
    previous: { filled24h: filledPrev24h, filled7d: filledPrev7d, failed7d: failedPrev7d },
    media,
    recent,
  };
}
