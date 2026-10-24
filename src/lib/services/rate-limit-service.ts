import { createHash } from "node:crypto";
import { db } from "@/lib/db";

/**
 * 限流原语（与月度套餐额度分开）：按小时 / 按天的计数桶，存在 RateLimitBucket。
 * 只对「用户或访客直接发起」的入口计数——批量内部调用、系统重试不要走这里，
 * 否则一个批次就能把同一用户的单条操作锁住。
 */
export class RateLimitExceededError extends Error {
  readonly code = "RATE_LIMIT_EXCEEDED" as const;

  constructor(message = "操作过于频繁，请稍后再试") {
    super(message);
    this.name = "RateLimitExceededError";
  }
}

export function hourlyWindowKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}`;
}

export function dailyWindowKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function bumpRateLimit(
  bucketKey: string,
  windowKey: string,
  max: number,
  message?: string,
): Promise<void> {
  const row = await db.rateLimitBucket.upsert({
    where: { bucketKey_windowKey: { bucketKey, windowKey } },
    create: { bucketKey, windowKey, count: 1 },
    update: { count: { increment: 1 } },
  });

  if (row.count > max) {
    throw new RateLimitExceededError(message);
  }
}

/**
 * 访客标识的单向哈希：公开表单 / 追踪链接按它限流与去重，库里不存原始 IP。
 */
export function hashVisitorKey(raw: string | null | undefined): string {
  const salt = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "aivora";
  return createHash("sha256")
    .update(`${salt}:${(raw ?? "unknown").trim()}`)
    .digest("hex")
    .slice(0, 32);
}
