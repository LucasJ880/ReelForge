import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import {
  cancelStoryboardRun,
  StoryboardRequestError,
} from "@/lib/video-generation/storyboard-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().trim().min(1).max(200) });

/**
 * 真取消这一轮故事板（铁律 #7：每一轮任务都必须可取消）。
 *
 * 只取消还在出帧 / 等确认的故事板：排队中的分镜不再提交，已提交的分镜继续
 * 对账把素材收回来；幂等键改写，同样的输入可以立刻重开一轮。已经交给视频
 * 生成的故事板（派发预留 / 已挂 brief）拒绝取消，并给出人话。
 */
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION_FAILED", error: "故事板标识不正确。" },
      { status: 400 },
    );
  }
  try {
    const run = await cancelStoryboardRun(parsed.data.id, guard.session.user.id);
    return NextResponse.json({ ok: true, run });
  } catch (error) {
    if (error instanceof StoryboardRequestError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status },
      );
    }
    console.error("[storyboards:cancel]", error);
    return NextResponse.json(
      { ok: false, code: "INTERNAL_ERROR", error: "暂时无法取消，请稍后再试。" },
      { status: 500 },
    );
  }
}
