import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { renderAdEditPlan } from "@/lib/services/ad-render-service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    const plan = await renderAdEditPlan(id);
    return NextResponse.json(plan);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
