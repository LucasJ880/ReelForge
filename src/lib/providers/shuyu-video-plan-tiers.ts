/**
 * Shuyu 视频套餐分档(draft / final)的纯定义——**不依赖任何服务端模块**。
 *
 * 审计(shuyu.ts)、能力探针、两份契约(video-provider-routes / video-route-options)
 * 共用这一张表,保证「同一把尺子」。其中 video-route-options 会被 'use client' 的
 * 视频线路选择器引入,所以这里绝不能 import shuyu.ts(它带 capability-status-service
 * 等服务端模块图);shuyu.ts 反过来 re-export 这里的符号,调用方照旧从它导入。
 *
 * 2026-10-26(P03-A1):
 * - draft(720P/480P):默认档与客户可选档;默认永远是最便宜的 720P。
 * - final(1080P):审计放行,客户定价未定 → 对客户不可见、不可选;可用性判断
 *   (runtime / discovery / 探针)一律只看 draft 档——价目表只剩 1080P 等于默认线路停机。
 */
export type ShuyuVideoPlanTier = "draft" | "final";
export type ShuyuVideoPlanResolution = "480P" | "720P" | "1080P";
export type ShuyuVideoPlanBillingUnit = "generation" | "second";

/** 审计族排序:720P → 480P → 1080P;同档内再按 15s 有效成本升序(见 listAuditedShuyuVideoPlans)。 */
export const SHUYU_VIDEO_PLAN_RESOLUTION_RANK: Record<ShuyuVideoPlanResolution, number> = {
  "720P": 0,
  "480P": 1,
  "1080P": 2,
};

/** 对外清单的长度上限(两份契约与输出方同一个数;输出前截断,契约校验兜底)。 */
export const SHUYU_VIDEO_PLAN_LIST_MAX = 20;

/** 分辨率 → 档位的唯一映射(审计、排序、选档、客户面过滤共用)。 */
export function shuyuVideoPlanTier(
  resolution: ShuyuVideoPlanResolution,
): ShuyuVideoPlanTier {
  return resolution === "1080P" ? "final" : "draft";
}

/** 审计放行的分辨率白名单;其余(4K/1K/2K…)一律出族。 */
export function shuyuVideoPlanResolution(
  value: string,
): ShuyuVideoPlanResolution | null {
  return value === "720P" || value === "480P" || value === "1080P"
    ? value
    : null;
}

/**
 * 单价健全区间按分辨率分区(1026 实价:1080P 240 点/秒、4K 640 点/秒;4K 不在审计族内)。
 * 720P/480P 保持 0803 的现值;1080P 按秒 100–400、按条上限放宽到 8000。
 */
const DRAFT_POINT_SANITY = {
  generation: { min: 100, max: 2_000 },
  second: { min: 10, max: 300 },
} as const;
const VIDEO_PLAN_POINT_SANITY: Record<
  ShuyuVideoPlanResolution,
  Record<ShuyuVideoPlanBillingUnit, { readonly min: number; readonly max: number }>
> = {
  "720P": DRAFT_POINT_SANITY,
  "480P": DRAFT_POINT_SANITY,
  "1080P": {
    generation: { min: 100, max: 8_000 },
    second: { min: 100, max: 400 },
  },
};

/** 该分辨率 × 计费单位的单价健全区间(探针、契约与审计共用的那把尺子)。 */
export function shuyuVideoPlanPointBounds(
  resolution: ShuyuVideoPlanResolution,
  unit: ShuyuVideoPlanBillingUnit,
): { readonly min: number; readonly max: number } {
  return VIDEO_PLAN_POINT_SANITY[resolution][unit];
}

export function shuyuVideoPlanSalePointsWithinBounds(
  resolution: ShuyuVideoPlanResolution,
  unit: ShuyuVideoPlanBillingUnit,
  salePoints: number,
): boolean {
  const bounds = shuyuVideoPlanPointBounds(resolution, unit);
  return salePoints >= bounds.min && salePoints <= bounds.max;
}
