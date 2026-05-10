import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import {
  generateAndPersistWizardStoryboard,
  getCurrentWizardStoryboard,
} from "@/lib/services/wizard-storyboard-service";

/**
 * GET /api/wizard/projects/:orderId/storyboard
 * 返回当前 storyboard（含 ScenePlan + shootingGuide JSON）。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { orderId } = await params;
  const data = await getCurrentWizardStoryboard(orderId);
  return NextResponse.json({ storyboard: data });
}

/**
 * POST /api/wizard/projects/:orderId/storyboard
 * 触发新一轮 storyboard 生成（自动 mock fallback）。
 *
 * 注意：会 deleteMany 旧 ScenePlan；matchedShotId 在 RawAsset 上会被 onDelete:SetNull 自动断开。
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { orderId } = await params;

  try {
    const result = await generateAndPersistWizardStoryboard({
      deliveryOrderId: orderId,
    });
    return NextResponse.json(
      {
        scriptId: result.scriptId,
        scenePlanIds: result.scenePlanIds,
        storyboard: result.storyboard,
        shootingGuideItems: result.shootingGuideItems,
        fromMock: result.fromMock,
        reason: result.reason,
        durationConsistencyIssues: result.durationConsistencyIssues,
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "分镜生成失败", message: (err as Error).message },
      { status: 400 },
    );
  }
}
