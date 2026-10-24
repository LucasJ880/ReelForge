import type { Locale } from "@/i18n/config";

/**
 * 质量配方的人话摘要（1025 · B2.5）：模板配方弹窗不再把英文提示词原文和「NEGATIVE PROMPT」摆给客户，
 * 而是说清楚这个模板锁住了什么、排除了哪几类瑕疵。
 *
 * 只按关键词归类，不编造：配方里没有的类别不会出现；归不进任何一类的约束只计入总数。
 * 纯函数，client 组件与测试都能直接用。
 */

type Bilingual = Record<Locale, string>;

const GUARD_GROUPS: ReadonlyArray<{ id: string; pattern: RegExp; label: Bilingual }> = [
  {
    id: "product",
    pattern: /product morphing|wrong colou?r|wrong material|missing parts|duplicate product|warped packaging/i,
    label: { "zh-CN": "产品走样：变形、颜色或材质不符、缺件", "en-US": "Product drift: morphing, wrong color or material, missing parts" },
  },
  {
    id: "claims",
    pattern: /invented features|unsupported claims|fake before after/i,
    label: { "zh-CN": "虚构功能与夸大效果", "en-US": "Invented features and unsupported claims" },
  },
  {
    id: "text",
    pattern: /burned-in text|captions|prices|qr codes|urls|watermarks|unreadable labels|logos|brand marks/i,
    label: { "zh-CN": "画面里的文字、价格、二维码、水印与他人商标", "en-US": "On-screen text, prices, QR codes, watermarks and other brands' marks" },
  },
  {
    id: "layout",
    pattern: /split screen|grid collage|tiled panels|picture-in-picture/i,
    label: { "zh-CN": "拼贴、分屏与画中画", "en-US": "Collages, split screens and picture-in-picture" },
  },
  {
    id: "anatomy",
    pattern: /distorted hands|extra fingers|mannequin/i,
    label: { "zh-CN": "手部畸形与人台肢体", "en-US": "Distorted hands and mannequin parts" },
  },
  {
    id: "continuity",
    pattern: /geometry drift|scene discontinuity|floating objects/i,
    label: { "zh-CN": "场景跳变与物体漂浮", "en-US": "Scene jumps and floating objects" },
  },
  {
    id: "transitions",
    pattern: /crossfade|dissolve|double exposure|ghosting|superimposed/i,
    label: { "zh-CN": "叠化与鬼影转场（只许硬切）", "en-US": "Crossfades and ghosting (hard cuts only)" },
  },
];

export type RecipeGuardSummary = {
  /** 配方里一共有几条负面约束（按逗号 / 换行切分）。 */
  ruleCount: number;
  /** 命中的人话类别，按固定顺序。 */
  groups: Array<{ id: string; label: string }>;
};

export function summarizeRecipeGuards(negativePrompt: string, locale: Locale): RecipeGuardSummary {
  const rules = negativePrompt
    .split(/[,，\n]/)
    .map((rule) => rule.trim())
    .filter(Boolean);
  return {
    ruleCount: rules.length,
    groups: GUARD_GROUPS.filter((group) => group.pattern.test(negativePrompt)).map((group) => ({
      id: group.id,
      label: group.label[locale],
    })),
  };
}
