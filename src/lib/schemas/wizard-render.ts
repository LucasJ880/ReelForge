import { z } from "zod";

/**
 * Wizard Render Timeline Schema
 *
 * 与 admin 用的 ad-edit-plan timeline 故意保持独立 —— wizard timeline 是
 * 客户视角（按 sceneIndex 串起来的 RawAsset），结构更扁平。
 */

export const ASPECT_RATIOS = ["9:16", "1:1", "16:9"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const wizardClipSchema = z.object({
  /// 对应 Storyboard / ScenePlan 中的 sceneIndex（1-based）
  sceneIndex: z.number().int().positive(),
  /// 客户上传的 RawAsset id；如果还没有素材，则为 null（占位）
  rawAssetId: z.string().min(1).nullable(),
  /// 用于真实渲染或 draft 预览的 URL；占位场景留 null
  sourceUrl: z.string().url().nullable(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  captionText: z.string().max(200).optional(),
  /// 该 clip 是否完全来自占位（没有真实素材）
  placeholder: z.boolean().default(false),
});
export type WizardClip = z.infer<typeof wizardClipSchema>;

export const wizardBrandSchema = z.object({
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().max(20).optional(),
  accentColor: z.string().max(20).optional(),
  ctaText: z.string().max(60).optional(),
  websiteUrl: z.string().url().optional(),
  phone: z.string().max(40).optional(),
});
export type WizardBrand = z.infer<typeof wizardBrandSchema>;

export const wizardTimelineSchema = z.object({
  aspectRatio: z.enum(ASPECT_RATIOS),
  totalDurationMs: z.number().int().positive(),
  /// 渲染目标语言（来自 ClientBrief.targetPlatforms 推断或固定 en）
  language: z.string().min(2).max(12).default("en"),
  clips: z.array(wizardClipSchema).min(1).max(20),
  brand: wizardBrandSchema.default({}),
  /// 来自 Script 的 voiceover / cta / captions —— 当前 MVP 只渲染 captionText 和 CTA 收尾页
  voiceoverText: z.string().max(2400).optional(),
  ctaText: z.string().max(280).optional(),
  /// 标记此 timeline 中有多少 clip 是占位（用于 UI 提示）
  placeholderClipCount: z.number().int().nonnegative().default(0),
});
export type WizardTimeline = z.infer<typeof wizardTimelineSchema>;

export function parseWizardTimeline(value: unknown): WizardTimeline {
  return wizardTimelineSchema.parse(value);
}

export function safeParseWizardTimeline(value: unknown) {
  return wizardTimelineSchema.safeParse(value);
}
