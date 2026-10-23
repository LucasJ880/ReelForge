import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isInternalRole } from "@/lib/auth-role-policy";
import { resolveClientLockProfile } from "@/lib/video-generation/client-lock-profiles";

/**
 * 全局品牌包（目前只有 SunnyShutter：真实客户的 logo、电话、地址）谁能看、谁能用。
 *
 * 0724 定的是「所有用户可选」，作为客户展示墙。2026-10-23 起转向公开获客，
 * 任何陌生人注册后都能把真实客户的电话和地址印进自己的视频，这是冒用风险，
 * 改为默认只给：内部员工（SUPER_ADMIN / OPERATOR）+ `GLOBAL_BRAND_PACKAGE_USERS`
 * 名单里的账号（逗号分隔，写 user id 或邮箱都行）。
 * `GLOBAL_BRAND_PACKAGES_OPEN=1` 可恢复 0724 的全员可见。
 *
 * 列表、按 id 取包、取包里的素材、内容计划套用视觉配方，以及「自填品牌名触发
 * 客户锁」，都必须走同一个权限，否则任何一处都能把全局包「借」出去。
 */

export function globalBrandPackageUsers(): string[] {
  return (process.env.GLOBAL_BRAND_PACKAGE_USERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (value.includes("@") ? value.toLowerCase() : value));
}

export function decideGlobalBrandPackageAccess(args: {
  userId: string;
  email?: string | null;
  role: Parameters<typeof isInternalRole>[0];
  open?: boolean;
  allowedUsers?: readonly string[];
}): boolean {
  if (args.open ?? process.env.GLOBAL_BRAND_PACKAGES_OPEN === "1") return true;
  const allowed = args.allowedUsers ?? globalBrandPackageUsers();
  if (allowed.includes(args.userId)) return true;
  if (args.email && allowed.includes(args.email.trim().toLowerCase())) return true;
  return isInternalRole(args.role);
}

export async function canUseGlobalBrandPackages(userId: string): Promise<boolean> {
  /// 开关和 id 名单不需要查库，先判；都不中再查角色和邮箱。
  if (decideGlobalBrandPackageAccess({ userId, role: null })) return true;
  const user = await db.adminUser.findUnique({
    where: { id: userId },
    select: { role: true, email: true },
  });
  return decideGlobalBrandPackageAccess({
    userId,
    email: user?.email ?? null,
    role: user?.role ?? null,
  });
}

/// 某个用户能看到的品牌包范围：自己工作区的包，加上（有权限时）全局包。
export function brandPackageScopeFor(
  userId: string,
  includeGlobal: boolean,
): Prisma.WorkspaceBrandPackageWhereInput[] {
  const own: Prisma.WorkspaceBrandPackageWhereInput = {
    workspace: { ownerId: userId },
  };
  return includeGlobal ? [own, { isGlobal: true }] : [own];
}

export async function visibleBrandPackageScope(
  userId: string,
): Promise<Prisma.WorkspaceBrandPackageWhereInput[]> {
  return brandPackageScopeFor(userId, await canUseGlobalBrandPackages(userId));
}

/**
 * 请求里自填的品牌名会被 resolveClientLockProfile 推断成客户锁（如 "Sunny Shutters"
 * → SunnyShutter），尾卡随即锁成该客户的真实电话、地址和设计尾卡。合法流程也是这样
 * 走的（选中全局包 → 前端只传品牌名），所以不能去掉推断，只能在入口按同一个权限拦。
 */
export async function canUseRequestedBrandName(
  userId: string,
  brandName: string | null | undefined,
): Promise<boolean> {
  if (resolveClientLockProfile({ brandName }) === null) return true;
  return canUseGlobalBrandPackages(userId);
}
