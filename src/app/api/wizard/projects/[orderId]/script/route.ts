import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/api-auth";
import {
  generateAndPersistWizardScript,
  getCurrentWizardScript,
  patchWizardScript,
} from "@/lib/services/wizard-script-service";

/**
 * GET /api/wizard/projects/:orderId/script
 * 返回当前 wizard 脚本（如果还没生成则 null）。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { orderId } = await params;
  const script = await getCurrentWizardScript(orderId);
  return NextResponse.json({ script });
}

/**
 * POST /api/wizard/projects/:orderId/script
 * 触发新一轮脚本生成（自动 mock fallback）。
 *
 * Body: { targetLanguage?: string }
 */
const generateSchema = z.object({
  targetLanguage: z.string().min(2).max(12).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { orderId } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = generateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await generateAndPersistWizardScript({
      deliveryOrderId: orderId,
      targetLanguage: parsed.data.targetLanguage,
    });
    return NextResponse.json(
      {
        scriptId: result.scriptId,
        videoBriefId: result.videoBriefId,
        scriptOutput: result.scriptOutput,
        fromMock: result.fromMock,
        reason: result.reason,
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "脚本生成失败", message: (err as Error).message },
      { status: 400 },
    );
  }
}

/**
 * PATCH /api/wizard/projects/:orderId/script
 * Body: { hook?, cta?, fullText? }
 *
 * 客户在 step 3 微调脚本时调用，不重跑 LLM。
 */
const patchSchema = z.object({
  hook: z.string().min(1).max(800).optional(),
  cta: z.string().min(1).max(400).optional(),
  fullText: z.string().min(1).max(8000).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { orderId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const updated = await patchWizardScript({
      deliveryOrderId: orderId,
      ...parsed.data,
    });
    return NextResponse.json({
      scriptId: updated.id,
      hook: updated.hook,
      cta: updated.cta,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "更新失败", message: (err as Error).message },
      { status: 400 },
    );
  }
}
