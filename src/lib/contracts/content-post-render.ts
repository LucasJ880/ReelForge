/**
 * C2 · 图文帖出图（Shuyu 异步）的对外视图契约。
 *
 * 服务端（content-post-image-job-service / 本周内容页）拼好，经 GET/POST 响应或 server component
 * 原样交给浏览器。纯类型 + 纯函数，不引任何模块：'use client' 组件可以安全 import。
 */

/** 一屏配图的状态（StatusTick 的 slide 实体同一套词位，missing = 还没有任何任务）。 */
export type ContentPostSlideState =
  | "done"
  | "queued"
  | "generating"
  | "failed"
  | "cancelled"
  | "missing";

/**
 * 一条帖子的出图状态。
 * - rendering：这一轮正在出图（DRAFT + 渲染锁）；
 * - stopping：商家点了「停止出图」，没提交的已取消，已提交的几张还在收回；
 * - idle：没有在出图（可能缺图、带 renderError）；ready / discarded 与帖子状态一致。
 */
export type ContentPostRenderState =
  | "idle"
  | "rendering"
  | "stopping"
  | "ready"
  | "discarded";

export interface ContentPostSlideView {
  index: number;
  state: ContentPostSlideState;
  /** 这一屏已落库的图（renderedImageUrls 对应位置）；没有就是 null。 */
  imageUrl: string | null;
  /** 失败 / 取消时这一屏的人话原因（服务端文案）。 */
  note: string | null;
}

export interface ContentPostRenderView {
  postId: string;
  status: "DRAFT" | "READY" | "DISCARDED";
  state: ContentPostRenderState;
  /** 应出的屏数（单图 1，轮播按分屏数）；纯文案 / 视频帖为 0。 */
  total: number;
  /** 已落库的屏数。 */
  done: number;
  /** 已提交给供应商、还在生成的屏数（停止出图后要收回的就是这几张）。 */
  inFlight: number;
  /** 按位置的配图 URL，空位是 ""（与 ContentPost.renderedImageUrls 同形）。 */
  renderedImageUrls: string[];
  renderError: string | null;
  slides: ContentPostSlideView[];
  /** 服务端是否接受「停止出图」。 */
  canStop: boolean;
}

/** 正在出图（含停止后收回中）：前端据此轮询。 */
export function isContentPostRenderActive(
  view: Pick<ContentPostRenderView, "state"> | null | undefined,
): boolean {
  return view?.state === "rendering" || view?.state === "stopping";
}
