import { NextRequest, NextResponse } from "next/server";
import { requireReviewer } from "@/lib/api-auth";
import { decideQA } from "@/lib/services/qa-service";
import { qaDecisionSchema } from "@/lib/validators";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireReviewer();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = qaDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const result = await decideQA(
      id,
      guard.session.user.id,
      parsed.data.decision,
      parsed.data.comment,
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
