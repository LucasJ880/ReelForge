import { db } from "@/lib/db";
import type { User, UserPlanTier } from "@prisma/client";

export type PlanSource = "admin-manual" | "stripe" | "creem" | "none";

export interface GrantProInput {
  userId: string;
  /** 订阅天数，默认 30 */
  days?: number;
  /** 授予来源，用于审计 */
  source?: PlanSource;
  /** 授予方（管理员 id / webhook 事件 id 等） */
  grantedBy?: string | null;
}

/**
 * 为用户开通 / 续期 PRO。
 * - 若当前已是活跃 PRO，则从当前 `planExpiresAt` 基础上叠加 `days`；
 * - 否则从 `now` 开始计算。
 */
export async function grantPro(input: GrantProInput): Promise<User> {
  const days = input.days ?? 30;
  const now = Date.now();

  const current = await db.user.findUnique({
    where: { id: input.userId },
    select: { planTier: true, planExpiresAt: true },
  });
  if (!current) throw new Error("用户不存在");

  const baseTs =
    current.planTier === "PRO" &&
    current.planExpiresAt &&
    current.planExpiresAt.getTime() > now
      ? current.planExpiresAt.getTime()
      : now;

  const expires = new Date(baseTs + days * 24 * 60 * 60 * 1000);

  return db.user.update({
    where: { id: input.userId },
    data: {
      planTier: "PRO" satisfies UserPlanTier,
      planExpiresAt: expires,
      planGrantedBy: input.grantedBy ?? null,
      planGrantedAt: new Date(),
      planSource: input.source ?? "admin-manual",
    },
  });
}

export interface RevokeProInput {
  userId: string;
  grantedBy?: string | null;
}

/**
 * 立即撤销 PRO，将用户降级为 FREE。保留审计字段供回溯。
 */
export async function revokePro(input: RevokeProInput): Promise<User> {
  return db.user.update({
    where: { id: input.userId },
    data: {
      planTier: "FREE" satisfies UserPlanTier,
      planExpiresAt: null,
      planSource: "none",
      planGrantedBy: input.grantedBy ?? null,
      planGrantedAt: new Date(),
    },
  });
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "ADMIN";
  planTier: "FREE" | "PRO";
  planExpiresAt: string | null;
  planSource: string;
  createdAt: string;
}

export async function listUsersForAdmin(search?: string): Promise<AdminUserRow[]> {
  const rows = await db.user.findMany({
    where: search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      planTier: true,
      planExpiresAt: true,
      planSource: true,
      createdAt: true,
    },
  });

  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    planTier: u.planTier,
    planExpiresAt: u.planExpiresAt ? u.planExpiresAt.toISOString() : null,
    planSource: u.planSource,
    createdAt: u.createdAt.toISOString(),
  }));
}
