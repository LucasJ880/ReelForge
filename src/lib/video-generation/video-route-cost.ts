import {
  resolveShuyuVideoPlan,
  shuyuVideoPlanPointsForDuration,
} from "@/lib/providers/shuyu";
import type { VideoRouteId } from "./video-route-registry";

/**
 * 每条线路的单条成片计价快照（PRD C1 的成本维度）。
 *
 * 为什么不放进 video-route-registry：registry 只描述线路身份，且它的契约被
 * `deepEqual` 逐字段锁死。计价会随合作方调价而变，属于另一件事。
 *
 * 2026-08-03 起 buddy 线路计价改为**实时解析**：合作方套餐 ID 与单价整体
 * 轮换（900 分/条下架、出现 700 分/条与按秒计费档），固定常量会把调价误判
 * 成停机或写错计价。快照价与提交用的是同一次审计解析（60s 缓存），
 * 解析失败时保持该列为 null，而不是写一个可能过期的旧价污染成本统计。
 *
 * byteplus 系线路按供应商美元计价、不走积分，这里返回 null；它们的成本快照
 * 应该落在 providerUnitPriceUsd 上（尚未接入），不做隐式换算。
 */
const STATIC_UNIT_POINTS: Record<VideoRouteId, number | null> = {
  buddy: null, // 动态解析，见 resolveVideoRouteUnitPoints
  byteplus_international: null,
  volcengine_cn_legacy: null,
  mock: 0,
};

export async function resolveVideoRouteUnitPoints(
  routeId: string,
  durationSec = 15,
  planId?: string | null,
): Promise<number | null> {
  if (routeId === "buddy") {
    try {
      const plan = await resolveShuyuVideoPlan({ planId: planId ?? null });
      return shuyuVideoPlanPointsForDuration(plan, durationSec);
    } catch {
      return null;
    }
  }
  return STATIC_UNIT_POINTS[routeId as VideoRouteId] ?? null;
}

/**
 * 供 videoJob.create 直接展开：拿不到计价时返回空对象，
 * 让该列保持 null，而不是写一个假的 0 污染成本统计。
 */
export async function resolveVideoRouteCostSnapshot(
  routeId: string,
  durationSec = 15,
  planId?: string | null,
): Promise<{ providerUnitPoints?: number }> {
  const points = await resolveVideoRouteUnitPoints(routeId, durationSec, planId);
  return points === null ? {} : { providerUnitPoints: points };
}
