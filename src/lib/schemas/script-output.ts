import { z } from "zod";

/**
 * Client Script LLM Output —— 用于 Phase 2 的 Wizard。
 *
 * 与现有 src/lib/services/script-service.ts 的 ScriptLLM 兼容（superset），
 * 现有 Admin/Director 流程无需修改即可继续用 fullText/hook/cta；
 * Wizard 流程则消费完整 captions/cta/complianceNotes 字段。
 */

export const scriptCaptionSchema = z.object({
  /// 与 storyboard scene_index 对齐
  sceneIndex: z.number().int().positive(),
  text: z.string().min(1).max(160),
  /// 商家可选：开始/结束秒
  startSec: z.number().nonnegative().optional(),
  endSec: z.number().nonnegative().optional(),
});

export const scriptOutputSchema = z.object({
  language: z.string().min(2).max(12),
  title: z.string().min(3).max(160),
  hook: z.string().min(3).max(400),
  /// 整段口播稿（不含舞台指示）
  voiceover: z.string().min(10).max(2400),
  captions: z.array(scriptCaptionSchema).max(20).default([]),
  cta: z.string().min(2).max(280),
  /// 平台特化版本：tiktok / instagram_reels / youtube_shorts / facebook
  platformVariants: z
    .record(z.string().min(3).max(2400))
    .optional(),
  /// 行业合规备注（地产/金融/医疗等需要 disclaimer 的场景）
  complianceNotes: z.array(z.string().min(3).max(400)).default([]),
  /// 模型自检：是否复制了参考视频原文（应该总是 false）
  copiedFromReference: z.literal(false).default(false),
});

export type ScriptOutput = z.infer<typeof scriptOutputSchema>;
export type ScriptCaption = z.infer<typeof scriptCaptionSchema>;

export function parseScriptOutput(value: unknown): ScriptOutput {
  const parsed = scriptOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Script LLM 输出无效：${formatIssues(parsed.error.issues)}。请重试或人工补全脚本字段。`,
    );
  }
  return parsed.data;
}

function formatIssues(issues: z.ZodIssue[]) {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}
