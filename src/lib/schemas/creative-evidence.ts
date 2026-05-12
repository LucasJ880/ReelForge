import { z } from "zod";

/**
 * Creative Evidence Card 校验。
 *
 * 合规边界（写在代码里防止后续误用）：
 * - referenceUrl 仅记录原平台链接，禁止下载/自托管/去水印；
 * - thumbnailUrl 仅来自原平台公开 oEmbed 或运营录入的合规缩略图；
 * - structureBreakdown / hookPattern / clientPreviewSummary 是 Aivora 原创解读，
 *   不复制原视频字幕、原配音、原镜头脚本。
 */

export const CREATIVE_INDUSTRIES = [
  "real_estate",
  "pet_business",
  "local_service",
  "restaurant",
  /// 家居用品（毛毯、家纺、五金、智能家居硬件等实物商品）
  "home_goods",
  /// 家居装饰（窗帘、地毯、灯饰、墙面装饰等软装类目）
  "home_decor",
  "general",
] as const;
export type CreativeIndustry = (typeof CREATIVE_INDUSTRIES)[number];

export const CREATIVE_PLATFORMS = [
  "tiktok",
  "instagram_reels",
  "youtube_shorts",
  "facebook",
  "mixed",
] as const;
export type CreativePlatform = (typeof CREATIVE_PLATFORMS)[number];

export const CREATIVE_OBJECTIVES = [
  "get_leads",
  "promote_listing",
  "increase_bookings",
  "announce_offer",
  "brand_awareness",
] as const;
export type CreativeObjective = (typeof CREATIVE_OBJECTIVES)[number];

export const HOOK_TYPES = [
  "POV",
  "Curiosity",
  "Stat",
  "Reveal",
  "Pain",
  "Demo",
  "Question",
  "Authority",
] as const;
export type HookType = (typeof HOOK_TYPES)[number];

/** 公开指标快照：所有字段都是「在某个 observedAt 看到的数字」，禁止承诺实时。 */
export const publicMetricsSchema = z.object({
  observedAt: z.string().min(4),
  views: z.number().int().nonnegative().nullish(),
  likes: z.number().int().nonnegative().nullish(),
  comments: z.number().int().nonnegative().nullish(),
  shares: z.number().int().nonnegative().nullish(),
  saves: z.number().int().nonnegative().nullish(),
  isPaidAd: z.boolean().nullish(),
  paidAdNote: z.string().max(280).nullish(),
});

export const hookPatternSchema = z.object({
  pattern: z.string().min(3).max(200),
  openingSeconds: z.number().int().min(1).max(15).default(3),
  hookType: z.enum(HOOK_TYPES),
  whyItStops: z.string().min(10).max(400),
});

export const structureSegmentSchema = z.object({
  /// 起始秒（含）
  from: z.number().nonnegative(),
  /// 结束秒（含）
  to: z.number().nonnegative(),
  /// 段落角色：hook / setup / proof / demo / lifestyle / cta
  role: z.enum(["hook", "setup", "proof", "demo", "lifestyle", "cta"]),
  /// 段落叙述：>= 2 字符，支持中英混用的短词（如 "CTA"、"演示"、"解决方案"）
  narrative: z.string().min(2).max(400),
});

export const structureBreakdownSchema = z.object({
  segments: z.array(structureSegmentSchema).min(1).max(12),
  pacingNotes: z.string().max(400).optional(),
});

/**
 * 创意证据卡核心结构（业务对象，不直接对应 Prisma row，由 service 层做映射）。
 */
/// 注意：所有可选字段都用 .nullish()（= null | undefined），
/// 因为 Prisma 把 nullable 列返回成 null，service 层会直接把整个 row 喂给 parse。
export const creativeEvidenceCardCoreSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9_-]+$/, "slug 必须为小写字母/数字/_-"),
  title: z.string().min(3).max(160),
  industry: z.enum(CREATIVE_INDUSTRIES),
  platform: z.enum(CREATIVE_PLATFORMS),
  objective: z.enum(CREATIVE_OBJECTIVES),

  sourcePlatform: z.string().max(40).nullish(),
  referenceUrl: z.string().url().nullish(),
  thumbnailUrl: z.string().url().nullish(),

  publicMetrics: publicMetricsSchema.nullish(),
  hookPattern: hookPatternSchema.nullish(),
  structureBreakdown: structureBreakdownSchema.nullish(),

  whyItWorks: z.string().min(10).max(800).nullish(),
  visualStyle: z.string().min(3).max(400).nullish(),
  suggestedUseCase: z.string().min(3).max(400).nullish(),
  riskNotes: z.string().max(800).nullish(),

  recommendationScore: z.number().int().min(0).max(100).nullish(),
  clientPreviewSummary: z.string().min(10).max(400).nullish(),

  status: z
    .enum(["DRAFT", "REVIEWED", "PUBLISHED", "ARCHIVED"])
    .default("DRAFT"),
});

export type CreativeEvidenceCardCore = z.infer<
  typeof creativeEvidenceCardCoreSchema
>;

/** LLM 输出 schema（用于 prompt: generateCreativeEvidenceBreakdown） */
export const creativeEvidenceBreakdownLLMSchema = z.object({
  hookPattern: hookPatternSchema,
  structureBreakdown: structureBreakdownSchema,
  whyItWorks: z.string().min(10).max(800),
  visualStyle: z.string().min(3).max(400),
  suggestedUseCase: z.string().min(3).max(400),
  riskNotes: z.string().max(800).optional(),
  clientPreviewSummary: z.string().min(10).max(400),
  recommendationScore: z.number().int().min(0).max(100),
});

export type CreativeEvidenceBreakdownLLM = z.infer<
  typeof creativeEvidenceBreakdownLLMSchema
>;

export function parseCreativeEvidenceCardCore(value: unknown) {
  const parsed = creativeEvidenceCardCoreSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `CreativeEvidenceCard 校验失败：${formatIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}

export function parseCreativeEvidenceBreakdown(value: unknown) {
  const parsed = creativeEvidenceBreakdownLLMSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `CreativeEvidenceBreakdown LLM 输出无效：${formatIssues(parsed.error.issues)}。请重试或人工补全卡片字段。`,
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
