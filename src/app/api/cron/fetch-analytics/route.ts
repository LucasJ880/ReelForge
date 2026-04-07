import { NextRequest, NextResponse } from "next/server";
import { fetchAllPendingAnalytics } from "@/lib/services/analytics-service";

const BATCH_SIZE = 10;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const results = await fetchAllPendingAnalytics(BATCH_SIZE);
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const durationMs = Date.now() - startTime;

    console.log(
      `[cron] 数据拉取完成: ${succeeded} 成功, ${failed} 失败, 耗时 ${durationMs}ms`
    );

    return NextResponse.json({
      total: results.length,
      succeeded,
      failed,
      durationMs,
      results,
    });
  } catch (error) {
    console.error("[cron] 数据拉取异常:", error);
    return NextResponse.json(
      { error: "数据拉取失败" },
      { status: 500 }
    );
  }
}
