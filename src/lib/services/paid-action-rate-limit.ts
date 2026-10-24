import { isQuotaEnforced } from "./quota-service";
import { bumpRateLimit, hourlyWindowKey } from "./rate-limit-service";

/**
 * 付费入口的「按用户直接发起次数」限流（D5 / A4 5.2）。
 *
 * 这些入口不走月度计量（生成一周计划不收费、出图失败零计费……），但每次都会真实
 * 花钱：LLM、gpt-image、Firecrawl、remove.bg、TTS。注册是公开的，没有这一层，
 * 任何账号都能用脚本把供应商费用刷穿（bughunt #5）。
 *
 * 口径：
 * - 只在路由里、用户直接发起的那一下计数；批量内部调用与系统重试不走这里。
 * - 幂等短路（已出过图、READY 直接返回）尽量不计数——出图在拿到渲染锁之后才计。
 * - 每用户每小时一个桶，bucketKey 带 `paid:` 前缀，不与其他限流桶撞名。
 * - 与产品图一致：开发环境不强制（QUOTA_ENFORCE=true 可本地验证），生产一律强制。
 * - 上限可用环境变量按入口覆盖（1–200），便于线上临时放宽或收紧，不用发版。
 */
export const PAID_ACTION_RATE_LIMITS = {
  /// 一句话排一周：一次 LLM（链接 / 产品图来源还要多一次抓取或读图）
  "content-plan": {
    perHour: 10,
    envKey: "CONTENT_PLAN_RATE_LIMIT_PER_HOUR",
    message: "内容计划生成过于频繁，请一小时后再试。",
  },
  /// 图文出图：每次 1 张（单图）到 6 张（轮播）gpt-image
  "content-post-render": {
    perHour: 20,
    envKey: "CONTENT_POST_RENDER_RATE_LIMIT_PER_HOUR",
    message: "配图生成过于频繁，请一小时后再试。",
  },
  /// 商品链接抓取：直抓免费，兜底走 Firecrawl 按次计费
  "product-link": {
    perHour: 20,
    envKey: "PRODUCT_LINK_RATE_LIMIT_PER_HOUR",
    message: "链接抓取过于频繁，请一小时后再试，或直接用一句话描述你的产品。",
  },
  /// 产品锚点：新建与抠图续跑共用一个桶（remove.bg 按张计费）
  "product-anchor": {
    perHour: 10,
    envKey: "PRODUCT_ANCHOR_RATE_LIMIT_PER_HOUR",
    message: "产品抠图操作过于频繁，请一小时后再试。",
  },
  /// 实拍图库线路：LLM 拆段 + 逐段 TTS + 合成
  broll: {
    perHour: 6,
    envKey: "BROLL_RATE_LIMIT_PER_HOUR",
    message: "实拍图库成片提交过于频繁，请一小时后再试。",
  },
} as const;

export type PaidAction = keyof typeof PAID_ACTION_RATE_LIMITS;

const MIN_PER_HOUR = 1;
const MAX_PER_HOUR = 200;

export function paidActionHourlyLimit(
  action: PaidAction,
  env: Record<string, string | undefined> = process.env,
): number {
  const config = PAID_ACTION_RATE_LIMITS[action];
  const configured = Number.parseInt(env[config.envKey] ?? "", 10);
  const value = Number.isFinite(configured) ? configured : config.perHour;
  return Math.max(MIN_PER_HOUR, Math.min(value, MAX_PER_HOUR));
}

export function paidActionBucketKey(action: PaidAction, userId: string): string {
  return `paid:${action}:user:${userId}`;
}

/**
 * 计一次并在超限时抛 RateLimitExceededError（路由用 quotaErrorResponse 转 429）。
 */
export async function assertPaidActionRateLimit(params: {
  action: PaidAction;
  userId: string;
  now?: Date;
}): Promise<void> {
  if (!isQuotaEnforced() && process.env.NODE_ENV !== "production") return;
  await bumpRateLimit(
    paidActionBucketKey(params.action, params.userId),
    hourlyWindowKey(params.now),
    paidActionHourlyLimit(params.action),
    PAID_ACTION_RATE_LIMITS[params.action].message,
  );
}
