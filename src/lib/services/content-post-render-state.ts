import { ContentPostImageStatus, type Prisma } from "@prisma/client";
import type {
  ContentPostRenderState,
  ContentPostRenderView,
  ContentPostSlideState,
  ContentPostSlideView,
} from "@/lib/contracts/content-post-render";
import {
  RENDER_LOCK_TTL_MS,
  missingSlideIndexes,
  readSlides,
} from "@/lib/services/content-post-render-service";

/**
 * C2 · 图文帖「是不是正在出图」的唯一口径（服务端纯函数 + Prisma where）。
 *
 * 「出图中」不是新的帖子状态：= DRAFT 且渲染锁 renderStartedAt 非空，并且
 *   锁还没过期（同步回滚线路在出图），或还有没结束的 Shuyu 任务（异步线路在出图 / 收回）。
 * 本周内容、成品库、「待出图」读数、出图服务都从这里取，口径不会各写各的。
 */

/** 还没结束的出图任务：排队等提交（含被拒后等自动重投）/ 已提交在生成。 */
export const LIVE_CONTENT_POST_IMAGE_STATUSES: ContentPostImageStatus[] = [
  ContentPostImageStatus.QUEUED,
  ContentPostImageStatus.PROCESSING,
];

/** 「停止出图」把 ContentPost.renderRunId 改写成墓碑：`cancelled:<轮次号>`。 */
export const CANCELLED_RENDER_RUN_PREFIX = "cancelled:";

export function isCancelledRenderRun(runId: string | null | undefined): boolean {
  return typeof runId === "string" && runId.startsWith(CANCELLED_RENDER_RUN_PREFIX);
}

export function isImagePostFormat(format: string): boolean {
  return format === "SINGLE_IMAGE" || format === "CAROUSEL";
}

/** 每一屏的出图提示词（顺序 = renderedImageUrls 的位置）；与同步线路同一套取法。 */
export function contentPostSlidePrompts(post: {
  format: string;
  imagePrompt: string | null;
  slidesJson: unknown;
}): string[] {
  if (post.format === "SINGLE_IMAGE") return post.imagePrompt ? [post.imagePrompt] : [];
  if (post.format === "CAROUSEL") return readSlides(post.slidesJson).map((slide) => slide.imagePrompt);
  return [];
}

/** Prisma where：这条帖子正在出图（见文件头口径）。「待出图」读数用 NOT 排除它。 */
export function contentPostRenderingWhere(now: Date): Prisma.ContentPostWhereInput {
  return {
    status: "DRAFT",
    renderStartedAt: { not: null },
    OR: [
      { renderStartedAt: { gte: new Date(now.getTime() - RENDER_LOCK_TTL_MS) } },
      { imageTasks: { some: { status: { in: LIVE_CONTENT_POST_IMAGE_STATUSES } } } },
    ],
  };
}

/** 同一口径的内存版（已经读出帖子与任务时用）。 */
export function isContentPostRendering(
  post: { status: string; renderStartedAt: Date | null },
  liveTaskCount: number,
  now: Date,
): boolean {
  if (post.status !== "DRAFT" || !post.renderStartedAt) return false;
  return liveTaskCount > 0 || now.getTime() - post.renderStartedAt.getTime() < RENDER_LOCK_TTL_MS;
}

export interface RenderViewPost {
  id: string;
  status: "DRAFT" | "READY" | "DISCARDED";
  format: string;
  imagePrompt: string | null;
  slidesJson: unknown;
  renderedImageUrls: string[];
  renderError: string | null;
  renderStartedAt: Date | null;
  renderRunId: string | null;
}

export interface RenderViewTask {
  slideIndex: number;
  attempt: number;
  isCurrent: boolean;
  status: ContentPostImageStatus | string;
  errorMessage: string | null;
}

const SLIDE_STATE: Record<string, ContentPostSlideState> = {
  QUEUED: "queued",
  PROCESSING: "generating",
  SUCCEEDED: "done",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

/** 每屏取「当前那次尝试」（isCurrent；并发残留时取 attempt 最大的）。 */
export function currentTasksBySlide<T extends { slideIndex: number; attempt: number; isCurrent: boolean }>(
  tasks: readonly T[],
): Map<number, T> {
  const current = new Map<number, T>();
  for (const task of tasks) {
    if (!task.isCurrent) continue;
    const seen = current.get(task.slideIndex);
    if (!seen || task.attempt > seen.attempt) current.set(task.slideIndex, task);
  }
  return current;
}

/** 帖子 + 它的出图任务 → 浏览器拿到的视图（纯函数）。 */
export function buildContentPostRenderView(input: {
  post: RenderViewPost;
  tasks: readonly RenderViewTask[];
  now: Date;
}): ContentPostRenderView {
  const { post, tasks, now } = input;
  const total = contentPostSlidePrompts(post).length;
  const current = currentTasksBySlide(tasks);
  const live = tasks.filter((task) =>
    (LIVE_CONTENT_POST_IMAGE_STATUSES as string[]).includes(task.status),
  );
  const slides: ContentPostSlideView[] = Array.from({ length: total }, (_, index) => {
    const url = post.renderedImageUrls[index]?.trim() ? post.renderedImageUrls[index] : null;
    if (url) return { index, state: "done", imageUrl: url, note: null };
    const task = current.get(index);
    const mapped = task ? (SLIDE_STATE[task.status] ?? "missing") : "missing";
    /// 任务成功但这一格是空的（数据漂移）：按缺图算，「补齐配图」能把它补上。
    const state: ContentPostSlideState = mapped === "done" ? "missing" : mapped;
    const note = state === "failed" || state === "cancelled" ? (task?.errorMessage ?? null) : null;
    return { index, state, imageUrl: null, note };
  });
  const done = total - missingSlideIndexes(total, post.renderedImageUrls).length;
  const rendering = isContentPostRendering(post, live.length, now);
  const state: ContentPostRenderState =
    post.status === "DISCARDED"
      ? "discarded"
      : post.status === "READY"
        ? "ready"
        : rendering
          ? isCancelledRenderRun(post.renderRunId)
            ? "stopping"
            : "rendering"
          : "idle";
  return {
    postId: post.id,
    status: post.status,
    state,
    total,
    done,
    inFlight: live.filter((task) => task.status === ContentPostImageStatus.PROCESSING).length,
    renderedImageUrls: post.renderedImageUrls,
    renderError: post.renderError,
    slides,
    /// 只有异步线路的一轮（有轮次号）能停；同步回滚线路是一次请求，停不下来。
    canStop: state === "rendering" && Boolean(post.renderRunId),
  };
}
