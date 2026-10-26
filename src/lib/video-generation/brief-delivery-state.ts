import { VideoBriefStatus } from "@prisma/client";

/**
 * 「已交付」的 brief 状态：QA 已通过 / 待发布 / 已发布（及其后的指标采集与评分）。
 *
 * P05-B 只重拼（换字幕样式 / 配乐）会让 FinalVideo 再走一遍 READY → PENDING → STITCHING → READY，
 * 但这些 brief 不能因此被打回 QA_PENDING 或 RENDERING：成片一直都在（失败会回滚到旧片），
 * 已经通过审核 / 已发布的事实也没有变。stitch-service 的 markBriefReady 与
 * video-service 的 onAllSegmentsSucceeded 共用这一份判定。
 */
export const DELIVERED_BRIEF_STATUSES: ReadonlySet<VideoBriefStatus> = new Set([
  VideoBriefStatus.QA_APPROVED,
  VideoBriefStatus.PUBLISH_PENDING,
  VideoBriefStatus.PUBLISHED,
  VideoBriefStatus.METRICS_COLLECTING,
  VideoBriefStatus.SCORED,
]);

export function isDeliveredBriefStatus(
  status: VideoBriefStatus | string | null | undefined,
): boolean {
  return Boolean(status) && DELIVERED_BRIEF_STATUSES.has(status as VideoBriefStatus);
}
