import { randomUUID } from "node:crypto";
import {
  ContentPostImageStatus,
  ProviderSubmissionState,
  type ContentPostImageTask,
  type MediaAsset,
  type Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import type { ContentPostRenderView } from "@/lib/contracts/content-post-render";
import { isProviderBillingError } from "@/lib/providers/provider-billing-error";
import { ShuyuApiError } from "@/lib/providers/shuyu";
import {
  ShuyuPlanUnavailableError,
  type AuditedShuyuImagePlan,
  type ShuyuResolution,
} from "@/lib/providers/shuyu-catalog";
import {
  fetchShuyuOutputImage,
  pollShuyuImageTask,
  resolveShuyuImagePlanForAspect,
  submitShuyuImageTask,
  type ShuyuImageAspectRatio,
} from "@/lib/providers/shuyu-image-provider";
import { recordAIUsage } from "@/lib/services/ai-usage-log-service";
import {
  ContentPostRenderError,
  RENDER_LOCK_TTL_MS,
  hardenImagePrompt,
  mergeRenderedUrls,
  missingSlideIndexes,
} from "@/lib/services/content-post-render-service";
import {
  CANCELLED_RENDER_RUN_PREFIX,
  LIVE_CONTENT_POST_IMAGE_STATUSES,
  buildContentPostRenderView,
  contentPostSlidePrompts,
  currentTasksBySlide,
  isCancelledRenderRun,
  isImagePostFormat,
  isContentPostRendering,
} from "@/lib/services/content-post-render-state";
import { createOwnedMediaAsset } from "@/lib/services/media-asset-service";
import { getStorageProvider } from "@/lib/storage";
import { asProviderSubmissionError } from "@/lib/video-generation/providers/submission-error";

/**
 * C2 · 图文帖（单图 / 轮播）配图走 Shuyu 异步出图。
 *
 * 为什么不是同步：OpenAI 账户没额度，周计划的图文全挂；Shuyu 卖 Image 2 出图，但是异步的——
 * 提交后要轮询好几分钟。请求里同步等既等不起（路由上限 300 秒），等超时还会把花过钱的图丢掉。
 * 所以这里是一条带租约的异步作业线（对照 storyboard-service）：
 *
 *   start（POST）  拿渲染锁 → 限流一次 → 解析一次套餐 → 每张缺图建一个任务 → 最多 3 张在途提交 → 202
 *   reconcile（GET）/ poll（cron） 对账在途任务 → 成功就落 blob + MediaAsset，再在锁住帖子行的事务里
 *                  按位置并进 renderedImageUrls → 有空位就补提交 → 这一轮全部终态时收尾
 *   收尾           每张都在且仍是同一轮的草稿 → READY（CAS）；否则留在草稿、写人话原因、放锁
 *   cancel         没提交的那几张在一个事务里取消，已提交的照常收回（素材保留），这一轮不再能 READY
 *
 * 「出图中」不加新的帖子状态：= DRAFT + renderStartedAt（口径在 content-post-render-state）。
 * 计费口径不变（PRD 决策 4）：出图才计费、失败零计费；取消、弃用永远免费。
 * 同步 OpenAI 线路（content-post-render-service.renderContentPost）原样保留做回滚，
 * 用 CONTENT_POST_IMAGE_PROVIDER=openai 切回；删除它另起 PR（铁律 8）。
 */

export const CONTENT_POST_IMAGE_PROMPT_VERSION = "content-post-shuyu-v1";
/// 同一条帖子同时在 Shuyu 侧生成的张数上限（轮播最多 6 屏，分两拨提交）。
export const CONTENT_POST_IMAGE_MAX_IN_FLIGHT = 3;
/// 单次提交（一次 POST）的确认等待上限。
export const CONTENT_POST_IMAGE_SUBMIT_TIMEOUT_MS = 20_000;
/// 卡在「提交中」超过这个时长 = 进程在提交半途没了：结局不可知，按 ACK_UNKNOWN 终结。
export const CONTENT_POST_IMAGE_SUBMIT_STALL_MS = 2 * 60_000;
/// Shuyu 明确没建任务（含 429 限流、「线路繁忙，积分已退回」）时，用同一个 key 自动重投的次数上限。
export const CONTENT_POST_IMAGE_MAX_AUTO_RESUBMITS = 3;
const RESUBMIT_BACKOFF_MS = [15_000, 45_000, 120_000] as const;
/// 无任务号的 ACK_UNKNOWN：同一轮里每张只自动换新 attempt 重投一次，且只救 30 分钟内的（storyboard 同一规则）。
export const CONTENT_POST_IMAGE_ACK_UNKNOWN_RETRY_WINDOW_MS = 30 * 60_000;
const ACK_UNKNOWN_RETRY_DELAY_MS = 20_000;
const LEASE_MS = 2 * 60_000;
/// 同一张图两次查 Shuyu 状态的最小间隔：前端每 2.5 秒拉一次，不能每次都打供应商。
const POLL_INTERVAL_MS = 8_000;
const POLL_ERROR_BACKOFF_MS = 20_000;
/// 提交后超过这个时长还没终态：停止等待（退款状态未知，不自动重出）。Shuyu 出图通常几分钟，
/// 半小时还不出就别让这一张一直占着这条帖子（占着就开不了下一轮）。
export const CONTENT_POST_IMAGE_PROCESSING_TIMEOUT_MS = 30 * 60_000;
/// 刚拿到锁、任务还没建好的那一小段：收尾不要把它当成「一轮已结束」。
const ROUND_SETUP_GRACE_MS = 2 * 60_000;
/// 一次 cron 推进图文出图的时间预算（路由上限 300 秒，与视频 / 产品图 / 故事板轮询并发跑）。
export const CONTENT_POST_IMAGE_CRON_BUDGET_MS = 150_000;
/// 每轮按 1K 解析（目录里 1K 下线时 selectAuditedImage2Plan 自动升档，不会降档）。
const CONTENT_POST_IMAGE_RESOLUTION: ShuyuResolution = "1K";
/**
 * 画幅偏好：社媒竖版 2:3（与同步线路的 1024x1536、成品库 2:3 画框一致）。
 * 目录里没有任何档位声明 2:3 时，按顺序退到最接近的竖版画幅（画框按 cover 裁切），
 * 而不是让整条线路停摆；实际提交的画幅写在任务行 aspectRatio 上。
 */
export const CONTENT_POST_IMAGE_ASPECT_PREFERENCE: readonly ShuyuImageAspectRatio[] = [
  "2:3",
  "3:4",
  "4:5",
  "9:16",
];

const PROVIDER_UNAVAILABLE_MESSAGE =
  "配图服务暂时不可用：AI 出图服务正在恢复，我们已在处理。已出的图都保留着，恢复后再点一次即可。";
const SLIDE_UNAVAILABLE_NOTE = "出图服务暂时不可用（账户或套餐问题），这一张没有提交，不产生费用。";
const ACK_UNKNOWN_NOTE =
  "这一张的提交结果未知，系统会自动按新的尝试再出一次；其余几张不受影响。";
const ACK_KNOWN_NOTE = "这一张已被服务商接收，系统会自动核对进度，不会重复提交。";
const RESUBMIT_NOTE = "服务商这次没有接单（没有扣费），系统会用同一个请求号自动再提交。";
const REJECTED_NOTE = "服务商连续几次都没有接这一张（都没有扣费），已停止自动重试；可以点「补齐配图」再试。";
const INVALID_REQUEST_NOTE = "这一张的出图提示词不符合服务商要求，自动重试也不会成功；请重新排一条。";
const PLAN_WITHDRAWN_NOTE =
  "服务商刚调整了出图套餐，这一张没有提交成功（没有扣费）；过几分钟点「补齐配图」会按新套餐重出。";
/// Shuyu 下线 / 轮换套餐时提交被拒的错误 type（0728 真机：400 model_unavailable）。按同一份快照重投必然再被拒。
const PLAN_WITHDRAWN_CODES = /model_unavailable|plan_unavailable|plan_not_found/i;
const CANCELLED_NOTE = "已停止出图：这一张还没提交给服务商，不产生费用。";
const DISCARDED_NOTE = "这条内容已弃用：这一张还没提交给服务商，不产生费用。";
const ACCOUNT_DISABLED_NOTE = "账号已停用：这一张还没提交给服务商，不产生费用。";
const ORPHAN_NOTE = "这一轮出图已经结束：这一张没有提交，不产生费用。";

type TaskRow = ContentPostImageTask;

interface ContentPostImageJobDependencies {
  db: typeof db;
  now: () => Date;
  resolvePlan: typeof resolveShuyuImagePlanForAspect;
  submitTask: typeof submitShuyuImageTask;
  pollTask: typeof pollShuyuImageTask;
  fetchOutput: typeof fetchShuyuOutputImage;
  storage: typeof getStorageProvider;
  createAsset: typeof createOwnedMediaAsset;
  recordUsage: typeof recordAIUsage;
  newId: () => string;
}

const defaultDependencies: ContentPostImageJobDependencies = {
  db,
  now: () => new Date(),
  resolvePlan: resolveShuyuImagePlanForAspect,
  submitTask: submitShuyuImageTask,
  pollTask: pollShuyuImageTask,
  fetchOutput: fetchShuyuOutputImage,
  storage: getStorageProvider,
  createAsset: createOwnedMediaAsset,
  recordUsage: recordAIUsage,
  newId: () => randomUUID(),
};
let dependencyOverride: Partial<ContentPostImageJobDependencies> | null = null;
function runtime(): ContentPostImageJobDependencies {
  return { ...defaultDependencies, ...dependencyOverride };
}

/* ── 线路开关 ─────────────────────────────────────────────────────── */

export type ContentPostImageProvider = "shuyu" | "openai";

/**
 * 图文配图走哪条线路。默认 Shuyu（异步）；`CONTENT_POST_IMAGE_PROVIDER=openai` 切回今天的同步
 * gpt-image 线路（回滚用，代码原样保留）。不认识的值按默认处理。
 */
export function contentPostImageProvider(
  env: Record<string, string | undefined> = process.env,
): ContentPostImageProvider {
  return env.CONTENT_POST_IMAGE_PROVIDER?.trim().toLowerCase() === "openai" ? "openai" : "shuyu";
}

/* ── 小工具 ───────────────────────────────────────────────────────── */

export function contentPostImageRequestKey(postId: string, slideIndex: number, attempt: number): string {
  return `content-post:${postId}:s${slideIndex}:a${attempt}`;
}

class RenderRoundLostError extends Error {
  constructor() {
    super("Content post render round changed underneath this request");
    this.name = "RenderRoundLostError";
  }
}

class ContentPostImageLeaseLostError extends Error {
  constructor() {
    super("Content post image task lease was lost");
    this.name = "ContentPostImageLeaseLostError";
  }
}

function isLive(status: ContentPostImageStatus | string): boolean {
  return (LIVE_CONTENT_POST_IMAGE_STATUSES as string[]).includes(status);
}

function roundIdOf(renderRunId: string | null): string | null {
  if (!renderRunId) return null;
  return isCancelledRenderRun(renderRunId)
    ? renderRunId.slice(CANCELLED_RENDER_RUN_PREFIX.length)
    : renderRunId;
}

function humanSlideList(indexes: readonly number[]): string {
  return [...indexes].sort((a, b) => a - b).map((index) => index + 1).join("、");
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

/** 锁住帖子行：并进图 URL、建任务、取消、算在途配额都在它下面串行，两张同时出完也不会互相覆盖。 */
async function lockPostRow(tx: Prisma.TransactionClient, postId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "ContentPost" WHERE "id" = ${postId} FOR UPDATE`;
  return rows.length === 1;
}

function planSnapshotOf(task: TaskRow): AuditedShuyuImagePlan | undefined {
  if (!task.planId || !task.modelSnapshot || !task.resolutionSnapshot || task.pointsSnapshot === null) {
    return undefined;
  }
  return {
    planId: task.planId,
    model: task.modelSnapshot,
    resolution: task.resolutionSnapshot as ShuyuResolution,
    points: task.pointsSnapshot,
    family: "gpt-image-2",
  };
}

function shuyuNotConfigured(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof ShuyuApiError && current.code === "not_configured") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * 缺的这一屏能不能开一次新的（计费的）尝试：
 * - 从没提交 / Shuyu 明确没建任务 / 回执未知且没有任务号（storyboard 同一规则：唯一出路是新 key）→ 能；
 * - Shuyu 那边有任务号：只有供应商确认退款（refunded）才能再出，否则可能重复扣费 → 不能，人工核对。
 */
export function canStartNewContentPostImageAttempt(task: Pick<
  TaskRow,
  "status" | "externalTaskId" | "lastProviderStatus"
>): boolean {
  if (isLive(task.status)) return false;
  if (task.status === ContentPostImageStatus.SUCCEEDED || task.status === ContentPostImageStatus.CANCELLED) {
    return true;
  }
  if (!task.externalTaskId) return true;
  return task.lastProviderStatus === "refunded";
}

/* ── 读 ───────────────────────────────────────────────────────────── */

const postSelect = {
  id: true,
  planId: true,
  format: true,
  status: true,
  imagePrompt: true,
  slidesJson: true,
  renderedImageUrls: true,
  renderError: true,
  renderStartedAt: true,
  renderRunId: true,
} as const;

type PostRow = Prisma.ContentPostGetPayload<{ select: typeof postSelect }>;

async function loadOwnedPost(
  deps: ContentPostImageJobDependencies,
  args: { userId: string; planId?: string; postId: string },
): Promise<PostRow | null> {
  return deps.db.contentPost.findFirst({
    /// owner 校验放进查询条件，不靠调用方记得比对。
    where: {
      id: args.postId,
      ...(args.planId ? { planId: args.planId } : {}),
      plan: { userId: args.userId },
    },
    select: postSelect,
  });
}

async function loadTasks(deps: ContentPostImageJobDependencies, postId: string): Promise<TaskRow[]> {
  return deps.db.contentPostImageTask.findMany({
    where: { postId },
    orderBy: [{ slideIndex: "asc" }, { attempt: "asc" }],
  });
}

async function readView(deps: ContentPostImageJobDependencies, postId: string): Promise<ContentPostRenderView> {
  const post = await deps.db.contentPost.findFirst({ where: { id: postId }, select: postSelect });
  if (!post) throw new ContentPostRenderError("找不到这条内容", "not_found");
  const tasks = await loadTasks(deps, postId);
  return buildContentPostRenderView({ post, tasks, now: deps.now() });
}

/**
 * 本周内容页（server component）一次读出多条帖子的出图视图：刷新页面后能接着显示进度、接着轮询。
 * 只读不推进（推进由前端轮询 GET 与 cron 负责），越权的 id 直接读不到。
 */
export async function loadContentPostRenderViews(
  userId: string,
  postIds: readonly string[],
): Promise<Map<string, ContentPostRenderView>> {
  const deps = runtime();
  const views = new Map<string, ContentPostRenderView>();
  if (postIds.length === 0) return views;
  const posts = await deps.db.contentPost.findMany({
    where: { id: { in: [...postIds] }, plan: { userId } },
    select: postSelect,
  });
  const imagePosts = posts.filter((post) => isImagePostFormat(post.format));
  if (imagePosts.length === 0) return views;
  const tasks = await deps.db.contentPostImageTask.findMany({
    where: { postId: { in: imagePosts.map((post) => post.id) } },
  });
  const now = deps.now();
  for (const post of imagePosts) {
    views.set(
      post.id,
      buildContentPostRenderView({ post, tasks: tasks.filter((task) => task.postId === post.id), now }),
    );
  }
  return views;
}

/* ── 开一轮 ───────────────────────────────────────────────────────── */

async function resolveRoundPlan(
  deps: ContentPostImageJobDependencies,
): Promise<{ plan: AuditedShuyuImagePlan; aspectRatio: ShuyuImageAspectRatio }> {
  let lastError: unknown = null;
  for (const aspectRatio of CONTENT_POST_IMAGE_ASPECT_PREFERENCE) {
    try {
      const plan = await deps.resolvePlan({ resolution: CONTENT_POST_IMAGE_RESOLUTION, aspectRatio });
      return { plan, aspectRatio };
    } catch (error) {
      lastError = error;
      /// 只有「没有支持这个画幅的档位」才换下一个画幅；账户 / 网络故障换画幅也没用。
      if (!(error instanceof ShuyuPlanUnavailableError)) break;
    }
  }
  console.error("[content-post-images] Shuyu plan resolution failed", { error: errorText(lastError) });
  if (lastError instanceof ShuyuPlanUnavailableError || isProviderBillingError(lastError)) {
    throw new ContentPostRenderError(PROVIDER_UNAVAILABLE_MESSAGE, "provider_unavailable");
  }
  throw new ContentPostRenderError("出图服务暂时连不上，请稍后再点一次；已出的图都保留着。", "provider");
}

async function promoteCompletedDraft(deps: ContentPostImageJobDependencies, postId: string): Promise<void> {
  const now = deps.now();
  await deps.db.contentPost.updateMany({
    where: {
      id: postId,
      status: "DRAFT",
      OR: [
        { renderStartedAt: null },
        { renderStartedAt: { lt: new Date(now.getTime() - RENDER_LOCK_TTL_MS) } },
      ],
      imageTasks: { none: { status: { in: LIVE_CONTENT_POST_IMAGE_STATUSES } } },
    },
    data: { status: "READY", renderError: null, renderStartedAt: null },
  });
}

async function releaseRenderLock(
  deps: ContentPostImageJobDependencies,
  postId: string,
  renderRunId: string,
  lockedAt: Date,
  renderError: string | null,
): Promise<void> {
  await deps.db.contentPost.updateMany({
    /// 开轮期间被「停止出图」改写成墓碑的也是这一轮的锁，一并放掉。
    where: {
      id: postId,
      renderRunId: { in: [renderRunId, `${CANCELLED_RENDER_RUN_PREFIX}${renderRunId}`] },
      renderStartedAt: lockedAt,
    },
    data: { renderStartedAt: null, ...(renderError ? { renderError } : {}) },
  });
}

/**
 * 开始（或补齐）一轮出图。
 *
 * - 已出齐：不花钱，草稿顺手补成 READY；
 * - 这条正在出图（锁未过期，或还有没结束的任务）：原样返回当前进度——双击 / 两个标签页不会重复提交；
 * - 否则拿渲染锁（过期锁只有在没有任何没结束的任务时才能接管），限流计一次，解析一次套餐，
 *   每张缺图建一个任务（新 attempt、新 key），最多 3 张在途提交，返回带每屏状态的视图。
 */
export async function startContentPostRender(args: {
  userId: string;
  planId: string;
  postId: string;
  /** 拿到渲染锁、确认这一轮真要出图之后调用一次（路由在这里按用户限流）；抛错会释放锁并原样上抛。 */
  beforeRender?: () => Promise<void>;
}): Promise<ContentPostRenderView> {
  const deps = runtime();
  const post = await loadOwnedPost(deps, args);
  if (!post) throw new ContentPostRenderError("找不到这条内容", "not_found");
  if (!isImagePostFormat(post.format)) {
    throw new ContentPostRenderError("只有单图帖和轮播需要出图", "wrong_format");
  }
  if (post.status === "DISCARDED") {
    throw new ContentPostRenderError(
      "这条内容已取消，已出的图都保留着；需要的话请重新排一条",
      "discarded",
    );
  }
  const prompts = contentPostSlidePrompts(post);
  if (prompts.length === 0) {
    throw new ContentPostRenderError("这条内容没有可用的出图提示词", "no_prompt");
  }
  const missing = missingSlideIndexes(prompts.length, post.renderedImageUrls);
  /// 每屏都已出过图：重复点「生成配图」不重复扣费。
  if (missing.length === 0) {
    if (post.status === "DRAFT") await promoteCompletedDraft(deps, post.id);
    return readView(deps, post.id);
  }

  const tasks = await loadTasks(deps, post.id);
  const liveCount = tasks.filter((task) => isLive(task.status)).length;
  if (isContentPostRendering(post, liveCount, deps.now())) {
    /// 已经在出图：幂等返回当前进度，不再提交任何一张。
    return readView(deps, post.id);
  }

  const current = currentTasksBySlide(tasks);
  const blocked = missing.filter((index) => {
    const task = current.get(index);
    return task !== undefined && !canStartNewContentPostImageAttempt(task);
  });
  const toRender = missing.filter((index) => !blocked.includes(index));
  if (toRender.length === 0) {
    throw new ContentPostRenderError(
      `第 ${humanSlideList(blocked)} 张上次没有出成，服务商还没确认退款；为避免重复扣费，系统不会自动重出。已出的图都保留着，请联系我们核对后再补齐。`,
      "billing_review",
    );
  }

  /// 套餐每轮解析一次（不花钱、5 分钟缓存）；放在拿锁之前，解析失败什么都不用回滚。
  const round = await resolveRoundPlan(deps);

  const lockedAt = deps.now();
  const runId = deps.newId();
  const lock = await deps.db.contentPost.updateMany({
    where: {
      id: post.id,
      plan: { userId: args.userId },
      status: "DRAFT",
      OR: [
        { renderStartedAt: null },
        { renderStartedAt: { lt: new Date(lockedAt.getTime() - RENDER_LOCK_TTL_MS) } },
      ],
      /// 过期锁的接管还要求没有任何没结束的任务：慢的一轮（Shuyu 排队）不会被并发请求「接管」后重出。
      imageTasks: { none: { status: { in: LIVE_CONTENT_POST_IMAGE_STATUSES } } },
    },
    data: { renderStartedAt: lockedAt, renderRunId: runId, renderError: null },
  });
  if (lock.count !== 1) {
    const latest = await loadOwnedPost(deps, args);
    if (!latest) throw new ContentPostRenderError("找不到这条内容", "not_found");
    if (latest.status === "DISCARDED") {
      throw new ContentPostRenderError(
        "这条内容已取消，已出的图都保留着；需要的话请重新排一条",
        "discarded",
      );
    }
    const view = await readView(deps, latest.id);
    if (view.state === "ready" || view.state === "rendering" || view.state === "stopping") return view;
    throw new ContentPostRenderError("这条内容正在出图，请稍候刷新查看", "in_progress");
  }

  try {
    await args.beforeRender?.();
  } catch (error) {
    await releaseRenderLock(deps, post.id, runId, lockedAt, null);
    throw error;
  }

  let created = 0;
  try {
    created = await deps.db.$transaction(async (tx) => {
      await lockPostRow(tx, post.id);
      const owned = await tx.contentPost.findFirst({
        where: { id: post.id },
        select: { status: true, renderRunId: true, renderStartedAt: true, renderedImageUrls: true },
      });
      if (
        !owned ||
        owned.status !== "DRAFT" ||
        owned.renderRunId !== runId ||
        owned.renderStartedAt?.getTime() !== lockedAt.getTime()
      ) {
        throw new RenderRoundLostError();
      }
      /// 行锁下再看一眼：拿锁前那一刻之后补上的屏不再出（不花冤枉钱）。
      const stillMissing = toRender.filter((index) => !owned.renderedImageUrls[index]?.trim());
      const existing = await tx.contentPostImageTask.findMany({
        where: { postId: post.id },
        select: { slideIndex: true, attempt: true },
      });
      for (const slideIndex of stillMissing) {
        const attempt =
          Math.max(0, ...existing.filter((task) => task.slideIndex === slideIndex).map((task) => task.attempt)) + 1;
        await tx.contentPostImageTask.updateMany({
          where: { postId: post.id, slideIndex, isCurrent: true },
          data: { isCurrent: false },
        });
        await tx.contentPostImageTask.create({
          data: {
            postId: post.id,
            userId: args.userId,
            renderRunId: runId,
            slideIndex,
            attempt,
            isCurrent: true,
            prompt: hardenImagePrompt(prompts[slideIndex]!),
            aspectRatio: round.aspectRatio,
            status: ContentPostImageStatus.QUEUED,
            providerRequestKey: contentPostImageRequestKey(post.id, slideIndex, attempt),
            submissionState: ProviderSubmissionState.NOT_STARTED,
            provider: "shuyu",
            planId: round.plan.planId,
            modelSnapshot: round.plan.model,
            resolutionSnapshot: round.plan.resolution,
            pointsSnapshot: round.plan.points,
          },
        });
      }
      return stillMissing.length;
    });
  } catch (error) {
    await releaseRenderLock(
      deps,
      post.id,
      runId,
      lockedAt,
      error instanceof RenderRoundLostError ? null : "出图没有开始（没有提交、不产生费用），请再点一次。",
    ).catch(() => undefined);
    if (error instanceof RenderRoundLostError) {
      throw new ContentPostRenderError("这条内容正在出图，请稍候刷新查看", "in_progress");
    }
    throw error;
  }
  if (created === 0) {
    /// 缺的屏在拿锁前后被补齐了：这一轮什么都不用出，放锁；真的每屏都齐了才顺手补成 READY。
    await releaseRenderLock(deps, post.id, runId, lockedAt, null);
    const latest = await readView(deps, post.id);
    if (latest.done < latest.total) return latest;
    await promoteCompletedDraft(deps, post.id);
    return readView(deps, post.id);
  }

  await pumpSubmissions(deps, post.id);
  /// 一张都没提交出去就结束了（例如账户故障）：当场收尾，商家马上看到原因，不用等轮询。
  await finalizeIfSettled(deps, post.id);
  return readView(deps, post.id);
}

/* ── 提交 ─────────────────────────────────────────────────────────── */

async function cancelQueuedTasks(
  client: Pick<Prisma.TransactionClient, "contentPostImageTask">,
  where: Prisma.ContentPostImageTaskWhereInput,
  note: string,
  now: Date,
): Promise<number> {
  const cancelled = await client.contentPostImageTask.updateMany({
    where: { ...where, status: ContentPostImageStatus.QUEUED },
    data: {
      status: ContentPostImageStatus.CANCELLED,
      availableAt: null,
      completedAt: now,
      errorCode: "RUN_CANCELLED",
      errorMessage: note,
    },
  });
  return cancelled.count;
}

/**
 * 把排队的任务提交出去，同一条帖子最多 CONTENT_POST_IMAGE_MAX_IN_FLIGHT 张在途。
 * 认领在锁住帖子行的事务里完成（在途配额不会被两个并发的推进各算一遍），网络提交在事务外并发。
 */
async function pumpSubmissions(deps: ContentPostImageJobDependencies, postId: string): Promise<void> {
  /// 前端每 2.5 秒拉一次：没有排队的张就别开事务、别碰行锁。
  const queued = await deps.db.contentPostImageTask.findFirst({
    where: { postId, status: ContentPostImageStatus.QUEUED },
    select: { id: true },
  });
  if (!queued) return;
  const claimed = await deps.db.$transaction(async (tx) => {
    if (!(await lockPostRow(tx, postId))) return [] as string[];
    const post = await tx.contentPost.findFirst({
      where: { id: postId },
      select: {
        status: true,
        renderRunId: true,
        renderStartedAt: true,
        plan: { select: { user: { select: { disabledAt: true } } } },
      },
    });
    if (!post) return [] as string[];
    const now = deps.now();
    if (post.status === "DISCARDED") {
      await cancelQueuedTasks(tx, { postId }, DISCARDED_NOTE, now);
      return [] as string[];
    }
    if (post.plan.user.disabledAt) {
      await cancelQueuedTasks(tx, { postId }, ACCOUNT_DISABLED_NOTE, now);
      return [] as string[];
    }
    if (isCancelledRenderRun(post.renderRunId)) {
      await cancelQueuedTasks(tx, { postId }, CANCELLED_NOTE, now);
      return [] as string[];
    }
    if (post.status !== "DRAFT" || !post.renderRunId || !post.renderStartedAt) {
      await cancelQueuedTasks(tx, { postId }, ORPHAN_NOTE, now);
      return [] as string[];
    }
    /// 不属于当前这一轮的排队任务（理论上不该有）：不提交，取消掉让这一轮能收尾。
    await cancelQueuedTasks(tx, { postId, renderRunId: { not: post.renderRunId } }, ORPHAN_NOTE, now);
    const tasks = await tx.contentPostImageTask.findMany({
      where: { postId, status: { in: LIVE_CONTENT_POST_IMAGE_STATUSES } },
      orderBy: { slideIndex: "asc" },
    });
    const capacity =
      CONTENT_POST_IMAGE_MAX_IN_FLIGHT -
      tasks.filter((task) => task.status === ContentPostImageStatus.PROCESSING).length;
    if (capacity <= 0) return [] as string[];
    const ready = tasks
      .filter(
        (task) =>
          task.status === ContentPostImageStatus.QUEUED &&
          task.renderRunId === post.renderRunId &&
          (task.availableAt === null || task.availableAt.getTime() <= now.getTime()),
      )
      .slice(0, capacity);
    const ids: string[] = [];
    for (const task of ready) {
      const won = await tx.contentPostImageTask.updateMany({
        where: {
          id: task.id,
          status: ContentPostImageStatus.QUEUED,
          submissionState: {
            in: [ProviderSubmissionState.NOT_STARTED, ProviderSubmissionState.REJECTED],
          },
        },
        data: {
          status: ContentPostImageStatus.PROCESSING,
          submissionState: ProviderSubmissionState.SUBMITTING,
          submittedAt: now,
          submitAttempts: { increment: 1 },
          availableAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (won.count === 1) ids.push(task.id);
    }
    return ids;
  });
  await Promise.allSettled(claimed.map((taskId) => submitClaimedTask(deps, taskId)));
}

async function acceptSubmission(
  deps: ContentPostImageJobDependencies,
  task: TaskRow,
  externalTaskId: string,
): Promise<boolean> {
  const now = deps.now();
  const accepted = await deps.db.contentPostImageTask.updateMany({
    where: {
      id: task.id,
      providerRequestKey: task.providerRequestKey,
      submissionState: ProviderSubmissionState.SUBMITTING,
    },
    data: {
      externalTaskId,
      status: ContentPostImageStatus.PROCESSING,
      submissionState: ProviderSubmissionState.ACCEPTED,
      lastProviderStatus: "queued",
      lastCheckedAt: now,
      availableAt: new Date(now.getTime() + POLL_INTERVAL_MS),
      pollErrors: 0,
    },
  });
  if (accepted.count === 1) return true;
  /// 提交慢到被「卡在提交中」清扫判成 ACK_UNKNOWN 之后才拿到任务号：号已知，复活回对账轨道。
  const revived = await deps.db.contentPostImageTask.updateMany({
    where: {
      id: task.id,
      providerRequestKey: task.providerRequestKey,
      submissionState: ProviderSubmissionState.ACK_UNKNOWN,
      externalTaskId: null,
    },
    data: {
      externalTaskId,
      status: ContentPostImageStatus.PROCESSING,
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      lastProviderStatus: "queued",
      lastCheckedAt: now,
      availableAt: new Date(now.getTime() + POLL_INTERVAL_MS),
      pollErrors: 0,
    },
  });
  return revived.count === 1;
}

async function submitClaimedTask(deps: ContentPostImageJobDependencies, taskId: string): Promise<void> {
  const task = await deps.db.contentPostImageTask.findFirst({ where: { id: taskId } });
  if (!task || task.submissionState !== ProviderSubmissionState.SUBMITTING) return;
  /// 合作方一旦回了任务号，提交就已确认；之后任何本地失败都不能把这张归为「确认未知」。
  let acknowledged: string | null = null;
  try {
    const submitted = await deps.submitTask({
      requestKey: task.providerRequestKey,
      prompt: task.prompt,
      aspectRatio: task.aspectRatio as ShuyuImageAspectRatio,
      resolution: (task.resolutionSnapshot ?? CONTENT_POST_IMAGE_RESOLUTION) as ShuyuResolution,
      planSnapshot: planSnapshotOf(task),
      timeoutMs: CONTENT_POST_IMAGE_SUBMIT_TIMEOUT_MS,
    });
    acknowledged = submitted.externalTaskId;
    if (!(await acceptSubmission(deps, task, acknowledged))) throw new ContentPostImageLeaseLostError();
  } catch (error) {
    if (acknowledged && !(error instanceof ContentPostImageLeaseLostError)) {
      /// 提交已确认、只是落库瞬时失败：再写一次就能救回真实任务。
      const recovered = await acceptSubmission(deps, task, acknowledged).catch(() => false);
      if (recovered) return;
    }
    await recordSubmissionFailure(deps, task, error, acknowledged).catch((persistError) => {
      console.error("[content-post-images] could not persist submission failure", {
        taskId: task.id,
        error: errorText(persistError),
      });
    });
  }
}

async function recordSubmissionFailure(
  deps: ContentPostImageJobDependencies,
  task: TaskRow,
  error: unknown,
  acknowledged: string | null,
): Promise<void> {
  const now = deps.now();
  const whereSubmitting = {
    id: task.id,
    providerRequestKey: task.providerRequestKey,
    submissionState: ProviderSubmissionState.SUBMITTING,
  };
  if (acknowledged) {
    /// 任务号已知：继续按它对账（成了就收、败了按退款语义落地），绝不重投。
    await deps.db.contentPostImageTask.updateMany({
      where: whereSubmitting,
      data: {
        externalTaskId: acknowledged,
        status: ContentPostImageStatus.PROCESSING,
        submissionState: ProviderSubmissionState.ACK_UNKNOWN,
        lastCheckedAt: now,
        availableAt: new Date(now.getTime() + POLL_INTERVAL_MS),
        errorCode: "SUBMISSION_ACK_UNKNOWN",
        errorMessage: ACK_KNOWN_NOTE,
      },
    });
    return;
  }
  const failure = asProviderSubmissionError({ error, providerId: "shuyu" });
  /// 没配 key：请求根本没发出去（适配层把它包成 transport，这里按「确定没建任务」处理）。
  const notConfigured = shuyuNotConfigured(error);
  if (failure.disposition === "acknowledgement_unknown" && !notConfigured) {
    await deps.db.contentPostImageTask.updateMany({
      where: whereSubmitting,
      data: {
        status: ContentPostImageStatus.FAILED,
        submissionState: ProviderSubmissionState.ACK_UNKNOWN,
        completedAt: now,
        errorCode: "SUBMISSION_ACK_UNKNOWN",
        errorMessage: ACK_UNKNOWN_NOTE,
      },
    });
    return;
  }
  const accountDown = notConfigured || isProviderBillingError(failure) || isProviderBillingError(error);
  const planWithdrawn = !accountDown && PLAN_WITHDRAWN_CODES.test(failure.code ?? "");
  if (accountDown || planWithdrawn) {
    /// 账户层故障（401/402/403、没配 key）或套餐刚被下线：按同一份请求重试必然再失败——
    /// 这一张和同一轮还没提交的几张都停下（都没扣费），说人话。
    const errorCode = accountDown ? "PROVIDER_UNAVAILABLE" : "PLAN_WITHDRAWN";
    const errorMessage = accountDown ? SLIDE_UNAVAILABLE_NOTE : PLAN_WITHDRAWN_NOTE;
    await deps.db.$transaction(async (tx) => {
      await tx.contentPostImageTask.updateMany({
        where: whereSubmitting,
        data: {
          status: ContentPostImageStatus.FAILED,
          submissionState: ProviderSubmissionState.REJECTED,
          completedAt: now,
          errorCode,
          errorMessage,
        },
      });
      await tx.contentPostImageTask.updateMany({
        where: {
          postId: task.postId,
          renderRunId: task.renderRunId,
          status: ContentPostImageStatus.QUEUED,
        },
        data: {
          status: ContentPostImageStatus.FAILED,
          availableAt: null,
          completedAt: now,
          errorCode,
          errorMessage,
        },
      });
    });
    return;
  }
  if (failure.stage === "preflight" && !failure.retryable) {
    await deps.db.contentPostImageTask.updateMany({
      where: whereSubmitting,
      data: {
        status: ContentPostImageStatus.FAILED,
        submissionState: ProviderSubmissionState.REJECTED,
        completedAt: now,
        errorCode: "REQUEST_INVALID",
        errorMessage: INVALID_REQUEST_NOTE,
      },
    });
    return;
  }
  /// Shuyu 明确没建任务（4xx / 429 / 「积分已退回」）：同一个 key 退避后自动重投，最多 3 次。
  const resubmitsUsed = task.submitAttempts - 1;
  if (resubmitsUsed < CONTENT_POST_IMAGE_MAX_AUTO_RESUBMITS) {
    const backoff = RESUBMIT_BACKOFF_MS[Math.min(resubmitsUsed, RESUBMIT_BACKOFF_MS.length - 1)]!;
    await deps.db.contentPostImageTask.updateMany({
      where: whereSubmitting,
      data: {
        status: ContentPostImageStatus.QUEUED,
        submissionState: ProviderSubmissionState.REJECTED,
        availableAt: new Date(now.getTime() + backoff),
        errorCode: "PROVIDER_REJECTED_RETRYING",
        errorMessage: RESUBMIT_NOTE,
      },
    });
    return;
  }
  await deps.db.contentPostImageTask.updateMany({
    where: whereSubmitting,
    data: {
      status: ContentPostImageStatus.FAILED,
      submissionState: ProviderSubmissionState.REJECTED,
      completedAt: now,
      errorCode: "PROVIDER_REJECTED",
      errorMessage: REJECTED_NOTE,
    },
  });
}

/* ── 对账 ─────────────────────────────────────────────────────────── */

async function failStalledSubmissions(deps: ContentPostImageJobDependencies, postId: string): Promise<void> {
  const now = deps.now();
  const stalled = await deps.db.contentPostImageTask.findMany({
    where: {
      postId,
      status: ContentPostImageStatus.PROCESSING,
      submissionState: ProviderSubmissionState.SUBMITTING,
      submittedAt: { lt: new Date(now.getTime() - CONTENT_POST_IMAGE_SUBMIT_STALL_MS) },
    },
    select: { id: true, submittedAt: true },
  });
  for (const task of stalled) {
    await deps.db.contentPostImageTask.updateMany({
      where: {
        id: task.id,
        submissionState: ProviderSubmissionState.SUBMITTING,
        submittedAt: task.submittedAt,
      },
      data: {
        status: ContentPostImageStatus.FAILED,
        submissionState: ProviderSubmissionState.ACK_UNKNOWN,
        completedAt: now,
        errorCode: "SUBMISSION_ACK_UNKNOWN",
        errorMessage: ACK_UNKNOWN_NOTE,
      },
    });
  }
}

async function claimPollLease(
  deps: ContentPostImageJobDependencies,
  taskId: string,
  leaseOwner: string,
): Promise<TaskRow | null> {
  const now = deps.now();
  const claimed = await deps.db.contentPostImageTask.updateMany({
    where: {
      id: taskId,
      status: ContentPostImageStatus.PROCESSING,
      submissionState: {
        in: [ProviderSubmissionState.ACCEPTED, ProviderSubmissionState.ACK_UNKNOWN],
      },
      externalTaskId: { not: null },
      AND: [
        { OR: [{ availableAt: null }, { availableAt: { lte: now } }] },
        { OR: [{ leaseOwner: null }, { leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
      ],
    },
    data: { leaseOwner, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count !== 1) return null;
  return deps.db.contentPostImageTask.findFirst({ where: { id: taskId, leaseOwner } });
}

function heldLease(leaseOwner: string, now: Date) {
  return {
    leaseOwner,
    leaseExpiresAt: { gt: now },
    status: ContentPostImageStatus.PROCESSING,
  };
}

async function recordImageUsage(
  deps: ContentPostImageJobDependencies,
  task: TaskRow,
  status: "SUCCESS" | "FAILED",
  errorMessage?: string,
): Promise<void> {
  await deps
    .recordUsage({
      feature: "content_post_image",
      provider: "shuyu",
      model: task.modelSnapshot ?? "shuyu-image-2",
      actorUserId: task.userId,
      inputSummary: `${task.aspectRatio}/${task.resolutionSnapshot ?? "?"}/slide-${task.slideIndex}/attempt-${task.attempt}`,
      outputSummary: `contentPostId=${task.postId};taskId=${task.id};planId=${task.planId ?? "?"};points=${task.pointsSnapshot ?? "?"}`,
      promptVersion: CONTENT_POST_IMAGE_PROMPT_VERSION,
      status,
      errorMessage,
    })
    .catch(() => undefined);
}

function extensionForImageMime(mimeType: string): "png" | "jpg" | "webp" {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

/** 成功：先落 blob + MediaAsset，再在锁住帖子行的事务里标成功并按位置并进帖子。 */
async function harvestTaskOutput(
  deps: ContentPostImageJobDependencies,
  task: TaskRow,
  leaseOwner: string,
  result: Awaited<ReturnType<typeof pollShuyuImageTask>>,
): Promise<void> {
  const outputUrl = result.outputUrls[0];
  if (!outputUrl) throw new Error("Shuyu content-post image completed without an output");
  const generated = await deps.fetchOutput(outputUrl);
  const storage = deps.storage();
  if (!storage.isConfigured()) throw new Error("图文配图存储暂不可用");
  const key = `content-posts/${task.userId}/${task.postId}/slide-${task.slideIndex}-attempt-${task.attempt}-${deps.newId()}.${extensionForImageMime(generated.mimeType)}`;
  const object = await storage.uploadBuffer("renders", generated.bytes, {
    key,
    contentType: generated.mimeType,
    access: "public",
    overwrite: false,
  });
  let asset: MediaAsset | null = null;
  try {
    asset = await deps.createAsset({
      userId: task.userId,
      storageKey: object.key,
      url: object.url,
      mimeType: generated.mimeType,
      bytes: generated.bytes,
    });
    const stored = asset;
    await deps.db.$transaction(async (tx) => {
      await lockPostRow(tx, task.postId);
      const now = deps.now();
      const finished = await tx.contentPostImageTask.updateMany({
        where: { id: task.id, ...heldLease(leaseOwner, now) },
        data: {
          status: ContentPostImageStatus.SUCCEEDED,
          outputUrl: stored.url,
          outputAssetId: stored.id,
          lastProviderStatus: result.rawStatus,
          lastCheckedAt: now,
          completedAt: now,
          pollErrors: 0,
          errorCode: null,
          errorMessage: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (finished.count !== 1) throw new ContentPostImageLeaseLostError();
      const post = await tx.contentPost.findFirst({
        where: { id: task.postId },
        select: { renderedImageUrls: true },
      });
      if (!post) throw new Error("content post vanished while harvesting its image");
      /// 帖子行已锁：读到的是最新的 URL 列表，按位置并进去不会覆盖同时出完的另一张。
      /// 这一格已经有图（理论上不会）就保留原图——新图照样留在任务行与 MediaAsset 里。
      if (!post.renderedImageUrls[task.slideIndex]?.trim()) {
        await tx.contentPost.updateMany({
          where: { id: task.postId },
          data: {
            renderedImageUrls: mergeRenderedUrls(
              post.renderedImageUrls,
              new Map([[task.slideIndex, stored.url]]),
            ),
            renderedAt: now,
          },
        });
      }
    });
  } catch (error) {
    if (asset) {
      const removed = await deps.db.mediaAsset
        .deleteMany({ where: { id: asset.id, contentPostImageTasks: { none: {} } } })
        .catch(() => ({ count: 0 }));
      if (removed.count === 1) await storage.deleteObject("renders", object.key).catch(() => undefined);
    } else {
      await storage.deleteObject("renders", object.key).catch(() => undefined);
    }
    throw error;
  }
  await recordImageUsage(deps, task, "SUCCESS");
}

async function pollInFlightTask(deps: ContentPostImageJobDependencies, taskId: string): Promise<void> {
  const leaseOwner = deps.newId();
  const task = await claimPollLease(deps, taskId, leaseOwner);
  if (!task?.externalTaskId) return;
  /// 先问供应商再判超时：刚好在超时边上出完的图（花过钱的）必须收回来，不能没问就判死。
  const timedOut = (at: Date) =>
    task.submittedAt !== null &&
    at.getTime() - task.submittedAt.getTime() > CONTENT_POST_IMAGE_PROCESSING_TIMEOUT_MS;
  const giveUp = async (at: Date) => {
    await deps.db.contentPostImageTask.updateMany({
      where: { id: task.id, ...heldLease(leaseOwner, at) },
      data: {
        status: ContentPostImageStatus.FAILED,
        completedAt: at,
        errorCode: "PROVIDER_TIMEOUT",
        errorMessage:
          "这一张等了半个小时还没出来，已停止等待；服务商还没给结果，为避免重复扣费不会自动重出，请联系我们核对。",
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  };
  let result: Awaited<ReturnType<typeof pollShuyuImageTask>>;
  try {
    result = await deps.pollTask(task.externalTaskId);
  } catch {
    const now = deps.now();
    if (timedOut(now)) {
      await giveUp(now);
      return;
    }
    await deps.db.contentPostImageTask.updateMany({
      where: { id: task.id, leaseOwner, status: ContentPostImageStatus.PROCESSING },
      data: {
        pollErrors: { increment: 1 },
        lastCheckedAt: now,
        availableAt: new Date(now.getTime() + POLL_ERROR_BACKOFF_MS),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return;
  }
  const now = deps.now();
  if (result.status === "queued" || result.status === "processing") {
    if (timedOut(now)) {
      await giveUp(now);
      return;
    }
    await deps.db.contentPostImageTask.updateMany({
      where: { id: task.id, ...heldLease(leaseOwner, now) },
      data: {
        lastProviderStatus: result.rawStatus,
        lastCheckedAt: now,
        pollErrors: 0,
        availableAt: new Date(now.getTime() + POLL_INTERVAL_MS),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return;
  }
  if (result.status === "failed") {
    const refunded = result.rawStatus === "refunded";
    const refundError = result.rawStatus === "refund_error";
    const failed = await deps.db.contentPostImageTask.updateMany({
      where: { id: task.id, ...heldLease(leaseOwner, now) },
      data: {
        status: ContentPostImageStatus.FAILED,
        lastProviderStatus: result.rawStatus,
        lastCheckedAt: now,
        completedAt: now,
        errorCode: refundError ? "PROVIDER_REFUND_ERROR" : refunded ? "PROVIDER_REFUNDED" : "PROVIDER_FAILED",
        errorMessage: refundError
          ? "服务商这张没出成，而且退款状态异常；为避免重复扣费不会自动重出，请联系我们核对。"
          : refunded
            ? "服务商这张没出成，已退还积分；点「补齐配图」可以重出这一张。"
            : "服务商这张没出成，退款状态还没确认；为避免重复扣费不会自动重出，请联系我们核对。",
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    if (failed.count === 1) await recordImageUsage(deps, task, "FAILED", `shuyu:${result.rawStatus}`);
    return;
  }
  await harvestTaskOutput(deps, task, leaseOwner, result);
}

/**
 * 无任务号的 ACK_UNKNOWN：同一轮里每张自动换新 attempt（新 key）重投一次，且只救 30 分钟内的。
 * 唯一安全出路就是显式计费的新尝试，重复扣费敞口以一张图为上限（storyboard 同一规则）。
 */
async function retryAckUnknownSlides(deps: ContentPostImageJobDependencies, postId: string): Promise<void> {
  const now = deps.now();
  const tasks = await loadTasks(deps, postId);
  const candidates = tasks.filter(
    (task) =>
      task.isCurrent &&
      task.status === ContentPostImageStatus.FAILED &&
      task.submissionState === ProviderSubmissionState.ACK_UNKNOWN &&
      task.externalTaskId === null &&
      task.completedAt !== null &&
      now.getTime() - task.completedAt.getTime() <= CONTENT_POST_IMAGE_ACK_UNKNOWN_RETRY_WINDOW_MS &&
      /// 同一轮这一张的第一次尝试才自动重投（重投出来的那次再未知，就停下等商家）。
      tasks.filter((other) => other.slideIndex === task.slideIndex && other.renderRunId === task.renderRunId)
        .length === 1,
  );
  if (candidates.length === 0) return;
  await deps.db.$transaction(async (tx) => {
    await lockPostRow(tx, postId);
    const post = await tx.contentPost.findFirst({
      where: { id: postId },
      select: { status: true, renderRunId: true, renderStartedAt: true },
    });
    if (
      !post ||
      post.status !== "DRAFT" ||
      !post.renderStartedAt ||
      !post.renderRunId ||
      isCancelledRenderRun(post.renderRunId)
    ) {
      return;
    }
    for (const task of candidates) {
      if (task.renderRunId !== post.renderRunId) continue;
      const demoted = await tx.contentPostImageTask.updateMany({
        where: {
          id: task.id,
          isCurrent: true,
          status: ContentPostImageStatus.FAILED,
          submissionState: ProviderSubmissionState.ACK_UNKNOWN,
          externalTaskId: null,
        },
        data: { isCurrent: false },
      });
      if (demoted.count !== 1) continue;
      const attempt = task.attempt + 1;
      await tx.contentPostImageTask.create({
        data: {
          postId,
          userId: task.userId,
          renderRunId: post.renderRunId,
          slideIndex: task.slideIndex,
          attempt,
          isCurrent: true,
          prompt: task.prompt,
          aspectRatio: task.aspectRatio,
          status: ContentPostImageStatus.QUEUED,
          providerRequestKey: contentPostImageRequestKey(postId, task.slideIndex, attempt),
          submissionState: ProviderSubmissionState.NOT_STARTED,
          provider: task.provider,
          planId: task.planId,
          modelSnapshot: task.modelSnapshot,
          resolutionSnapshot: task.resolutionSnapshot,
          pointsSnapshot: task.pointsSnapshot,
          availableAt: new Date(now.getTime() + ACK_UNKNOWN_RETRY_DELAY_MS),
        },
      });
    }
  });
}

/* ── 收尾 ─────────────────────────────────────────────────────────── */

function roundOutcomeMessage(
  missing: readonly number[],
  current: Map<number, TaskRow>,
  cancelled: boolean,
): string {
  if (cancelled) {
    return "已停止出图：已提交的几张照常收回，已出的图都保留着；需要时点「补齐配图」继续出剩下的。";
  }
  const unavailable: number[] = [];
  const withdrawn: number[] = [];
  const invalid: number[] = [];
  const unknown: number[] = [];
  const retryable: number[] = [];
  const blocked: number[] = [];
  for (const index of missing) {
    const task = current.get(index);
    if (task?.errorCode === "PROVIDER_UNAVAILABLE") unavailable.push(index);
    else if (task?.errorCode === "PLAN_WITHDRAWN") withdrawn.push(index);
    else if (task?.errorCode === "REQUEST_INVALID") invalid.push(index);
    else if (task?.submissionState === ProviderSubmissionState.ACK_UNKNOWN && !task.externalTaskId) unknown.push(index);
    else if (!task || canStartNewContentPostImageAttempt(task)) retryable.push(index);
    else blocked.push(index);
  }
  if (unavailable.length > 0) return PROVIDER_UNAVAILABLE_MESSAGE;
  const parts: string[] = [];
  if (retryable.length > 0) parts.push(`第 ${humanSlideList(retryable)} 张没有出成（服务商没有扣费或已退款）`);
  if (withdrawn.length > 0) {
    parts.push(`第 ${humanSlideList(withdrawn)} 张没提交成功：服务商刚调整了出图套餐（没有扣费），过几分钟再补`);
  }
  if (unknown.length > 0) parts.push(`第 ${humanSlideList(unknown)} 张提交后没拿到服务商回执，已自动重试过一次`);
  if (blocked.length > 0) {
    parts.push(`第 ${humanSlideList(blocked)} 张没有出成、服务商还没确认退款，为避免重复扣费不会自动重出，请联系我们核对`);
  }
  if (invalid.length > 0) parts.push(`第 ${humanSlideList(invalid)} 张的出图提示词不符合要求，建议重新排一条`);
  const tail = retryable.length + unknown.length + withdrawn.length > 0 ? "，点「补齐配图」只补缺的那几张" : "";
  return `${parts.join("；")}。已出的图都保留着${tail}。`;
}

/**
 * 这一轮的任务全部终态时收尾（幂等，可被 start / GET / cron 任意一方调用）：
 * - 每张都在、仍是草稿、仍是同一轮（没被停止）→ READY（CAS：草稿 + 轮次号 + 锁值）；
 * - 否则留在草稿，写一句人话原因（缺哪几张、能不能补、要不要找我们），放锁；
 *   「补齐配图」再点一次只补缺的那几张。
 */
async function finalizeIfSettled(deps: ContentPostImageJobDependencies, postId: string): Promise<void> {
  /// 快速判断在事务外做（大多数推进都还有在途任务）；真正收尾在锁住帖子行的事务里重读——
  /// 收图事务拿的是同一把锁，不会出现「读帖子时还缺这张、读任务时它已成功」的错判。
  const peek = await deps.db.contentPost.findFirst({
    where: { id: postId },
    select: { renderStartedAt: true, renderRunId: true },
  });
  if (!peek?.renderStartedAt || !peek.renderRunId) return;
  await deps.db.$transaction(async (tx) => {
    await lockPostRow(tx, postId);
    await finalizeLocked(deps, tx, postId);
  });
}

async function finalizeLocked(
  deps: ContentPostImageJobDependencies,
  tx: Prisma.TransactionClient,
  postId: string,
): Promise<void> {
  const post = await tx.contentPost.findFirst({ where: { id: postId }, select: postSelect });
  /// 没有锁、或锁属于同步回滚线路（没有轮次号）：不归这里管。
  if (!post?.renderStartedAt || !post.renderRunId) return;
  const tasks = await tx.contentPostImageTask.findMany({
    where: { postId },
    orderBy: [{ slideIndex: "asc" }, { attempt: "asc" }],
  });
  if (tasks.some((task) => isLive(task.status))) return;
  const now = deps.now();
  const roundId = roundIdOf(post.renderRunId);
  const roundTasks = tasks.filter((task) => task.renderRunId === roundId);
  if (roundTasks.length === 0 && now.getTime() - post.renderStartedAt.getTime() < ROUND_SETUP_GRACE_MS) {
    return;
  }
  const cancelled = isCancelledRenderRun(post.renderRunId);
  const current = currentTasksBySlide(tasks);
  const ackRetryPending = [...current.values()].some(
    (task) =>
      !cancelled &&
      task.renderRunId === roundId &&
      task.status === ContentPostImageStatus.FAILED &&
      task.submissionState === ProviderSubmissionState.ACK_UNKNOWN &&
      task.externalTaskId === null &&
      task.completedAt !== null &&
      now.getTime() - task.completedAt.getTime() <= CONTENT_POST_IMAGE_ACK_UNKNOWN_RETRY_WINDOW_MS &&
      tasks.filter((other) => other.slideIndex === task.slideIndex && other.renderRunId === roundId).length === 1,
  );
  /// 还欠一次自动重投（retryAckUnknownSlides 马上会建）：先别收尾。
  if (ackRetryPending && post.status === "DRAFT") return;
  const prompts = contentPostSlidePrompts(post);
  const missing = missingSlideIndexes(prompts.length, post.renderedImageUrls);
  if (missing.length === 0 && !cancelled && post.status === "DRAFT") {
    /// READY 的语义是「可以交给青砚发布」：只许「同一轮的草稿 → READY」，被停止 / 弃用的不复活。
    const completed = await tx.contentPost.updateMany({
      where: {
        id: post.id,
        status: "DRAFT",
        renderRunId: post.renderRunId,
        renderStartedAt: post.renderStartedAt,
      },
      data: { status: "READY", renderedAt: now, renderError: null, renderStartedAt: null },
    });
    if (completed.count === 1) return;
  }
  await tx.contentPost.updateMany({
    where: { id: post.id, renderRunId: post.renderRunId, renderStartedAt: post.renderStartedAt },
    data: {
      renderStartedAt: null,
      ...(post.status === "DRAFT"
        ? { renderError: missing.length > 0 || cancelled ? roundOutcomeMessage(missing, current, cancelled) : null }
        : {}),
    },
  });
}

/* ── 推进 / 对账入口 ──────────────────────────────────────────────── */

/**
 * 推进一条帖子的这一轮出图：清扫卡住的提交 → 对账在途任务（成功就收图）→ 补自动重投 →
 * 有空位就补提交 → 全部终态就收尾。每一步都是 CAS / 租约，GET、cron 与发起请求并发调用也安全。
 */
export async function advanceContentPostRender(postId: string): Promise<void> {
  await advance(runtime(), postId);
}

async function advance(deps: ContentPostImageJobDependencies, postId: string): Promise<void> {
  /// 没有在出图的帖子（没有异步线路的锁、也没有没结束的任务）：什么都不做，不碰行锁。
  const [lock, live] = await Promise.all([
    deps.db.contentPost.findFirst({
      where: { id: postId },
      select: { renderStartedAt: true, renderRunId: true },
    }),
    deps.db.contentPostImageTask.findFirst({
      where: { postId, status: { in: LIVE_CONTENT_POST_IMAGE_STATUSES } },
      select: { id: true },
    }),
  ]);
  if (!lock || (!live && !(lock.renderStartedAt && lock.renderRunId))) return;
  await failStalledSubmissions(deps, postId);
  const inFlight = await deps.db.contentPostImageTask.findMany({
    where: {
      postId,
      status: ContentPostImageStatus.PROCESSING,
      externalTaskId: { not: null },
      submissionState: {
        in: [ProviderSubmissionState.ACCEPTED, ProviderSubmissionState.ACK_UNKNOWN],
      },
    },
    select: { id: true },
  });
  await Promise.allSettled(
    inFlight.map((task) =>
      pollInFlightTask(deps, task.id).catch((error) => {
        /// 一张收图失败（存储 / 下载）不挡其他张；租约过期后下一次推进会重试。
        console.error("[content-post-images] task reconcile failed", { taskId: task.id, error: errorText(error) });
      }),
    ),
  );
  await retryAckUnknownSlides(deps, postId);
  await pumpSubmissions(deps, postId);
  await finalizeIfSettled(deps, postId);
}

/** GET：读时对账（与产品图 GET 同一个套路），返回带每屏状态的视图。 */
export async function reconcileContentPostRender(args: {
  userId: string;
  planId: string;
  postId: string;
}): Promise<ContentPostRenderView> {
  const deps = runtime();
  const post = await loadOwnedPost(deps, args);
  if (!post) throw new ContentPostRenderError("找不到这条内容", "not_found");
  try {
    await advance(deps, post.id);
  } catch (error) {
    /// 推进失败不影响读：已落库的进度照样返回，下一次轮询再推进。
    console.error("[content-post-images] reconcile failed", { postId: post.id, error: errorText(error) });
  }
  return readView(deps, post.id);
}

/**
 * cron（/api/cron/poll-videos）：推进还有没结束任务的帖子，以及任务都终态、锁还没放的一轮。
 * 按任务的 updatedAt 轮转（每次对账都会刷新它），一批最多 limit 条帖子。返回推进的条数。
 */
export async function pollPendingContentPostRenders(limit = 20): Promise<number> {
  const deps = runtime();
  const take = Math.max(1, Math.min(limit, 50));
  const now = deps.now();
  const [due, unsettled] = await Promise.all([
    deps.db.contentPostImageTask.findMany({
      where: {
        status: { in: LIVE_CONTENT_POST_IMAGE_STATUSES },
        OR: [{ availableAt: null }, { availableAt: { lte: now } }],
      },
      orderBy: { updatedAt: "asc" },
      take: take * 4,
      select: { postId: true },
    }),
    deps.db.contentPost.findMany({
      where: {
        renderRunId: { not: null },
        renderStartedAt: { not: null },
        imageTasks: { none: { status: { in: LIVE_CONTENT_POST_IMAGE_STATUSES } } },
      },
      orderBy: { renderStartedAt: "asc" },
      take,
      select: { id: true },
    }),
  ]);
  const postIds = [...new Set([...due.map((task) => task.postId), ...unsettled.map((post) => post.id)])].slice(0, take);
  let advanced = 0;
  const startedAt = Date.now();
  for (const postId of postIds) {
    /// cron 上限 300 秒：被平台中途杀掉的提交会变成「回执未知」再换新 key 重投（可能重复扣费），
    /// 所以留足余量，超过预算就把剩下的留给下一分钟。
    if (Date.now() - startedAt > CONTENT_POST_IMAGE_CRON_BUDGET_MS) break;
    try {
      await advance(deps, postId);
      advanced += 1;
    } catch (error) {
      console.error("[content-post-images] poll failed", { postId, error: errorText(error) });
    }
  }
  return advanced;
}

/* ── 取消 ─────────────────────────────────────────────────────────── */

/**
 * 「停止出图」（铁律 7：每一轮都能取消，取消清运行态、保留素材）。
 *
 * - 还没提交的那几张在同一个事务里落成 CANCELLED（从没提交、不产生费用）；
 * - 已提交的照常对账、收图、并进帖子——花过钱的图不能丢；
 * - 轮次号改写成墓碑：这一轮从此不能变 READY；帖子留在草稿，已提交的收完就放锁；
 * - 重复点幂等：没有在出图时直接返回当前视图。
 */
export async function cancelContentPostRender(args: {
  userId: string;
  planId: string;
  postId: string;
}): Promise<ContentPostRenderView> {
  const deps = runtime();
  const post = await loadOwnedPost(deps, args);
  if (!post) throw new ContentPostRenderError("找不到这条内容", "not_found");
  await deps.db.$transaction(async (tx) => {
    await lockPostRow(tx, post.id);
    const live = await tx.contentPost.findFirst({
      where: { id: post.id },
      select: { renderRunId: true, renderStartedAt: true },
    });
    if (!live) return;
    if (live.renderRunId && live.renderStartedAt && !isCancelledRenderRun(live.renderRunId)) {
      await tx.contentPost.updateMany({
        where: { id: post.id, renderRunId: live.renderRunId },
        data: { renderRunId: `${CANCELLED_RENDER_RUN_PREFIX}${live.renderRunId}` },
      });
    }
    await cancelQueuedTasks(tx, { postId: post.id }, CANCELLED_NOTE, deps.now());
  });
  /// 没有在途的张：当场收尾放锁；有在途的，收完由 GET / cron 收尾。
  await finalizeIfSettled(deps, post.id);
  return readView(deps, post.id);
}

/**
 * 弃用这条帖子（DELETE）时一并取消还没提交的那几张：原有的弃用语义不变（只改状态、保留素材），
 * 已提交的照常收回。返回取消的张数。
 */
export async function cancelUnsubmittedContentPostImages(args: {
  userId: string;
  postId: string;
}): Promise<number> {
  const deps = runtime();
  const post = await loadOwnedPost(deps, args);
  if (!post) return 0;
  const cancelled = await deps.db.$transaction(async (tx) => {
    await lockPostRow(tx, post.id);
    return cancelQueuedTasks(tx, { postId: post.id }, DISCARDED_NOTE, deps.now());
  });
  await finalizeIfSettled(deps, post.id);
  return cancelled;
}

export const __test__ = {
  setDependencies(override: Partial<ContentPostImageJobDependencies> | null) {
    dependencyOverride = override;
  },
  roundOutcomeMessage,
  finalizeIfSettled: (postId: string) => finalizeIfSettled(runtime(), postId),
  pumpSubmissions: (postId: string) => pumpSubmissions(runtime(), postId),
  RESUBMIT_BACKOFF_MS,
  POLL_INTERVAL_MS,
};
