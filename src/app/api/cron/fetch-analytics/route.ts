import { NextRequest, NextResponse } from "next/server";
import { fetchAllPendingAnalytics } from "@/lib/services/analytics-service";
import { generateAnalysisReport } from "@/lib/services/analysis-service";
import { db } from "@/lib/db";
import { ProjectStatus } from "@prisma/client";

const BATCH_SIZE = 10;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const fetchResults = await fetchAllPendingAnalytics(BATCH_SIZE);
    const fetchOk = fetchResults.filter((r) => r.success).length;
    const fetchFail = fetchResults.filter((r) => !r.success).length;

    const pendingAnalysis = await db.project.findMany({
      where: { status: ProjectStatus.ANALYTICS_FETCHED },
      select: { id: true },
      take: BATCH_SIZE,
    });

    const analysisResults = [];
    for (const proj of pendingAnalysis) {
      try {
        await generateAnalysisReport(proj.id);
        analysisResults.push({ projectId: proj.id, success: true });
      } catch (err) {
        analysisResults.push({
          projectId: proj.id,
          success: false,
          error: (err as Error).message,
        });
      }
    }

    const analysisOk = analysisResults.filter((r) => r.success).length;
    const analysisFail = analysisResults.filter((r) => !r.success).length;
    const durationMs = Date.now() - startTime;

    console.log(
      `[cron] 完成: 数据拉取 ${fetchOk}/${fetchResults.length}, AI分析 ${analysisOk}/${pendingAnalysis.length}, 耗时 ${durationMs}ms`
    );

    return NextResponse.json({
      fetch: { total: fetchResults.length, succeeded: fetchOk, failed: fetchFail },
      analysis: { total: pendingAnalysis.length, succeeded: analysisOk, failed: analysisFail },
      durationMs,
    });
  } catch (error) {
    console.error("[cron] 异常:", error);
    return NextResponse.json({ error: "Cron 执行失败" }, { status: 500 });
  }
}
