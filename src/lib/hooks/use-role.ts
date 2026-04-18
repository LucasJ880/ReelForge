"use client";

import { useSession } from "next-auth/react";

export function useIsAdmin(): boolean {
  const { data: session, status } = useSession();
  if (status === "loading") return false;
  return session?.user?.role === "ADMIN";
}

export function useRole(): "ADMIN" | "USER" | null {
  const { data: session } = useSession();
  return session?.user?.role ?? null;
}

/**
 * 当前用户是否具备生成能力（ADMIN 或活跃 PRO 订阅）
 */
export function useIsPro(): boolean {
  const { data: session, status } = useSession();
  if (status === "loading") return false;
  if (!session?.user) return false;
  if (session.user.role === "ADMIN") return true;
  if (session.user.planTier !== "PRO") return false;
  const exp = session.user.planExpiresAt;
  return !!exp && new Date(exp).getTime() > Date.now();
}

export interface SubscriptionView {
  tier: "FREE" | "PRO" | "ADMIN";
  expiresAt: Date | null;
  daysLeft: number | null;
  isActive: boolean;
}

/**
 * 用户订阅状态的聚合视图，供 /settings/billing、pricing、dashboard 等展示用。
 */
export function useSubscription(): SubscriptionView {
  const { data: session } = useSession();
  if (!session?.user) {
    return { tier: "FREE", expiresAt: null, daysLeft: null, isActive: false };
  }

  if (session.user.role === "ADMIN") {
    return { tier: "ADMIN", expiresAt: null, daysLeft: null, isActive: true };
  }

  const expiresAt = session.user.planExpiresAt
    ? new Date(session.user.planExpiresAt)
    : null;
  const isActive =
    session.user.planTier === "PRO" &&
    !!expiresAt &&
    expiresAt.getTime() > Date.now();

  const days =
    expiresAt == null
      ? null
      : Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

  return {
    tier: isActive ? "PRO" : "FREE",
    expiresAt,
    daysLeft: days,
    isActive,
  };
}
