export type AccountRole = "SUPER_ADMIN" | "OPERATOR" | "REVIEWER" | "CUSTOMER";
export type AccountUserType = "BUSINESS" | "PERSONAL" | "OPERATOR" | "SUPER_ADMIN";

/**
 * 2026-07-20 产品决策：系统定位是给电商公司的通用运营服务，功能对所有
 * 登录用户统一开放，不按角色隐藏功能。角色字段保留用于审计/展示，不再门禁。
 */
export function isInternalRole(role: AccountRole | null | undefined): boolean {
  return role != null;
}

/**
 * System role is the authorization source of truth. Legacy customer persona
 * values remain useful for CUSTOMER routing, but cannot demote staff or
 * promote a customer into internal operations.
 */
export function normalizeUserTypeForRole(
  userType: string | null | undefined,
  role: AccountRole,
): AccountUserType | null {
  if (role === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (role === "OPERATOR") return "OPERATOR";
  if (userType === "BUSINESS" || userType === "PERSONAL") return userType;
  return null;
}

export type InternalAccessDecision =
  | "allow"
  | "login"
  | "customer-business"
  | "customer-personal"
  | "deny";

export function decideInternalAccess(args: {
  authenticated: boolean;
  role: AccountRole | null | undefined;
  userType: AccountUserType | null | undefined;
}): InternalAccessDecision {
  if (!args.authenticated || !args.role) return "login";
  if (isInternalRole(args.role)) return "allow";
  if (args.userType === "BUSINESS") return "customer-business";
  if (args.userType === "PERSONAL") return "customer-personal";
  return "deny";
}
