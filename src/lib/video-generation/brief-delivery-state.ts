import { VideoBriefStatus } from "@prisma/client";

/**
 * brief 状态分组（P05-B 只重拼与 markBriefReady 共用；#16 审查 item 6 改成白名单）。
 *
 * - 交付前渲染态：成片就位时**只有**这些状态才置 QA_PENDING + 建 QA 桩。
 * - 已交付：QA 已通过 / 待发布 / 已发布（及其后的指标采集与评分）。只重拼不打回 QA_PENDING /
 *   RENDERING，成片一直都在（失败会回滚到旧片），已通过审核 / 已发布的事实也没有变。
 * - 其它（BRIEF_PENDING / SCRIPT_* / SCENE_PROMPT_READY / ARCHIVED / DROPPED）：成片就位只刷新 URL，
 *   状态一律不动；也不允许只重拼。
 */
export const PRE_DELIVERY_RENDER_STATUSES: ReadonlySet<VideoBriefStatus> = new Set([
  VideoBriefStatus.RENDER_QUEUED,
  VideoBriefStatus.RENDERING,
  VideoBriefStatus.RENDER_SUCCEEDED,
  VideoBriefStatus.RENDER_FAILED,
  VideoBriefStatus.QA_PENDING,
  VideoBriefStatus.QA_REJECTED,
]);

export const DELIVERED_BRIEF_STATUSES: ReadonlySet<VideoBriefStatus> = new Set([
  VideoBriefStatus.QA_APPROVED,
  VideoBriefStatus.PUBLISH_PENDING,
  VideoBriefStatus.PUBLISHED,
  VideoBriefStatus.METRICS_COLLECTING,
  VideoBriefStatus.SCORED,
]);

export function isPreDeliveryBriefStatus(
  status: VideoBriefStatus | string | null | undefined,
): boolean {
  return Boolean(status) && PRE_DELIVERY_RENDER_STATUSES.has(status as VideoBriefStatus);
}

export function isDeliveredBriefStatus(
  status: VideoBriefStatus | string | null | undefined,
): boolean {
  return Boolean(status) && DELIVERED_BRIEF_STATUSES.has(status as VideoBriefStatus);
}

/** 只重拼放行的 brief 状态：交付前渲染态 + 已交付态；归档 / 弃用 / 更早阶段一律不许改成片。 */
export function canRestitchBriefStatus(
  status: VideoBriefStatus | string | null | undefined,
): boolean {
  return isPreDeliveryBriefStatus(status) || isDeliveredBriefStatus(status);
}
