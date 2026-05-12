import { z } from "zod";

/**
 * AI Video Director 输出的完整制作计划。
 *
 * 这是 director-service 的唯一真理来源；
 * script-service / scene-service / prompt-service 都从这里派生输出。
 *
 * 设计原则：
 * - 所有秒数都是 absolute（从视频开头算起），方便和 segmentPlan 对齐
 * - 每个 segment 的 sceneList 必须严格对应 timelineScript 中落在该段时间区间内的块
 * - seedancePrompt 字段是发给 Seedance 的最终 prompt（不再让 prompt-service 重写）
 */

export const DIRECTOR_PROMPT_VERSION = "director.v1";

const segmentRoleSchema = z.enum([
  "hook",
  "intro",
  "demo",
  "lifestyle",
  "benefit",
  "cta",
]);

export const timelineBlockSchema = z.object({
  fromSec: z.number().min(0),
  toSec: z.number().min(0),
  visual: z.string().min(1),
  cameraMovement: z.string().default(""),
  onScreenText: z.string().default(""),
  voiceover: z.string().default(""),
  musicCue: z.string().default(""),
  /// 用到的真实素材类型描述（如 "客户上传的产品演示片段 #2"）
  assetNeeded: z.string().default(""),
  /// 是否依赖客户已有素材（false 表示纯 AI 生成）
  hasFootage: z.boolean().default(false),
  /// 拼到 Seedance 单段 prompt 时使用的视觉描述（小段，写在该秒区间内）
  seedanceShotPrompt: z.string().default(""),
});

export const segmentPlanSchema = z.object({
  segmentIndex: z.number().int().min(0),
  durationSec: z.number().int().min(1).max(15),
  fromSec: z.number().min(0),
  toSec: z.number().min(0),
  role: segmentRoleSchema,
  /// 发送到 Seedance 的最终 prompt（已组合该段所有 timelineBlock 的视觉信息）
  seedancePrompt: z.string().min(1),
  negativePrompt: z.string().default(""),
  continuityNotes: z.string().default(""),
  referenceAssetHints: z.array(z.string()).default([]),
  expectedOutput: z.string().default(""),
});

export const editingPlanSchema = z.object({
  stitchOrder: z.array(z.number().int().min(0)).default([]),
  transitions: z.array(z.string()).default([]),
  captions: z.string().default(""),
  logoPlacement: z.string().default(""),
  ctaEndCard: z.string().default(""),
  backgroundMusic: z.string().default(""),
  voiceoverAlignment: z.string().default(""),
  safeAreaNotes: z.string().default(""),
});

export const directorPlanSchema = z.object({
  version: z.literal(DIRECTOR_PROMPT_VERSION).default(DIRECTOR_PROMPT_VERSION),
  language: z.string().min(2).max(10),
  targetDurationSec: z.number().int().min(1),
  platform: z.string().min(1),
  /// 1. 战略概要
  strategySummary: z.object({
    targetAudience: z.string().min(1),
    corePainPoint: z.string().min(1),
    emotionalAngle: z.string().min(1),
    keySellingPoints: z.array(z.string()).min(1),
    platformFit: z.string().default(""),
    recommendedDurationReason: z.string().default(""),
  }),
  /// 2. 时间线脚本（逐秒）
  timelineScript: z.array(timelineBlockSchema).min(1),
  /// 3. Seedance 段计划（1/2/4 段，对应 segment-planner）
  segmentPlan: z.array(segmentPlanSchema).min(1),
  /// 4. 最终剪辑计划（拼接顺序、转场、字幕、logo、CTA、BGM）
  editingPlan: editingPlanSchema,
  /// 5. 质量自检清单（仅供运营审视；不直接展示给客户）
  qualityChecklist: z.array(z.string()).default([]),
});

export type TimelineBlock = z.infer<typeof timelineBlockSchema>;
export type SegmentPlan = z.infer<typeof segmentPlanSchema>;
export type EditingPlan = z.infer<typeof editingPlanSchema>;
export type DirectorPlan = z.infer<typeof directorPlanSchema>;

export function parseDirectorPlan(input: unknown): DirectorPlan {
  return directorPlanSchema.parse(input);
}

export function safeParseDirectorPlan(input: unknown):
  | { ok: true; value: DirectorPlan }
  | { ok: false; error: z.ZodError } {
  const result = directorPlanSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error };
}
