/**
 * 行业 → 默认创意主题映射。
 *
 * 用途：
 * - Director / Angle 服务在 LLM user prompt 中给出 industry-specific 提示，
 *   让 LLM 优先采用该行业最容易出爆款的探索主题。
 * - 仅作为「软提示」（hint），最终主题选择仍由 pickExplorationThemes 决定，
 *   避免破坏赛马模型的多样性。
 *
 * 注意：
 * - 这里**不**重写 BLANKET_THEME_POOL；只是按行业筛选 / 排序。
 * - 未在映射中的行业会回退到完整的 BLANKET_THEME_POOL（即「general」语义）。
 */

import {
  BLANKET_THEME_POOL,
  type ExplorationTheme,
} from "@/lib/config/blanket-themes";
import type { CreativeIndustry } from "@/lib/schemas/creative-evidence";

/**
 * 不同行业偏好的探索主题 key 顺序。
 * 顺序很重要：靠前的会被认为是该行业最稳的「保底主题」。
 */
const INDUSTRY_THEME_KEYS: Partial<Record<CreativeIndustry, string[]>> = {
  /// 家居用品（毛毯、家纺、智能家居硬件等）
  /// 经验：proof_closeup（材质细节）+ before_after（旧→新）+ problem_solution + emotional_moment
  /// 比 ugc_review 更容易在前 3 秒抓住注意力
  home_goods: [
    "proof_closeup",
    "before_after",
    "problem_solution",
    "emotional_moment",
    "ugc_review",
    "pattern_interrupt",
  ],
  /// 家居装饰（窗帘、地毯、灯饰等软装）—— 与 home_goods 同源，
  /// 但 emotional_moment 权重更高（"看的就是氛围感"）
  home_decor: [
    "emotional_moment",
    "before_after",
    "proof_closeup",
    "problem_solution",
    "pattern_interrupt",
    "ugc_review",
  ],
  /// 房地产 —— before_after（staging）+ proof_closeup（房屋细节）+ emotional_moment（家庭场景）
  real_estate: [
    "before_after",
    "proof_closeup",
    "emotional_moment",
    "problem_solution",
    "ugc_review",
    "pattern_interrupt",
  ],
  /// 宠物 —— pattern_interrupt（宠物反差）+ emotional_moment + ugc_review 最有效
  pet_business: [
    "pattern_interrupt",
    "emotional_moment",
    "ugc_review",
    "before_after",
    "proof_closeup",
    "problem_solution",
  ],
  /// 餐饮 —— proof_closeup（出餐特写）+ ugc_review + emotional_moment
  restaurant: [
    "proof_closeup",
    "ugc_review",
    "emotional_moment",
    "pattern_interrupt",
    "problem_solution",
    "before_after",
  ],
  /// 本地服务 —— ugc_review（顾客证言）+ before_after + problem_solution
  local_service: [
    "ugc_review",
    "before_after",
    "problem_solution",
    "proof_closeup",
    "emotional_moment",
    "pattern_interrupt",
  ],
};

/**
 * 返回该行业偏好的主题列表（按权重排序），用于 LLM hint 与默认推荐。
 *
 * - 已知行业 → 按 INDUSTRY_THEME_KEYS 顺序返回；任何 pool 中存在但 key 列表里未列出的
 *   主题会拼接到最后，保证调用方仍能拿到完整 pool（避免遗漏）。
 * - 未知行业 / general → 直接返回完整 pool（不排序）。
 */
export function getDefaultThemesForIndustry(
  industry: string | null | undefined,
): ExplorationTheme[] {
  if (!industry) return [...BLANKET_THEME_POOL];
  const keys = INDUSTRY_THEME_KEYS[industry as CreativeIndustry];
  if (!keys) return [...BLANKET_THEME_POOL];

  const orderedKeys = [...keys];
  for (const t of BLANKET_THEME_POOL) {
    if (!orderedKeys.includes(t.key)) orderedKeys.push(t.key);
  }
  return orderedKeys
    .map((k) => BLANKET_THEME_POOL.find((t) => t.key === k))
    .filter((t): t is ExplorationTheme => !!t);
}

/**
 * 取该行业的 top N 主题 key，便于直接写入 prompt 字符串。
 * 默认 N=4（够 LLM 采样且不会喧宾夺主）。
 */
export function getTopThemeKeysForIndustry(
  industry: string | null | undefined,
  count = 4,
): string[] {
  return getDefaultThemesForIndustry(industry)
    .slice(0, Math.max(1, count))
    .map((t) => t.key);
}
