import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserOfTypeForGeneration } from "@/lib/api-auth";
import {
  MediaAssetNotFoundError,
  MediaAssetTypeError,
  resolveOwnedImageAssets,
} from "@/lib/services/media-asset-service";
import { writePromptDraft } from "@/lib/video-generation/prompt-draft-writer";

export const maxDuration = 60;

const bodySchema = z.object({
  /// 商品图：只收素材 id，地址由服务端按属主解析（不收任意 URL）
  assetIds: z.array(z.string().trim().min(1).max(64)).max(6).default([]),
  hint: z.string().max(4000).nullish(),
  durationSec: z.number().int().min(5).max(120),
  language: z.string().trim().min(2).max(16),
});

/**
 * POST /api/video-generation/prompt-draft
 *
 * 创作页「帮我写 / 帮我润色」：看商品图（和商家已写的字）写两三句视频描述（2026-10-28 晚，上线审核 §3）。
 * Response: { ok: true, description: string | null }——null 表示 AI 不可用 / 超时 / 超长，前端保留商家原来的字。
 * 不扣视频额度；只写文本，不触发任何生成。
 */
export async function POST(req: NextRequest) {
  const guard = await requireUserOfTypeForGeneration();
  if (!guard.ok) return guard.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "参数错误" }, { status: 400 });
  }
  if (parsed.data.assetIds.length === 0 && !parsed.data.hint?.trim()) {
    return NextResponse.json({ ok: false, error: "先上传商品图，或写一句想拍什么。" }, { status: 400 });
  }
  let imageUrls: string[] = [];
  try {
    const assets = await resolveOwnedImageAssets({ userId: guard.session.user.id, assetIds: parsed.data.assetIds });
    imageUrls = assets.map((asset) => asset.url);
  } catch (error) {
    if (error instanceof MediaAssetNotFoundError || error instanceof MediaAssetTypeError) {
      return NextResponse.json({ ok: false, error: "素材不存在或不是图片。" }, { status: 404 });
    }
    throw error;
  }
  const description = await writePromptDraft({
    imageUrls,
    hint: parsed.data.hint ?? null,
    durationSec: parsed.data.durationSec,
    language: parsed.data.language,
  });
  return NextResponse.json({ ok: true, description });
}
