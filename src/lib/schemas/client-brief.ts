import { z } from "zod";
import {
  CREATIVE_INDUSTRIES,
  CREATIVE_OBJECTIVES,
  CREATIVE_PLATFORMS,
} from "./creative-evidence";

/**
 * Client Project Brief —— 北美本地商家项目向导输入。
 *
 * 与 admin 视角的 productInput 解耦：
 * - productInput 是 SKU/材质/价格等供 director/script 使用的产品事实；
 * - clientBrief 是商家自己回答得上来的「我是谁、我要什么」。
 */

export const VIDEO_LENGTHS = [15, 30, 45, 60] as const;
export type VideoLength = (typeof VIDEO_LENGTHS)[number];

export const BRAND_TONES = [
  "professional",
  "warm",
  "luxury",
  "playful",
  "educational",
  "direct_response",
] as const;
export type BrandTone = (typeof BRAND_TONES)[number];

export const brandAssetsSchema = z.object({
  logoUrl: z.string().url().optional(),
  primaryColor: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/, "颜色应为 6 位 HEX，例如 #1E40AF")
    .optional(),
  accentColor: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/, "颜色应为 6 位 HEX")
    .optional(),
  websiteUrl: z.string().url().optional(),
  phone: z.string().min(4).max(40).optional(),
  email: z.string().email().optional(),
  ctaText: z.string().min(2).max(80).optional(),
  addressLine: z.string().max(200).optional(),
});

export const clientBriefSchema = z.object({
  businessName: z.string().min(2).max(120),
  industry: z.enum(CREATIVE_INDUSTRIES),
  objective: z.enum(CREATIVE_OBJECTIVES),
  /// 商家可选多个目标平台
  targetPlatforms: z
    .array(z.enum(CREATIVE_PLATFORMS))
    .min(1)
    .max(5),
  videoLengthSec: z.union([
    z.literal(15),
    z.literal(30),
    z.literal(45),
    z.literal(60),
  ]),
  brandTone: z.enum(BRAND_TONES),
  brandAssets: brandAssetsSchema.default({}),

  /// 商家可在向导阶段先收藏候选卡片；最终只允许一个 selected
  candidateCardSlugs: z.array(z.string().min(3).max(80)).max(8).default([]),
  selectedCardSlug: z.string().min(3).max(80).optional(),

  /// 自由文本：商家的关键信息（offer/紧迫感/差异化），上限较短，以鼓励聚焦
  keyMessage: z.string().max(400).optional(),

  /// 合规自检：商家自我确认拥有素材授权 / 不会上传未授权数字人或克隆声音
  consents: z
    .object({
      ownsFootage: z.boolean().default(false),
      noUnauthorizedAvatar: z.boolean().default(false),
      noUnauthorizedVoiceClone: z.boolean().default(false),
    })
    .default({
      ownsFootage: false,
      noUnauthorizedAvatar: false,
      noUnauthorizedVoiceClone: false,
    }),
});

export type ClientBrief = z.infer<typeof clientBriefSchema>;

/** 用于 wizard 第 N 步的部分更新（所有字段可选） */
export const clientBriefPatchSchema = clientBriefSchema.partial();
export type ClientBriefPatch = z.infer<typeof clientBriefPatchSchema>;

export function parseClientBrief(value: unknown) {
  const parsed = clientBriefSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `ClientBrief 校验失败：${formatIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}

export function parseClientBriefPatch(value: unknown) {
  const parsed = clientBriefPatchSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `ClientBrief 部分更新校验失败：${formatIssues(parsed.error.issues)}`,
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
