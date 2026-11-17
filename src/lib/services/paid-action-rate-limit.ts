import { isQuotaEnforced } from "./quota-service";
import { bumpRateLimit, hourlyWindowKey } from "./rate-limit-service";

/**
 * 付费入口的「按用户直接发起次数」限流（D5 / A4 5.2）。
 *
 * 这些入口不走月度计量，但每次都会真实花钱（LLM）或占用合成器函数。注册是公开的，没有这一层，
 * 任何账号都能用脚本把费用刷穿（bughunt #5）。
 * 2026-11-16：「内容计划」「图文出图」两个入口随「本周内容」删除，表里只剩抖音发布包的两条。
 *
 * 口径：
 * - 只在路由里、用户直接发起的那一下计数；批量内部调用与系统重试不走这里。
 * - 每用户每小时一个桶，bucketKey 带 `paid:` 前缀，不与其他限流桶撞名。
 * - 与产品图一致：开发环境不强制（QUOTA_ENFORCE=true 可本地验证），生产一律强制。
 * - 上限可用环境变量按入口覆盖（1–200），便于线上临时放宽或收紧，不用发版。
 */
export const PAID_ACTION_RATE_LIMITS = {
  /// 抖音发布包起文案：一次 fast 档 LLM
  "douyin-kit-copy": {
    perHour: 30,
    envKey: "DOUYIN_KIT_COPY_RATE_LIMIT_PER_HOUR",
    message: "文案生成过于频繁，请一小时后再试，或直接手动填写。",
  },
  /// 抖音发布包导出素材：函数内 ffmpeg 再编码一次成片 + 封面合成（不调任何生成供应商）
  "douyin-kit-render": {
    perHour: 30,
    envKey: "DOUYIN_KIT_RENDER_RATE_LIMIT_PER_HOUR",
    message: "发布素材生成过于频繁，请一小时后再试。",
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
