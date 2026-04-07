import { NextRequest, NextResponse } from "next/server";
import { generateAnalysisReport } from "@/lib/services/analysis-service";
import { fetchAnalyticsForProject } from "@/lib/services/analytics-service";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    await fetchAnalyticsForProject(id);
  } catch {
    // analytics may already exist
  }

  try {
    const report = await generateAnalysisReport(id);
    return NextResponse.json({ report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "分析失败";

    if (message === "项目不存在") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (
      message.startsWith("当前状态") ||
      message === "项目未发布" ||
      message === "缺少内容方案" ||
      message === "暂无数据，请先拉取 TikTok 数据"
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error("[analyze] 分析失败:", error);
    return NextResponse.json(
      { error: "分析失败", detail: message },
      { status: 500 }
    );
  }
}
