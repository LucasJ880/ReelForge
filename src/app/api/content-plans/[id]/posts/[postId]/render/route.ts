import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { customerApiError } from "@/lib/api/customer-generation-error";
import {
  ContentPostRenderError,
  discardContentPost,
  renderContentPost,
} from "@/lib/services/content-post-render-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 单图帖 / 轮播出图（PRD §3 O1）。
 *
 * POST   出图（已出过则幂等返回，不重复计费）
 * DELETE 取消这一轮：清运行态、**保留已出的素材**
 */

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ postId: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { postId } = await ctx.params;

  try {
    const result = await renderContentPost({
      userId: guard.session.user.id,
      postId,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ContentPostRenderError) {
      const status = err.reason === "not_found" ? 404 : err.reason === "provider" ? 503 : 400;
      return NextResponse.json(
        customerApiError({
          code:
            err.reason === "not_found"
              ? "RESOURCE_NOT_FOUND"
              : err.reason === "provider"
                ? "SERVICE_UNAVAILABLE"
                : "INVALID_STATE",
          message: err.message,
          /// 供应商问题可重试；格式/提示词问题重试多少次都一样。
          retryable: err.reason === "provider",
          action: err.reason === "provider" ? "retry" : "contact_support",
        }),
        { status },
      );
    }
    console.error("[content-post-render] failed:", err);
    return NextResponse.json(
      customerApiError({
        code: "INTERNAL_ERROR",
        message: "出图失败，请重试",
        retryable: true,
        action: "retry",
      }),
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ postId: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { postId } = await ctx.params;

  const ok = await discardContentPost({
    userId: guard.session.user.id,
    postId,
  });
  if (!ok) {
    return NextResponse.json(
      customerApiError({
        code: "RESOURCE_NOT_FOUND",
        message: "找不到这条内容",
        retryable: false,
        action: "contact_support",
      }),
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
