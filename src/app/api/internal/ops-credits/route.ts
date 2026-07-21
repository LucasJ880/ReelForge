import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { opsCreditsResponseSchema } from "@/lib/contracts/ops-credits";
import {
  getShuyuBalance,
  SHUYU_VIDEO_MODEL,
  SHUYU_VIDEO_POINTS_PER_GENERATION,
  SHUYU_VIDEO_RESOLUTION,
  ShuyuApiError,
} from "@/lib/providers/shuyu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal-only credits snapshot for the ops topbar.
 * 今日消耗 = 今日创建且走 buddy 线路的 VideoJob 数 × 单条计价（近似值，
 * 与供应商账单以 Shuyu 后台为准）。
 */
export async function GET() {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  try {
    const startOfTodayUtc = new Date();
    startOfTodayUtc.setUTCHours(0, 0, 0, 0);
    const [balance, todayBuddyJobs] = await Promise.all([
      getShuyuBalance(),
      db.videoJob.count({
        where: {
          videoRouteSnapshot: "buddy",
          createdAt: { gte: startOfTodayUtc },
        },
      }),
    ]);
    return NextResponse.json(
      opsCreditsResponseSchema.parse({
        ok: true,
        availablePoints: balance.available_points,
        todaySpentPoints: todayBuddyJobs * SHUYU_VIDEO_POINTS_PER_GENERATION,
        videoPlan: {
          model: SHUYU_VIDEO_MODEL,
          resolution: SHUYU_VIDEO_RESOLUTION,
          salePoints: SHUYU_VIDEO_POINTS_PER_GENERATION,
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
