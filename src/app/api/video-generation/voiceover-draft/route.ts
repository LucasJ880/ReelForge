import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserOfTypeForGeneration } from "@/lib/api-auth";
import { writeVoiceoverScript } from "@/lib/video-generation/voiceover-writer";

export const maxDuration = 60;

const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  durationSec: z.number().int().min(5).max(120),
  language: z.string().trim().min(2).max(16),
  cta: z.string().trim().max(200).nullish(),
});

/**
 * POST /api/video-generation/voiceover-draft
 *
 * 创作页「生成口播稿」：LLM 按商家原话写一段一人口播（2026-10-28 闭环轮）。
 * Response: { ok: true, script: string | null }——null 表示 AI 不可用 / 超时 / 超长，前端保留模板稿。
 * 不扣视频额度；只写文本，不触发任何生成。
 */
export async function POST(req: NextRequest) {
  const guard = await requireUserOfTypeForGeneration();
  if (!guard.ok) return guard.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "参数错误" }, { status: 400 });
  }
  const script = await writeVoiceoverScript(parsed.data);
  return NextResponse.json({ ok: true, script });
}
