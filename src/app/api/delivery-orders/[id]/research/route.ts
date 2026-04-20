import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { startMarketResearch } from "@/lib/services/discovery-service";
import { extractSellingPoints } from "@/lib/services/selling-point-service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    if (body.phase === "research" || !body.phase) {
      await startMarketResearch(id);
    }
    if (body.phase === "selling_points" || body.phase === "all") {
      await startMarketResearch(id);
      await extractSellingPoints(id);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
