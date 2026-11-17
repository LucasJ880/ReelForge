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
export type ReadingSource = "pulse" | "readings" | "usage";

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
  generating: def("生成中", "Generating", "视频模型正在生成的视频条数", "Videos the video model is rendering now", "pulse", "live"),
  queued: def("排队中", "Queued", "已下单、还没开始生成的视频", "Ordered videos not started yet", "pulse", "neutral"),
  needsAttention: def("需要处理", "Needs attention", "近 7 天未重试成功、还没看过的失败视频", "Unreviewed failures from the last 7 days", "pulse", "fault"),
  filled24h: def("近 24 小时成片", "Ready · last 24 h", "已成片的视频，不含图文帖", "Ready videos; posts excluded", "readings", "filled"),
  filled7d: def("近 7 天成片", "Ready · last 7 days", "已成片的视频，不含图文帖", "Ready videos; posts excluded", "readings", "filled"),
  filled30d: def("近 30 天成片", "Ready · last 30 days", "已成片的视频，不含图文帖", "Ready videos; posts excluded", "readings", "filled"),
  failed7d: def("近 7 天失败", "Failed · last 7 days", "失败的视频，取消不算失败", "Failed videos; cancels excluded", "readings", "fault"),
  successRate7d: def("近 7 天成片率", "Success rate · 7 days", "成片 ÷（成片 + 失败）", "Ready ÷ (ready + failed)", "readings", "neutral"),
  finished: def("成品", "Finished", "全部已成片视频 + 已出图的图文帖", "All ready videos + posts with images", "readings", "filled"),
  /// 2026-11-10：成品库第三格之前恒为「—」、说明还写着已停用的品牌封装；换成真实读数
  publishRegistered: def("已登记发布", "Publish logged", "在抖音发布包里登记过发布的成片（撤销的不算）", "Videos with a publish logged in the Douyin kit (withdrawn ones excluded)", "readings", "filled"),
  monthlyQuota: def("本月额度", "This month", "已用（含生成中）÷ 套餐上限 · UTC 自然月 · 失败与取消返还", "Used (incl. in progress) ÷ plan limit · UTC month · failures and cancels refunded", "usage", "neutral"),
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
