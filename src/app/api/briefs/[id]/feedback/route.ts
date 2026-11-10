import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { videoFeedbackInputSchema } from "@/lib/contracts/video-feedback";
import { checkBriefAccess } from "@/lib/services/brief-access";
import { VideoFeedbackUnavailableError, saveVideoFeedback } from "@/lib/services/video-feedback-service";

/**
 * 商家评价自己的一条成片：满意 / 不满意（带原因）。一条成片一份评价，再评就覆盖。
 * 只有成片的主人能评——运营代看不算商家的评价。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const parsed = videoFeedbackInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "INVALID_INPUT", error: "评价内容不完整。" }, { status: 400 });
  }
  const access = await checkBriefAccess(id, auth.session);
  if (!access.allowed || access.reason !== "owner") {
    return NextResponse.json({ ok: false, code: "NOT_FOUND", error: "找不到该视频。" }, { status: 404 });
  }
  try {
    const feedback = await saveVideoFeedback(auth.session.user.id, id, parsed.data);
    return NextResponse.json({ ok: true, feedback });
  } catch (error) {
    if (error instanceof VideoFeedbackUnavailableError) {
      return NextResponse.json(
        { ok: false, code: "UNAVAILABLE", error: "评价暂时没记上，稍后再试。" },
        { status: 503 },
      );
    }
    console.error("[briefs:feedback]", error);
    return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", error: "评价暂时没记上，稍后再试。" }, { status: 500 });
  }
}
