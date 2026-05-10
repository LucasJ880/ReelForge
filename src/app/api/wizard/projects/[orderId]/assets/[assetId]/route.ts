import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/api-auth";
import { matchWizardAssetToShot } from "@/lib/services/wizard-asset-service";

/**
 * PATCH /api/wizard/projects/:orderId/assets/:assetId
 * Body: { matchedShotId: string | null }
 *
 * 让客户在 step 5 把素材绑定/解绑到具体 ScenePlan。
 */
const bodySchema = z.object({
  matchedShotId: z.string().min(1).nullable(),
});

export async function PATCH(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ orderId: string; assetId: string }>;
  },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { orderId, assetId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const asset = await matchWizardAssetToShot({
      deliveryOrderId: orderId,
      rawAssetId: assetId,
      matchedShotId: parsed.data.matchedShotId,
    });
    return NextResponse.json(asset);
  } catch (err) {
    return NextResponse.json(
      { error: "绑定失败", message: (err as Error).message },
      { status: 400 },
    );
  }
}
