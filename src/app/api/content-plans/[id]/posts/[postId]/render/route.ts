import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { rateLimitedResponse } from "@/lib/api-rate-limit";
import { customerApiError } from "@/lib/api/customer-generation-error";
import { isContentPostRenderActive, type ContentPostRenderView } from "@/lib/contracts/content-post-render";
import { demoBlockedBody, isDemoAccountEmail } from "@/lib/demo-account";
import {
  ContentPostRenderError,
  discardContentPost,
  renderContentPost,
} from "@/lib/services/content-post-render-service";
import {
  cancelUnsubmittedContentPostImages,
  contentPostImageProvider,
  reconcileContentPostRender,
  startContentPostRender,
} from "@/lib/services/content-post-image-job-service";
import { assertPaidActionRateLimit } from "@/lib/services/paid-action-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/// Shuyu 线路：一次请求只提交（最多 3 张并发、每张 20 秒确认上限）就回 202，出图在后台对账。
/// OpenAI 回滚线路仍是逐屏同步出图（轮播最多 6 屏），渲染锁时限（RENDER_LOCK_TTL_MS）必须长于这里。
export const maxDuration = 300;

/**
 * 单图帖 / 轮播出图（PRD §3 O1）。
 *
 * GET    读时对账：推进在途的 Shuyu 任务、收图、补提交、收尾，返回带每屏状态的视图（前端每 2.5 秒拉一次）
 * POST   开一轮出图（已出齐则幂等返回，不重复计费；半套轮播只补缺的那几屏；正在出图则原样返回进度）
 *        默认走 Shuyu 异步（202 + { state, slides }）；CONTENT_POST_IMAGE_PROVIDER=openai 切回同步 gpt-image
 * DELETE 弃用这条：清运行态、**保留已出的素材**，还没提交的那几张一并取消（已提交的照常收回）
 * 停止这一轮出图（不弃用帖子）：POST ./cancel
 *
 * 并发：服务层用 renderStartedAt 渲染锁 + 只许「同一轮的草稿 → READY」的 CAS，
 * 双击 / 两个标签页不会两边各出一遍。
 */

type RenderRouteContext = { params: Promise<{ id: string; postId: string }> };

interface RenderRouteDependencies {
  requireAuth: typeof requireAuth;
  assertPaidActionRateLimit: typeof assertPaidActionRateLimit;
  imageProvider: () => ReturnType<typeof contentPostImageProvider>;
  startContentPostRender: typeof startContentPostRender;
  reconcileContentPostRender: typeof reconcileContentPostRender;
  /// 回滚线路（同步 gpt-image）：原样保留，删除另起 PR（铁律 8）。
  renderContentPost: typeof renderContentPost;
  discardContentPost: typeof discardContentPost;
  cancelUnsubmittedContentPostImages: typeof cancelUnsubmittedContentPostImages;
}

const defaultDependencies: RenderRouteDependencies = {
  requireAuth,
  assertPaidActionRateLimit,
  imageProvider: () => contentPostImageProvider(),
  startContentPostRender,
  reconcileContentPostRender,
  renderContentPost,
  discardContentPost,
  cancelUnsubmittedContentPostImages,
};

function renderBody(render: ContentPostRenderView) {
  return { ok: true as const, state: render.state, slides: render.slides, render };
}

function renderErrorResponse(err: unknown): NextResponse {
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
  if (err instanceof ContentPostRenderError && err.reason === "billing_review") {
    /// 缺的那几张上次失败且退款未确认：为避免重复扣费不自动重出，引导联系我们（不给「重试」）。
    return NextResponse.json(
      customerApiError({ code: "INVALID_STATE", message: err.message, retryable: false, action: "contact_support" }),
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

export function createContentPostRenderHandlers(
  overrides: Partial<RenderRouteDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };

  async function get(_req: NextRequest, ctx: RenderRouteContext) {
    const guard = await dependencies.requireAuth();
    if (!guard.ok) return guard.response;
    const { id: planId, postId } = await ctx.params;
    try {
      const render = await dependencies.reconcileContentPostRender({
        userId: guard.session.user.id,
        planId,
        postId,
      });
      return NextResponse.json(renderBody(render));
    } catch (err) {
      return renderErrorResponse(err);
    }
  }

  async function post(_req: NextRequest, ctx: RenderRouteContext) {
    const guard = await dependencies.requireAuth();
    if (!guard.ok) return guard.response;
    /// 演示账号不跑付费生成（铁律 #4）：middleware 已统一拦写请求，这里是第二道。
    if (isDemoAccountEmail(guard.session.user.email)) {
      return NextResponse.json(demoBlockedBody(), { status: 403 });
    }
    const { id: planId, postId } = await ctx.params;
    const userId = guard.session.user.id;
    /// 按用户每小时限流（D5）：服务层拿到渲染锁、确认这一轮真要出图时才计一次。
    const beforeRender = () =>
      dependencies.assertPaidActionRateLimit({ action: "content-post-render", userId });
    try {
      if (dependencies.imageProvider() === "openai") {
        const result = await dependencies.renderContentPost({ userId, postId, beforeRender });
        return NextResponse.json(result);
      }
      const render = await dependencies.startContentPostRender({ userId, planId, postId, beforeRender });
      return NextResponse.json(renderBody(render), {
        status: isContentPostRenderActive(render) ? 202 : 200,
      });
    } catch (err) {
      return renderErrorResponse(err);
    }
  }

  async function remove(_req: NextRequest, ctx: RenderRouteContext) {
    const guard = await dependencies.requireAuth();
    if (!guard.ok) return guard.response;
    const { postId } = await ctx.params;
    const userId = guard.session.user.id;

    const ok = await dependencies.discardContentPost({ userId, postId });
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
    /// 还没提交给 Shuyu 的那几张一并取消（已提交的照常收回）；失败不影响弃用本身。
    await dependencies.cancelUnsubmittedContentPostImages({ userId, postId }).catch((err) => {
      console.warn("[content-post-render] cancel unsubmitted images failed:", err);
    });
    return NextResponse.json({ ok: true });
  }

  return { GET: get, POST: post, DELETE: remove };
}

const handlers = createContentPostRenderHandlers();

export async function GET(req: NextRequest, ctx: RenderRouteContext) {
  return handlers.GET(req, ctx);
}

export async function POST(req: NextRequest, ctx: RenderRouteContext) {
  return handlers.POST(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: RenderRouteContext) {
  return handlers.DELETE(req, ctx);
}
