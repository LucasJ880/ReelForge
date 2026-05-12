import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
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
 * Phase 1 鉴权：复用 requireOperator（所有登录账号当前都被授予 operator 等价权限）。
 * Phase 2 会换成 requireBusinessUser / requirePersonalUser 区分。
 */
export async function POST(req: NextRequest) {
  const guard = await requireOperator();
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
    const plan = await buildPlan(parsed.data);
    return NextResponse.json({ ok: true, plan });
  } catch (err) {
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
