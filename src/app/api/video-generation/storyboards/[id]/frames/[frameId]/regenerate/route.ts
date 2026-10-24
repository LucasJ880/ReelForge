import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  regenerateStoryboardFrame,
  StoryboardRequestError,
} from "@/lib/video-generation/storyboard-service";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string; frameId: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id, frameId } = await context.params;
  try {
    const run = await regenerateStoryboardFrame({
      userId: guard.session.user.id,
      runId: id,
      frameId,
      // 用户点「重做这一帧」：计入每小时限流；单帧另有重做次数上限。
      userInitiated: true,
    });
    return NextResponse.json({ ok: true, run });
  } catch (error) {
    if (error instanceof StoryboardRequestError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}
