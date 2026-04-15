import { NextRequest, NextResponse } from "next/server";
import { batchAnalyze } from "@/lib/services/trend-service";
import { handleApiError } from "@/lib/utils/api-error";
import type { TrendCandidate } from "@/lib/providers/apify-search";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { candidates } = body as { candidates?: TrendCandidate[] };

    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      return NextResponse.json({ error: "请提供至少一个候选视频" }, { status: 400 });
    }

    if (candidates.length > 20) {
      return NextResponse.json(
        { error: "单次最多分析 20 个视频" },
        { status: 400 }
      );
    }

    const results = await batchAnalyze(candidates);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return NextResponse.json({
      total: candidates.length,
      succeeded,
      failed,
      results,
    });
  } catch (error) {
    return handleApiError(error, "批量分析");
  }
}
