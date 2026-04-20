import { NextRequest, NextResponse } from "next/server";
import { requireReviewer } from "@/lib/api-auth";
import { runAIQA } from "@/lib/services/qa-service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireReviewer();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  try {
    const review = await runAIQA(id);
    return NextResponse.json(review);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
