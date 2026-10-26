import {
  publicVideoRouteOptionsResponseSchema,
  type PublicVideoRouteOption,
} from "@/lib/contracts/video-route-options";
import {
  defaultAuditedShuyuVideoPlan,
  resolveShuyuVideoPlans,
  shuyuVideoPlanPointsForDuration,
  SHUYU_VIDEO_MODEL,
  SHUYU_VIDEO_PLAN_LIST_MAX,
  SHUYU_VIDEO_RESOLUTION,
  type AuditedShuyuVideoPlan,
  type ShuyuFetchOptions,
} from "@/lib/providers/shuyu";
import {
  getShuyuRouteRuntimeAvailability,
  type ShuyuRouteRuntimeAvailability,
} from "@/lib/video-generation/shuyu-runtime";
import type { z } from "zod";

export type PublicVideoRouteOptionsResponse = z.infer<
  typeof publicVideoRouteOptionsResponseSchema
>;

/**
 * GET /api/video-generation/routes 的业务层(路由只做鉴权)。
 *
 * P03-A1:final 档(1080P)客户定价未定,对客户不可见、不可选——只有内部员工
 * (与 requireOperator 同口径:SUPER_ADMIN / OPERATOR)能在清单里看到它。
 * 默认档与预检成本永远取 draft 档首位(最便宜的 720P),员工与客户一致;
 * 价目表只剩 final 时默认档为空,与 runtime 探针的 price_contract_mismatch 同口径。
 * 客户绕过清单显式传 final planId,由 resolveShuyuVideoPlan 的 allowFinal 闸门拒绝。
 */
export function visibleShuyuVideoPlans(args: {
  internalStaff: boolean;
  auditedPlans: ReadonlyArray<AuditedShuyuVideoPlan>;
}): AuditedShuyuVideoPlan[] {
  const visible = args.internalStaff
    ? [...args.auditedPlans]
    : args.auditedPlans.filter((plan) => plan.tier === "draft");
  return visible.slice(0, SHUYU_VIDEO_PLAN_LIST_MAX);
}

export function buildPublicVideoRouteOptions(args: {
  internalStaff: boolean;
  auditedPlans: ReadonlyArray<AuditedShuyuVideoPlan>;
  availability: ShuyuRouteRuntimeAvailability;
}): PublicVideoRouteOptionsResponse {
  const plans = visibleShuyuVideoPlans(args);
  const defaultPlan = defaultAuditedShuyuVideoPlan(plans);
  const route: PublicVideoRouteOption = {
    id: "buddy",
    provider: "shuyu",
    /// 显示名按默认档位出,不再写死 720P(1080P 入族后仍以默认档为准)。
    displayName: `Aivora 视频通道 · Seedance ${defaultPlan?.resolution ?? SHUYU_VIDEO_RESOLUTION}`,
    model: defaultPlan?.model ?? SHUYU_VIDEO_MODEL,
    resolution: defaultPlan?.resolution ?? SHUYU_VIDEO_RESOLUTION,
    configured: args.availability.configured,
    funded: args.availability.funded,
    available: args.availability.available,
    unavailableReason: args.availability.reason,
    plans: plans.map((plan) => ({
      planId: plan.planId,
      displayName: plan.displayName,
      resolution: plan.resolution,
      tier: plan.tier,
      billingUnit: plan.billingUnit,
      unitSalePoints: plan.unitSalePoints,
      pointsPer15s: shuyuVideoPlanPointsForDuration(plan, 15),
      isDefault: defaultPlan !== undefined && plan.planId === defaultPlan.planId,
    })),
  };
  return publicVideoRouteOptionsResponseSchema.parse({
    ok: true,
    defaultRouteId: "buddy",
    routes: [route],
  });
}

/** 清单与可用性同源(/prices 60s 缓存);清单为空时线路探针给出 price_contract_mismatch。 */
export async function loadPublicVideoRouteOptions(
  args: { internalStaff: boolean } & ShuyuFetchOptions,
): Promise<PublicVideoRouteOptionsResponse> {
  const fetchOptions: ShuyuFetchOptions = {
    ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
    ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
    ...(args.env ? { env: args.env } : {}),
  };
  const auditedPlans = await resolveShuyuVideoPlans(fetchOptions).catch(() => []);
  /// 预检成本按默认档(draft 首位)算,员工与客户都是同一个 720P 套餐。
  const defaultPlan = defaultAuditedShuyuVideoPlan(auditedPlans);
  const availability = await getShuyuRouteRuntimeAvailability({
    ...fetchOptions,
    requiredPoints: defaultPlan
      ? shuyuVideoPlanPointsForDuration(defaultPlan, 15)
      : undefined,
  });
  return buildPublicVideoRouteOptions({
    internalStaff: args.internalStaff,
    auditedPlans,
    availability,
  });
}
