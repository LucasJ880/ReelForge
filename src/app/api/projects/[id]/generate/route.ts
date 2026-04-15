import { NextRequest, NextResponse } from "next/server";
import { generateContentPlan } from "@/lib/services/content-service";
import { handleApiError } from "@/lib/utils/api-error";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let targetDuration: number | undefined;
  try {
    const body = await request.json();
    targetDuration = body.targetDuration;
  } catch { /* no body is fine */ }

  try {
    const contentPlan = await generateContentPlan(id, targetDuration);
    return NextResponse.json({ contentPlan });
  } catch (error) {
    return handleApiError(error, "内容生成");
  }
}
