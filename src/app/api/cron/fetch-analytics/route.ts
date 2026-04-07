import { NextRequest, NextResponse } from "next/server";
import { fetchAllPendingAnalytics } from "@/lib/services/analytics-service";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await fetchAllPendingAnalytics();
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(
      `[cron] 数据拉取完成: ${succeeded} 成功, ${failed} 失败`
    );

    return NextResponse.json({
      total: results.length,
      succeeded,
      failed,
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
