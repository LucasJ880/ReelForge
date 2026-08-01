import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { loadPerformanceRows } from "@/lib/services/performance-ingest-service";
import {
  explainVerdict,
  judgeRecipes,
} from "@/lib/services/recipe-racing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * R3 · 配方维度胜负（PRD §4 / M2）。
 *
 * 只回答一个问题：**你的哪种内容结构在替你赚钱。**
 * 不做全账号数据看板、不做跨渠道 ROI 归因（PRD §12 明确不做，
 * 那些平台自带且全量数据在平台手里）。
 */

const querySchema = z.object({
  /// 混着不同成熟度的窗口比较配方，等于拿 12h 的和 48h 的比大小。
  windowHours: z.coerce.number().int().positive().default(48),
  metric: z.enum(["engagement_rate", "conversion_rate"]).default("engagement_rate"),
});

export async function GET(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  const parsed = querySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid query" }, { status: 400 });
  }

  const rows = await loadPerformanceRows({
    userId: guard.session.user.id,
    windowHours: parsed.data.windowHours,
  });
  const verdict = judgeRecipes(rows, parsed.data.metric);

  return NextResponse.json({
    verdict,
    /// 给商家看的一句话。前端应该显示这句，而不是自己解读 verdict。
    summary: explainVerdict(verdict),
    windowHours: parsed.data.windowHours,
    sampleRows: rows.length,
  });
}
