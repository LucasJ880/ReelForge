import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { generateAnglesForRound } from "@/lib/services/angle-service";
import { ensureBriefsForRound } from "@/lib/services/brief-service";
import { generateAnglesSchema } from "@/lib/validators";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = generateAnglesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const angles = await generateAnglesForRound({
      roundId: id,
      sellingPointId: parsed.data.sellingPointId,
    });
    await ensureBriefsForRound(id);
    return NextResponse.json({ items: angles });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
