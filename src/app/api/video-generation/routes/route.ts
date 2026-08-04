import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
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
  const plans = await resolveShuyuVideoPlans({ timeoutMs: 3_000 }).catch(
    () => [],
  );
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
          displayName: "Aivora 视频通道 · Seedance 720P",
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
