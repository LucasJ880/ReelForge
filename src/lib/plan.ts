import type { UserRole, UserPlanTier } from "@prisma/client";

export interface PlanAware {
  role: UserRole;
  planTier: UserPlanTier;
  planExpiresAt: Date | null;
}

/**
 * 是否当前拥有 Pro 的能力（创建/生成/批量）。
 * ADMIN 始终视同 Pro；其他用户必须 planTier=PRO 且未到期。
 */
export function isProActive(user: PlanAware | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  if (user.planTier !== "PRO") return false;
  return !!user.planExpiresAt && user.planExpiresAt.getTime() > Date.now();
}

/**
 * 用于前端展示用户当前的"有效套餐"（不关心 role，仅看订阅）。
 */
export function effectiveTier(user: PlanAware | null | undefined): "FREE" | "PRO" | "ADMIN" {
  if (!user) return "FREE";
  if (user.role === "ADMIN") return "ADMIN";
  if (user.planTier === "PRO" && user.planExpiresAt && user.planExpiresAt.getTime() > Date.now()) {
    return "PRO";
  }
  return "FREE";
}

/**
 * 剩余天数（四舍五入向上；0 表示今天到期；负数表示已过期；null 表示永不过期/未开通）。
 */
export function daysLeft(user: PlanAware | null | undefined): number | null {
  if (!user?.planExpiresAt) return null;
  const ms = user.planExpiresAt.getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}
