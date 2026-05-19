import { NextRequest, NextResponse } from "next/server";
import { requireUserOfTypeForGeneration } from "@/lib/api-auth";
import { quotaErrorResponse } from "@/lib/api-quota";
import { assertQuotaForSession } from "@/lib/services/quota-service";
import { buildPlan } from "@/lib/video-generation/generation-supervisor";
import { unifiedVideoGenerationRequestSchema } from "@/lib/schemas/unified-input";

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

  try {
    await assertQuotaForSession(guard.session, "PLAN_PREVIEW", 1);
    const plan = await buildPlan(parsed.data);
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
