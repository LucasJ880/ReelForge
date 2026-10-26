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
 * 今日消耗 = 今日创建且走 buddy 线路的 VideoJob 各自 providerUnitPoints 之和,直接读行。
 * 近似值:providerUnitPoints 创建时按默认套餐估价落列,供应商受理后回写成实际套餐
 * (P03-B),所以这个和含未受理行(预检被拒 / 仍在提交中)的估价;同一行多次受理
 * (重试)只计最后一次;历史无快照行不计入。对账以 Shuyu 后台账单为准。
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
