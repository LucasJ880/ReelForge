import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { opsCreditsResponseSchema } from "@/lib/contracts/ops-credits";
import {
  getShuyuBalance,
  resolveShuyuVideoPlan,
  shuyuVideoPlanPointsForDuration,
  ShuyuApiError,
} from "@/lib/providers/shuyu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal-only credits snapshot for the ops topbar.
 * 今日消耗 = 今日创建且走 buddy 线路的 VideoJob 各自的计价快照之和
 * (providerUnitPoints 在任务创建时按实时套餐落列;历史无快照行不计入,
 * 近似值,与供应商账单以 Shuyu 后台为准)。
 */
export async function GET() {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  try {
    const startOfTodayUtc = new Date();
    startOfTodayUtc.setUTCHours(0, 0, 0, 0);
    const [balance, todaySpent, defaultPlan] = await Promise.all([
      getShuyuBalance(),
      db.videoJob.aggregate({
        _sum: { providerUnitPoints: true },
        where: {
          videoRouteSnapshot: "buddy",
          createdAt: { gte: startOfTodayUtc },
        },
      }),
      resolveShuyuVideoPlan(),
    ]);
    return NextResponse.json(
      opsCreditsResponseSchema.parse({
        ok: true,
        availablePoints: balance.available_points,
        todaySpentPoints: todaySpent._sum.providerUnitPoints ?? 0,
        videoPlan: {
          model: defaultPlan.model,
          resolution: defaultPlan.resolution,
          /// 展示口径:一条 15s 成片的有效积分成本(按秒套餐乘 15)。
          /// 套餐解析不到时整个请求走 502——宁可显示不可用也不显示过期假价。
          salePoints: shuyuVideoPlanPointsForDuration(defaultPlan, 15),
        },
        fetchedAt: new Date().toISOString(),
      }),
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    const upstream = error instanceof ShuyuApiError;
    if (!upstream) console.error("[GET /api/internal/ops-credits]", error);
    return NextResponse.json(
      { ok: false, error: "积分信息暂不可用" },
      { status: upstream ? 502 : 500 },
    );
  }
}
