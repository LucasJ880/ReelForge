import { z } from "zod";
import { HOOK_TYPES } from "@/lib/video-generation/creative-recipe";

/**
 * O1 · 一句话进，多形态出（PRD §3）。
 *
 * 小商家常常没有独立站，但一定说得出「我家做定制百叶窗，想让人来约免费上门量尺」。
 * 所以主入口是**一句话**，不是商品链接。
 *
 * 验收标准：输入一句话，20 分钟内拿到**一周可发的内容**（含文案与话题标签），
 * 无需手工补齐。因此这里的产出单位是「一周计划」，不是「一条内容」——
 * 小商家的真痛点是发不出去、发得不连续，不是单条不够好。
 */

/** 输入形态。三种都是 P0。 */
export const contentPlanSourceSchema = z.enum([
  /// 主入口：一句话 / 一段业务描述
  "sentence",
  /// 一张产品图
  "product_image",
  /// 商品链接（Shopify / 通用 OG）——有独立站的走这条
  "product_url",
]);

/**
 * 输出形态。
 * `video` 与 `product_image` 我们已经有，且视频是专业级的；
 * 本轮补的是前三种——它们此前是**零**。
 */
export const contentFormatSchema = z.enum([
  /// 纯文案帖：文案 + 话题标签，无配图
  "text",
  /// 单图帖（产品图 ≠ 社媒帖，需要单独出）
  "single_image",
  /// 轮播：多图多屏
  "carousel",
  /// 短视频（走已有的专业级管线）
  "video",
]);

export type ContentFormat = z.infer<typeof contentFormatSchema>;

export const hookTypeSchema = z.enum(HOOK_TYPES);

/**
 * 文案三段式。用同行已验证的 hook / body / CTA 结构，不自己发明。
 * 这三段分开存而不是一坨文本：赛马要按段归因，拼起来就拆不回去了。
 */
export const postCopySchema = z.object({
  /// 前 3 秒 / 第一行。决定别人停不停下来。
  hook: z.string().min(1),
  body: z.string().min(1),
  /// 个人号可以没有 CTA；商家几乎总要有。
  cta: z.string().nullable(),
});

/**
 * 轮播的一屏。
 * `imagePrompt` 是给出图模型的，`overlayText` 是压在图上的字——
 * 分开是因为「让 AI 把文字写对」是模型能力问题，我们的策略是**不让它重画文字**
 * （PRD §12 明确不做）。文字由我们自己叠。
 */
export const carouselSlideSchema = z.object({
  order: z.number().int().nonnegative(),
  imagePrompt: z.string().min(1),
  overlayText: z.string().nullable(),
  purpose: z.string().min(1),
});

export const contentPostSchema = z.object({
  /// 计划内稳定序号，重排不改。
  key: z.string().min(1),
  /// 一周内的第几天（0 = 计划起始日）。空档也是信息，不要压缩天数。
  dayOffset: z.number().int().min(0).max(6),
  format: contentFormatSchema,
  /// 显式的钩子类型 —— **这是 M0 留下缺口的补法**。
  /// 配方必须在生成时就是一个选择，事后从自由文本反推是反推不出来的。
  hookType: hookTypeSchema,
  copy: postCopySchema,
  /// 话题标签，不带 #，由展示层加。
  hashtags: z.array(z.string().min(1)).max(30),
  /// 单图帖的出图提示词；其他形态为 null。
  imagePrompt: z.string().min(1).nullable(),
  /// 轮播的分屏；其他形态为空数组。
  slides: z.array(carouselSlideSchema),
  /// 这条为什么值得发（给商家看的理由，不是给模型的）。
  rationale: z.string().min(1),
});

export type ContentPost = z.infer<typeof contentPostSchema>;

export const contentPlanSchema = z.object({
  /// 一句话概括这一周在讲什么。
  theme: z.string().min(1),
  targetAudience: z.string().min(1),
  corePainPoint: z.string().min(1),
  posts: z.array(contentPostSchema).min(1).max(14),
});

export type ContentPlan = z.infer<typeof contentPlanSchema>;

/**
 * 一周至少 3 条 —— 北极星指标就是「周活商家中一周至少发布 3 条的比例 ≥ 50%」。
 * 生成器产出低于这个数就是没达到验收标准，要补，而不是直接交付。
 */
export const MIN_POSTS_PER_WEEK = 3;
export const TARGET_POSTS_PER_WEEK = 5;

/**
 * 形态配比。轮播与单图是本轮补的短板，必须真的出现在计划里，
 * 否则「多形态出」会退化成「多发几条文案」。
 */
export const REQUIRED_FORMATS: ContentFormat[] = [
  "text",
  "single_image",
  "carousel",
];

export function missingRequiredFormats(plan: ContentPlan): ContentFormat[] {
  const present = new Set(plan.posts.map((post) => post.format));
  return REQUIRED_FORMATS.filter((format) => !present.has(format));
}
