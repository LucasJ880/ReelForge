import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { rateLimitedResponse } from "@/lib/api-rate-limit";
import { customerApiError } from "@/lib/api/customer-generation-error";
import {
  ContentPostRenderError,
  discardContentPost,
  renderContentPost,
} from "@/lib/services/content-post-render-service";
import { assertPaidActionRateLimit } from "@/lib/services/paid-action-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/// 轮播最多 6 屏、逐屏同步出图。渲染锁时限（RENDER_LOCK_TTL_MS）必须长于这里。
export const maxDuration = 300;

/**
 * 单图帖 / 轮播出图（PRD §3 O1）。
 *
 * POST   出图（已出齐则幂等返回，不重复计费；半套轮播只补缺的那几屏）
 * DELETE 取消这一轮：清运行态、**保留已出的素材**
 *
 * 并发：服务层用 renderStartedAt 渲染锁 + 只许「草稿 → READY」的 CAS，
 * 第二个请求拿到 409「正在出图」，不会两边各出一遍。
 */

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ postId: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { postId } = await ctx.params;

  const userId = guard.session.user.id;
  try {
    const result = await renderContentPost({
      userId,
      postId,
      /// 按用户每小时限流（D5）：服务层拿到渲染锁、确认真要出图时才计一次。
      beforeRender: () =>
        assertPaidActionRateLimit({ action: "content-post-render", userId }),
    });
    return NextResponse.json(result);
  } catch (err) {
    const limited = rateLimitedResponse(err);
    if (limited) return limited;
    if (
      err instanceof ContentPostRenderError &&
      (err.reason === "in_progress" || err.reason === "discarded")
    ) {
      /// 状态冲突：刷新就能看到真实结果（另一个请求出完 / 已取消、素材已保留）。
      return NextResponse.json(
        customerApiError({
          code: err.reason === "in_progress" ? "REQUEST_IN_PROGRESS" : "INVALID_STATE",
          message: err.message,
          retryable: false,
          action: "refresh_status",
        }),
        { status: 409 },
      );
    }
    if (err instanceof ContentPostRenderError && err.reason === "provider_unavailable") {
      /// 账户层故障：说清楚在恢复，不引导客户反复重试。
      return NextResponse.json(
        customerApiError({ code: "SERVICE_UNAVAILABLE", message: err.message, retryable: true, action: "wait" }),
        { status: 503 },
      );
    }
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
