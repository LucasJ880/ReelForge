import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { createRound } from "@/lib/services/round-service";
import { createRoundSchema } from "@/lib/validators";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = createRoundSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const round = await createRound({
      deliveryOrderId: id,
      primarySellingPointId: parsed.data.sellingPointId,
      optimizationSlots: parsed.data.optimizationSlots,
      explorationSlots: parsed.data.explorationSlots,
    });
    return NextResponse.json(round, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
