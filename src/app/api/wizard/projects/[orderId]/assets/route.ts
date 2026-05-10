import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import {
  listWizardAssetsWithMissingReport,
  registerWizardAsset,
  wizardAssetRegisterSchema,
} from "@/lib/services/wizard-asset-service";

/**
 * GET /api/wizard/projects/:orderId/assets
 * 返回素材列表 + missing-shot 报告。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { orderId } = await params;
  try {
    const data = await listWizardAssetsWithMissingReport(orderId);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "查询素材失败", message: (err as Error).message },
      { status: 400 },
    );
  }
}

/**
 * POST /api/wizard/projects/:orderId/assets
 * Body: WizardAssetRegisterInput（公网 URL 注册）
 *
 * 注意：Phase 2 不支持文件直传；客户先粘贴可访问的公网 URL（如 Cloudinary / S3 预签名）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { orderId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = wizardAssetRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const asset = await registerWizardAsset({
      deliveryOrderId: orderId,
      input: parsed.data,
    });
    return NextResponse.json(asset, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "素材注册失败", message: (err as Error).message },
      { status: 400 },
    );
  }
}
