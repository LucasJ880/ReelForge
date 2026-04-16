import { NextRequest, NextResponse } from "next/server";
import { submitVideoJob, checkVideoStatus } from "@/lib/services/video-service";
import { handleApiError } from "@/lib/utils/api-error";
import { requireAdmin } from "@/lib/api-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let videoParams;
  try {
    const body = await request.json();
    videoParams = {
      duration: body.duration,
      resolution: body.resolution,
      ratio: body.ratio,
    };
  } catch {
    videoParams = undefined;
  }

  try {
    const videoJob = await submitVideoJob(id, videoParams);
    return NextResponse.json({ videoJob });
  } catch (error) {
    return handleApiError(error, "视频生成");
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await checkVideoStatus(id);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, "视频状态查询");
  }
}
