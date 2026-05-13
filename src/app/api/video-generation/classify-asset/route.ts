import { NextRequest, NextResponse } from "next/server";
import { requireUserOfTypeForGeneration } from "@/lib/api-auth";
import {
  classifyAsset,
  type AssetClassification,
} from "@/lib/video-generation/asset-classifier";
import { classifyAssetRequestSchema } from "@/lib/schemas/unified-input";

/**
 * POST /api/video-generation/classify-asset
 *
 * Body: ClassifyAssetRequest（url + mimeType + fileName + 可选 width/height/durationSeconds）
 * Response: { ok: true, classification: { inferredRole, roleConfidence, suggestedUse, warnings } }
 *
 * 给 unified-creative-input 的 attachment-uploader 在用户上传完文件后实时调用，
 * 拿到 inferredRole 后展示给用户（可手动改）。
 *
 * 纯规则推断，无 LLM 调用；返回快。
 */
export async function POST(req: NextRequest) {
  const guard = await requireUserOfTypeForGeneration();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = classifyAssetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "参数错误", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const classification: AssetClassification = classifyAsset({
    url: parsed.data.url,
    mimeType: parsed.data.mimeType,
    fileName: parsed.data.fileName,
    width: parsed.data.width ?? null,
    height: parsed.data.height ?? null,
    durationSeconds: parsed.data.durationSeconds ?? null,
    fileSizeBytes: parsed.data.fileSizeBytes ?? null,
  });

  return NextResponse.json({ ok: true, classification });
}
