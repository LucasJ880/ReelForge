import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { createAndRunWizardRender } from "@/lib/services/wizard-render-service";

/**
 * GET /api/wizard/projects/:orderId/render
 * 返回该项目最近 5 个 WizardRenderJob（含 status / mode / fallbackReason / outputVideoUrl）。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { orderId } = await params;

  const jobs = await db.wizardRenderJob.findMany({
    where: { deliveryOrderId: orderId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return NextResponse.json({ jobs });
}

/**
 * POST /api/wizard/projects/:orderId/render
 * Body: { aspectRatio?: "9:16" | "1:1" | "16:9" }
 *
 * 生成一个新的 WizardRenderJob 并立刻执行（draft / mock 都算成功，永不抛 5xx）。
 * UI 应根据 mode + fallbackReason 显示「Draft Preview」「Mock Preview」「Real Render」标签。
 */
const bodySchema = z.object({
  aspectRatio: z.enum(["9:16", "1:1", "16:9"]).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { orderId } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const job = await createAndRunWizardRender({
      deliveryOrderId: orderId,
      aspectRatio: parsed.data.aspectRatio,
    });
    return NextResponse.json(job, { status: 201 });
  } catch (err) {
    /// createAndRunWizardRender 内部已对运行时错误做了 DRAFT 兜底；
    /// 走到这里通常是 brief / 项目不存在等前置错误。
    return NextResponse.json(
      { error: "渲染任务创建失败", message: (err as Error).message },
      { status: 400 },
    );
  }
}
