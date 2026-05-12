import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { renderLatestPlanForBrief } from "@/lib/services/ad-render-service";
import { dispatchVideoForBrief } from "@/lib/services/video-service";

/**
 * POST /api/briefs/[id]/render
 *
 * Phase 5 改造（2026-05）：从 `dispatchVideoGeneration`（旧单段路径）切到
 * `dispatchVideoForBrief`（自动选择单段 / 多段）。
 *
 * - 老 brief（无 directorPlan）会继续走单段路径（零回归）。
 * - 新 brief（有 directorPlan + targetDurationSec > 15）会自动走多段 + stitch。
 *
 * 这是激活已有但未使用的多段管线（详见 src/lib/services/video-service.ts:dispatchVideoForBrief）。
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  try {
    const preferAdPlan = await _req.json().catch(() => ({}));
    if (preferAdPlan.mode === "ad_edit_plan") {
      const plan = await renderLatestPlanForBrief(id);
      return NextResponse.json({ plan });
    }
    const jobs = await dispatchVideoForBrief(id);
    return NextResponse.json({ jobs });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
