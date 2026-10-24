import type { Locale } from "@/i18n/config";

/**
 * 读数注册表（1025 · B1.2）：跨页读数的名字、口径、数据源与颜色只在这里写一次。
 *
 * 规则：**同名必同值**。创作台、批量页、新建批次、成品库、模板库、大屏、壳层出现同一个名字，
 * 一律从同一个 id 取名字与口径，数值也只来自同一个数据源（exchange-readings 的 DB 计数）。
 * 之前「近 24 小时成片 / 近 24 小时成交」「失败」三个数、「近 30 天成片 / 月额度」混在一起，
 * 就是因为每页各写各的。
 *
 * 纯数据：不引 React、不引服务端模块，'use client' 组件可以安全 import。
 */

export type ReadingTone = "neutral" | "live" | "filled" | "winner" | "fault" | "ai";

/** 数据源：pulse = loadPulse（壳层同源）；readings = loadExchangeReadings；usage = UserUsagePeriod；其余是页面自有的 DB 计数。 */
export type ReadingSource = "pulse" | "readings" | "usage" | "templates" | "batches";

type Bilingual = { readonly "zh-CN": string; readonly "en-US": string };

export type ReadingDefinition = {
  readonly name: Bilingual;
  /** 统计口径：一句话写清楚数的是什么、不数什么。 */
  readonly formula: Bilingual;
  readonly source: ReadingSource;
  /** 数值大于 0 时的颜色；为 0 时一律中性（零就写零，不上色）。 */
  readonly tone: ReadingTone;
};

function def(zh: string, en: string, formulaZh: string, formulaEn: string, source: ReadingSource, tone: ReadingTone): ReadingDefinition {
  return {
    name: { "zh-CN": zh, "en-US": en },
    formula: { "zh-CN": formulaZh, "en-US": formulaEn },
    source,
    tone,
  };
}

export const READINGS = {
  generating: def("生成中", "Generating", "供应商正在生成的视频条数", "Videos the provider is rendering now", "pulse", "live"),
  queued: def("排队中", "Queued", "已下单、还没开始生成的视频", "Ordered videos not started yet", "pulse", "neutral"),
  activeBatches: def("进行中批次", "Active batches", "拆单中与生成中，不含已暂停", "Expanding or generating; paused excluded", "pulse", "live"),
  pausedBatches: def("已暂停批次", "Paused batches", "等待恢复的批次", "Batches waiting to resume", "pulse", "neutral"),
  awaitingImages: def("待出图", "Awaiting images", "排好、还没出图的图文帖", "Scheduled posts with no images yet", "pulse", "winner"),
  needsAttention: def("需要处理", "Needs attention", "近 7 天未重试成功、还没看过的失败视频", "Unreviewed failures from the last 7 days", "pulse", "fault"),
  filled24h: def("近 24 小时成片", "Ready · last 24 h", "单条 + 批量视频，不含图文帖", "Single + batch videos; posts excluded", "readings", "filled"),
  filled7d: def("近 7 天成片", "Ready · last 7 days", "单条 + 批量视频，不含图文帖", "Single + batch videos; posts excluded", "readings", "filled"),
  filled30d: def("近 30 天成片", "Ready · last 30 days", "单条 + 批量视频，不含图文帖", "Single + batch videos; posts excluded", "readings", "filled"),
  failed7d: def("近 7 天失败", "Failed · last 7 days", "单条 + 批量视频，取消不算失败", "Single + batch videos; cancels excluded", "readings", "fault"),
  successRate7d: def("近 7 天成片率", "Success rate · 7 days", "成片 ÷（成片 + 失败）", "Ready ÷ (ready + failed)", "readings", "neutral"),
  finished: def("成品", "Finished", "全部已成片视频 + 已出图的图文帖", "All ready videos + posts with images", "readings", "filled"),
  monthlyQuota: def("本月额度", "This month", "已用 ÷ 套餐上限 · UTC 自然月 · 失败与取消返还", "Used ÷ plan limit · UTC month · failures refunded", "usage", "neutral"),
  templates: def("风格模板", "Style templates", "每个模板锁定镜头、节奏与提示词", "Each locks shots, pacing and prompts", "templates", "neutral"),
  verifiedSamples: def("已验收样片", "Verified samples", "逐条真机验收通过的模板样片", "Template samples that passed per-render QA", "templates", "neutral"),
  templateBatches30d: def("近 30 天套用批次", "Batches · last 30 days", "你近 30 天按模板建的批次", "Batches you built from templates in 30 days", "batches", "neutral"),
  batchCompletion: def("完成率", "Completion", "已成片 ÷ 下单条数（近 {n} 批）", "Ready ÷ ordered (latest {n} batches)", "batches", "neutral"),
} as const satisfies Record<string, ReadingDefinition>;

export type ReadingId = keyof typeof READINGS;

export type ReadingStat = {
  id: ReadingId;
  label: string;
  value: string | number;
  caption: string;
  tone: ReadingTone;
};

function fill(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

export function readingName(id: ReadingId, locale: Locale): string {
  return READINGS[id].name[locale];
}

export function readingFormula(id: ReadingId, locale: Locale, params?: Record<string, string | number>): string {
  return fill(READINGS[id].formula[locale], params);
}

/**
 * 读数墙的一格：名字与口径来自注册表，颜色按「大于 0 才上色」。
 * value 传数字（或已格式化的文本，如「79%」「3 / 30」）；toneValue 决定是否上色（默认取 value）。
 */
export function readingStat(
  id: ReadingId,
  value: number | string | null,
  locale: Locale,
  options: { toneValue?: number | null; tone?: ReadingTone; params?: Record<string, string | number> } = {},
): ReadingStat {
  const definition = READINGS[id];
  const numeric = options.toneValue !== undefined ? options.toneValue : typeof value === "number" ? value : null;
  const tone = options.tone ?? (numeric !== null && numeric > 0 ? definition.tone : "neutral");
  return {
    id,
    label: definition.name[locale],
    value: value === null ? "—" : value,
    caption: fill(definition.formula[locale], options.params),
    tone,
  };
}

/** 成片率：没有样本时为 null，界面写「—」。 */
export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${rate}%`;
}

/** 额度格：「已用 / 上限」。用满时上金色（需要你处理的数字）。 */
export function quotaStat(used: number, limit: number, locale: Locale): ReadingStat {
  return readingStat("monthlyQuota", `${used} / ${limit}`, locale, {
    tone: limit > 0 && used >= limit ? "winner" : "neutral",
  });
}
