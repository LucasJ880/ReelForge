import type { Prisma, UsageResource } from "@prisma/client";
import type { Session } from "next-auth";
import { QUOTA_LIMITS, REGISTER_RATE_LIMIT, type QuotaPlanId } from "@/lib/config/quota-tiers";
import { db } from "@/lib/db";
import { isStripeConfigured } from "@/lib/services/stripe-billing-service";

export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED" as const;
  readonly resource: UsageResource;
  readonly used: number;
  readonly limit: number;
  readonly periodKey: string;

  constructor(params: {
    resource: UsageResource;
    used: number;
    limit: number;
    periodKey: string;
  }) {
    super(userMessageForQuota(params.resource));
    this.name = "QuotaExceededError";
    this.resource = params.resource;
    this.used = params.used;
    this.limit = params.limit;
    this.periodKey = params.periodKey;
  }
}

export class RateLimitExceededError extends Error {
  readonly code = "RATE_LIMIT_EXCEEDED" as const;

  constructor(message = "操作过于频繁，请稍后再试") {
    super(message);
    this.name = "RateLimitExceededError";
  }
}

export function isQuotaEnforced(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.QUOTA_ENFORCE === "true") return true;
  if (process.env.QUOTA_ENFORCE === "false") return false;
  /// dev 默认关闭，避免 walkthrough 误触；设 QUOTA_ENFORCE=true 可本地测
  return false;
}

export function isQuotaExemptSession(session: Session): boolean {
  const userType = session.user.userType;
  if (userType === "OPERATOR" || userType === "SUPER_ADMIN") return true;
  const role = session.user.role;
  if (role === "SUPER_ADMIN") return true;
  return false;
}

export function currentUsagePeriodKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function resolveQuotaPlan(userId: string): Promise<QuotaPlanId> {
  if (!isStripeConfigured()) return "free";
  try {
    const user = await db.adminUser.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true },
    });
    if (user?.subscriptionTier === "pro") return "pro";
  } catch (err) {
    console.warn("[resolveQuotaPlan] using free tier fallback", err);
  }
  return "free";
}

export function getLimitForResource(
  plan: QuotaPlanId,
  resource: UsageResource,
): number {
  return QUOTA_LIMITS[plan][resource];
}

export interface UsageMeterSnapshot {
  resource: UsageResource;
  used: number;
  limit: number;
  remaining: number;
  periodKey: string;
}

export async function getUsageSummary(userId: string): Promise<{
  plan: QuotaPlanId;
  periodKey: string;
  meters: UsageMeterSnapshot[];
}> {
  const plan = await resolveQuotaPlan(userId);
  const periodKey = currentUsagePeriodKey();
  const resources = Object.keys(QUOTA_LIMITS[plan]) as UsageResource[];

  const rows = await db.userUsagePeriod.findMany({
    where: { userId, periodKey },
  });
  const byResource = new Map(rows.map((r) => [r.resource, r.amount]));

  const meters = resources.map((resource) => {
    const limit = getLimitForResource(plan, resource);
    const used = byResource.get(resource) ?? 0;
    return {
      resource,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      periodKey,
    };
  });

  return { plan, periodKey, meters };
}

/**
 * 检查配额；enforce=true 时原子扣减并写 UsageLog。
 */
export async function consumeUsage(params: {
  userId: string;
  resource: UsageResource;
  amount?: number;
  enforce?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<UsageMeterSnapshot> {
  const amount = params.amount ?? 1;
  const enforce = params.enforce ?? isQuotaEnforced();
  const plan = await resolveQuotaPlan(params.userId);
  const periodKey = currentUsagePeriodKey();
  const limit = getLimitForResource(plan, params.resource);

  if (!enforce) {
    return {
      resource: params.resource,
      used: 0,
      limit,
      remaining: limit,
      periodKey,
    };
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.userUsagePeriod.findUnique({
      where: {
        userId_periodKey_resource: {
          userId: params.userId,
          periodKey,
          resource: params.resource,
        },
      },
    });

    const used = existing?.amount ?? 0;
    if (used + amount > limit) {
      throw new QuotaExceededError({
        resource: params.resource,
        used,
        limit,
        periodKey,
      });
    }

    const updated = await tx.userUsagePeriod.upsert({
      where: {
        userId_periodKey_resource: {
          userId: params.userId,
          periodKey,
          resource: params.resource,
        },
      },
      create: {
        userId: params.userId,
        periodKey,
        resource: params.resource,
        amount,
      },
      update: { amount: { increment: amount } },
    });

    await tx.usageLog.create({
      data: {
        userId: params.userId,
        resource: params.resource,
        amount,
        metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    return {
      resource: params.resource,
      used: updated.amount,
      limit,
      remaining: Math.max(0, limit - updated.amount),
      periodKey,
    };
  });
}

export async function assertQuotaForSession(
  session: Session,
  resource: UsageResource,
  amount = 1,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (isQuotaExemptSession(session)) return;
  await consumeUsage({
    userId: session.user.id,
    resource,
    amount,
    metadata,
  });
}

/** 一次请求扣多种资源（如 dispatch = 1 次视频 + N 个 Seedance 段） */
export async function assertQuotaBatchForSession(
  session: Session,
  items: Array<{
    resource: UsageResource;
    amount?: number;
    metadata?: Record<string, unknown>;
  }>,
): Promise<void> {
  if (isQuotaExemptSession(session)) return;
  if (items.length === 0) return;

  const enforce = isQuotaEnforced();
  if (!enforce) return;

  const userId = session.user.id;
  const plan = await resolveQuotaPlan(userId);
  const periodKey = currentUsagePeriodKey();

  await db.$transaction(async (tx) => {
    for (const item of items) {
      const amount = item.amount ?? 1;
      const limit = getLimitForResource(plan, item.resource);
      const existing = await tx.userUsagePeriod.findUnique({
        where: {
          userId_periodKey_resource: {
            userId,
            periodKey,
            resource: item.resource,
          },
        },
      });
      const used = existing?.amount ?? 0;
      if (used + amount > limit) {
        throw new QuotaExceededError({
          resource: item.resource,
          used,
          limit,
          periodKey,
        });
      }
    }

    for (const item of items) {
      const amount = item.amount ?? 1;
      await tx.userUsagePeriod.upsert({
        where: {
          userId_periodKey_resource: {
            userId,
            periodKey,
            resource: item.resource,
          },
        },
        create: {
          userId,
          periodKey,
          resource: item.resource,
          amount,
        },
        update: { amount: { increment: amount } },
      });
      await tx.usageLog.create({
        data: {
          userId,
          resource: item.resource,
          amount,
          metadata: (item.metadata ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
        },
      });
    }
  });
}

function hourlyWindowKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}`;
}

function dailyWindowKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 注册限流：IP 每小时 + 邮箱每天（成功注册前只计 IP）。
 */
export async function assertRegisterRateLimit(params: {
  ip: string | null;
  email: string;
}): Promise<void> {
  if (!isQuotaEnforced() && process.env.NODE_ENV !== "production") {
    return;
  }

  const ip = params.ip?.trim() || "unknown";
  const email = params.email.trim().toLowerCase();

  await bumpRateLimit(`register:ip:${ip}`, hourlyWindowKey(), REGISTER_RATE_LIMIT.perIpPerHour);
  await bumpRateLimit(
    `register:email:${email}`,
    dailyWindowKey(),
    REGISTER_RATE_LIMIT.perEmailPerDay,
  );
}

async function bumpRateLimit(
  bucketKey: string,
  windowKey: string,
  max: number,
): Promise<void> {
  const row = await db.rateLimitBucket.upsert({
    where: { bucketKey_windowKey: { bucketKey, windowKey } },
    create: { bucketKey, windowKey, count: 1 },
    update: { count: { increment: 1 } },
  });

  if (row.count > max) {
    throw new RateLimitExceededError();
  }
}

function userMessageForQuota(resource: UsageResource): string {
  switch (resource) {
    case "VIDEO_DISPATCH":
      return "本月视频生成次数已用完。可在「用量与账单」查看额度，或下月再试。";
    case "PLAN_PREVIEW":
      return "本月方案预览次数已用完，请稍后再试或精简描述后直接生成。";
    case "BLOB_UPLOAD_BYTES":
      return "本月素材上传流量已达上限，请压缩文件或下月再试。";
    case "SEEDANCE_SEGMENT":
      return "本月 AI 画面生成额度已用完，请下月再试或联系客服。";
    default:
      return "本月用量已达上限，请稍后再试。";
  }
}

export const __test__ = {
  currentUsagePeriodKey,
  hourlyWindowKey,
  dailyWindowKey,
  isQuotaEnforced,
  isQuotaExemptSession,
};
