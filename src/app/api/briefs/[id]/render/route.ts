import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { renderLatestPlanForBrief } from "@/lib/services/ad-render-service";
import { dispatchVideoGeneration } from "@/lib/services/video-service";

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
    const jobs = await dispatchVideoGeneration(id);
    return NextResponse.json({ jobs });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
