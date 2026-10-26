import { NextRequest, NextResponse } from "next/server";
import { requireUserOfTypeForGeneration } from "@/lib/api-auth";
import { isInternalRole } from "@/lib/auth-role-policy";
import { quotaErrorResponse } from "@/lib/api-quota";
import { assertQuotaForSession } from "@/lib/services/quota-service";
import {
  MediaAssetNotFoundError,
  resolveOwnedCreationRequest,
} from "@/lib/services/media-asset-service";
import { buildPlan } from "@/lib/video-generation/generation-supervisor";
import { unifiedVideoGenerationRequestSchema } from "@/lib/schemas/unified-input";
import { canUseRequestedBrandName } from "@/lib/brand/global-brand-access";
import {
  canSubmitStoryboardPersonRefs,
  hasPersonTaggedAttachment,
  storyboardPersonRefsMode,
} from "@/lib/video-generation/storyboard-person-refs";

/**
 * POST /api/video-generation/plan
 *
 * Body: UnifiedVideoGenerationRequest（见 src/lib/schemas/unified-input.ts）
 * Response: { plan: VideoGenerationPlan }
 *
 * 无副作用：不写 DB，不调 Seedance。UI 拿到 plan + planPreview 后再决定是否 dispatch。
 *
 * Phase 5 鉴权：BUSINESS / PERSONAL 任一客户用户均可调用；内部 staff bypass。
 * dispatch 路由会做 persona 与 request.userType 的一致性二次校验。
 */
export async function POST(req: NextRequest) {
  const guard = await requireUserOfTypeForGeneration();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = unifiedVideoGenerationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "请求参数不合法",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  /// 自填品牌名能触发受保护客户的尾卡锁（真实电话、地址），与全局品牌包同一权限。
  if (!(await canUseRequestedBrandName(guard.session.user.id, parsed.data.brandKit?.brandName))) {
    return NextResponse.json(
      { ok: false, error: "这个品牌名属于受保护的客户品牌，当前账号不能使用。" },
      { status: 403 },
    );
  }

  /// 主播参考图（userAssignedRole=person）与故事板走同一个开关 STORYBOARD_PERSON_REFS（P02-D(s)）。
  if (
    hasPersonTaggedAttachment(parsed.data.attachments) &&
    !canSubmitStoryboardPersonRefs({
      mode: storyboardPersonRefsMode(),
      isInternal: isInternalRole(guard.session.user.role),
    })
  ) {
    return NextResponse.json(
      { ok: false, error: "主播参考图暂未开放，请去掉标为主播参考图的素材后再提交。" },
      { status: 400 },
    );
  }

  let request;
  try {
    request = await resolveOwnedCreationRequest({
      userId: guard.session.user.id,
      request: parsed.data,
    });
  } catch (error) {
    if (error instanceof MediaAssetNotFoundError) {
      return NextResponse.json(
        { ok: false, error: "素材不存在或无权访问。" },
        { status: 404 },
      );
    }
    throw error;
  }

  try {
    await assertQuotaForSession(guard.session, "PLAN_PREVIEW", 1);
    const plan = await buildPlan(request);
    return NextResponse.json({ ok: true, plan });
  } catch (err) {
    const quotaRes = quotaErrorResponse(err);
    if (quotaRes) return quotaRes;
    console.error("[/api/video-generation/plan]", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Plan 构建失败，请稍后重试或检查素材。",
        message: (err as Error).message,
      },
      { status: 500 },
    );
  }
}
