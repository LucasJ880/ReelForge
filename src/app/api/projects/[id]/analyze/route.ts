import { NextRequest, NextResponse } from "next/server";
import { generateAnalysisReport } from "@/lib/services/analysis-service";
import { fetchAnalyticsForProject } from "@/lib/services/analytics-service";
import { handleApiError } from "@/lib/utils/api-error";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    await fetchAnalyticsForProject(id);
  } catch (fetchErr) {
    const msg = fetchErr instanceof Error ? fetchErr.message : "";
    if (!msg.includes("项目未发布") && !msg.includes("未成功发布")) {
      console.warn("[analyze] 数据拉取跳过:", msg);
    }
  }

  try {
    const report = await generateAnalysisReport(id);
    return NextResponse.json({ report });
  } catch (error) {
    return handleApiError(error, "分析");
  }
}
