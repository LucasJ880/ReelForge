import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { generateScenesForBrief } from "@/lib/services/scene-service";
import { generatePromptsForBrief } from "@/lib/services/prompt-service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const scenes = await generateScenesForBrief(id);
    if (body.generatePrompts !== false) {
      await generatePromptsForBrief(id);
    }
    return NextResponse.json({ scenes });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
