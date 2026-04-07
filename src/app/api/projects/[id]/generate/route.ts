import { NextRequest, NextResponse } from "next/server";
import { generateContentPlan } from "@/lib/services/content-service";
import { handleApiError } from "@/lib/utils/api-error";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const contentPlan = await generateContentPlan(id);
    return NextResponse.json({ contentPlan });
  } catch (error) {
    return handleApiError(error, "内容生成");
  }
}
