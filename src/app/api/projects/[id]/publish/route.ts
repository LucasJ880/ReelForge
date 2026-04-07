import { NextRequest, NextResponse } from "next/server";
import { publishToTikTok } from "@/lib/services/publish-service";
import { handleApiError } from "@/lib/utils/api-error";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await publishToTikTok(id);
    return NextResponse.json({ result });
  } catch (error) {
    return handleApiError(error, "发布");
  }
}
