import { SHUYU_VIDEO_POINTS_PER_GENERATION } from "@/lib/providers/shuyu";
import type { VideoRouteId } from "./video-route-registry";

/**
 * 每条线路的单条成片计价快照（PRD C1 的成本维度）。
 *
 * 为什么不放进 video-route-registry：registry 只描述线路身份，且它的契约被
 * `deepEqual` 逐字段锁死。计价会随合作方调价而变，属于另一件事。
 *
 * 为什么可以用常量而不是每次调 /prices：`isAuditedShuyuVideoPlan` 已经把
 * `sale_points === 900` 写成审计通过的必要条件 —— 合作方一旦调价，审计检查
 * 立刻失败并阻断这条线路，不会出现「按 900 计价却实际扣了别的分」的静默漂移。
 *
 * byteplus 系线路按供应商美元计价、不走积分，这里返回 null；它们的成本快照
 * 应该落在 providerUnitPriceUsd 上（尚未接入），不做隐式换算。
 */
const UNIT_POINTS: Record<VideoRouteId, number | null> = {
  buddy: SHUYU_VIDEO_POINTS_PER_GENERATION,
  byteplus_international: null,
  volcengine_cn_legacy: null,
  mock: 0,
};

export function videoRouteUnitPoints(routeId: string): number | null {
  return UNIT_POINTS[routeId as VideoRouteId] ?? null;
}

/**
 * 供 videoJob.create 直接展开：拿不到计价时返回空对象，
 * 让该列保持 null，而不是写一个假的 0 污染成本统计。
 */
export function videoRouteCostSnapshot(routeId: string): {
  providerUnitPoints?: number;
} {
  const points = videoRouteUnitPoints(routeId);
  return points === null ? {} : { providerUnitPoints: points };
}
