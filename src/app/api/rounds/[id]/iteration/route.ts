import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { generateRoundIterationReport } from "@/lib/services/iteration-service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    const report = await generateRoundIterationReport(id);
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
