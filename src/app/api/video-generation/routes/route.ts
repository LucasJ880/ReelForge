import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isInternalRole } from "@/lib/auth-role-policy";
import { publicVideoRouteOptionsResponseSchema } from "@/lib/contracts/video-route-options";
import {
  resolveShuyuVideoPlans,
  shuyuVideoPlanPointsForDuration,
  SHUYU_VIDEO_MODEL,
  SHUYU_VIDEO_RESOLUTION,
} from "@/lib/providers/shuyu";
import { getShuyuRouteRuntimeAvailability } from "@/lib/video-generation/shuyu-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authenticated, sanitized selector data. Raw provider balance is never sent. */
export async function GET(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  void req;
  /// 套餐清单与可用性同源(/prices 60s 缓存);清单为空时线路探针会给出
  /// price_contract_mismatch,这里不重复造原因。
  const auditedPlans = await resolveShuyuVideoPlans({ timeoutMs: 3_000 }).catch(
    () => [],
  );
  /// P03-A1:final 档(1080P)客户定价未定,对客户不可见、不可选——只有内部员工
  /// (与 requireOperator 同口径:SUPER_ADMIN / OPERATOR)能在清单里看到它。
  /// 客户绕过清单显式传 final planId,由 resolveShuyuVideoPlan 的 allowFinal 闸门拒绝。
  const internalStaff = isInternalRole(guard.session.user.role);
  const plans = internalStaff
    ? auditedPlans
    : auditedPlans.filter((plan) => plan.tier === "draft");
  /// 默认档 = 清单首位。排序保证 draft(最便宜的 720P)永远排在 final 之前,
  /// 所以员工与客户看到的默认档、以及这里的预检成本,都是同一个 720P 套餐。
  const defaultPlan = plans[0];
  const shuyu = await getShuyuRouteRuntimeAvailability({
    timeoutMs: 3_000,
    requiredPoints: defaultPlan
      ? shuyuVideoPlanPointsForDuration(defaultPlan, 15)
      : undefined,
  });

  return NextResponse.json(
    publicVideoRouteOptionsResponseSchema.parse({
      ok: true,
      defaultRouteId: "buddy",
      routes: [
        {
          id: "buddy",
          provider: "shuyu",
          /// 显示名按默认档位出,不再写死 720P(1080P 入族后仍以默认档为准)。
          displayName: `Aivora 视频通道 · Seedance ${defaultPlan?.resolution ?? SHUYU_VIDEO_RESOLUTION}`,
          model: defaultPlan?.model ?? SHUYU_VIDEO_MODEL,
          resolution: defaultPlan?.resolution ?? SHUYU_VIDEO_RESOLUTION,
          configured: shuyu.configured,
          funded: shuyu.funded,
          available: shuyu.available,
          unavailableReason: shuyu.reason,
          plans: plans.map((plan, index) => ({
            planId: plan.planId,
            displayName: plan.displayName,
            resolution: plan.resolution,
            tier: plan.tier,
            billingUnit: plan.billingUnit,
            unitSalePoints: plan.unitSalePoints,
            pointsPer15s: shuyuVideoPlanPointsForDuration(plan, 15),
            isDefault: index === 0,
          })),
        },
      ],
    }),
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
