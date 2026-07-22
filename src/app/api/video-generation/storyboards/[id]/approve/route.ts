import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  approveStoryboard,
  StoryboardRequestError,
} from "@/lib/video-generation/storyboard-service";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  try {
    const run = await approveStoryboard({
      userId: guard.session.user.id,
      runId: id,
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
