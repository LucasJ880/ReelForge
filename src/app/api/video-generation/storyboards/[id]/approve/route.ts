import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  approveStoryboard,
  StoryboardRequestError,
} from "@/lib/video-generation/storyboard-service";

/** 请求体可以不带；带的话只认 `frameId`：几张开场画面里选的是哪一张。 */
async function readChosenFrameId(req: NextRequest): Promise<string | null> {
  const body = await req.json().catch(() => null) as { frameId?: unknown } | null;
  const frameId = typeof body?.frameId === "string" ? body.frameId.trim() : "";
  return frameId && frameId.length <= 64 ? frameId : null;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  try {
    const run = await approveStoryboard({
      userId: guard.session.user.id,
      runId: id,
      frameId: await readChosenFrameId(req),
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
