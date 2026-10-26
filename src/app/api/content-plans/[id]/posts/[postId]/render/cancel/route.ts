import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { customerApiError } from "@/lib/api/customer-generation-error";
import { ContentPostRenderError } from "@/lib/services/content-post-render-service";
import { cancelContentPostRender } from "@/lib/services/content-post-image-job-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 「停止出图」（铁律 #7：每一轮任务都必须可取消）。永远免费：取消不计费。
 *
 * 还没提交给 Shuyu 的那几张在一个事务里取消；已提交的照常收回并落库（花过钱的素材保留）；
 * 帖子留在草稿，这一轮不会再变成可发布。之后点「补齐配图」只补缺的那几张。重复点幂等。
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; postId: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id: planId, postId } = await ctx.params;
  try {
    const render = await cancelContentPostRender({
      userId: guard.session.user.id,
      planId,
      postId,
    });
    return NextResponse.json({ ok: true, state: render.state, slides: render.slides, render });
  } catch (error) {
    if (error instanceof ContentPostRenderError && error.reason === "not_found") {
      return NextResponse.json(
        customerApiError({
          code: "RESOURCE_NOT_FOUND",
          message: error.message,
          retryable: false,
          action: "contact_support",
        }),
        { status: 404 },
      );
    }
    console.error("[content-post-render:cancel] failed", { postId, error });
    return NextResponse.json(
      customerApiError({
        code: "INTERNAL_ERROR",
        message: "暂时没能停止出图，请再点一次。",
        retryable: true,
        action: "retry",
      }),
      { status: 500 },
    );
  }
}
