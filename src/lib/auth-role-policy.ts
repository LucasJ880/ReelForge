export type AccountRole = "SUPER_ADMIN" | "OPERATOR" | "REVIEWER" | "CUSTOMER";
export type AccountUserType = "BUSINESS" | "PERSONAL" | "OPERATOR" | "SUPER_ADMIN";

/**
 * 「2026-07-20 统一开放」只针对客户侧功能（generation / platform / brand
 * packaging，见 requireUserOfTypeForGeneration），不放宽内部运营面：
 * internal 页面、operator API、供应商 route 发现仍只对内部 staff 开放，
 * 与 requireOperator（requireRole(["SUPER_ADMIN","OPERATOR"])）保持一致。
 */
export function isInternalRole(role: AccountRole | null | undefined): boolean {
  return role === "SUPER_ADMIN" || role === "OPERATOR";
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
