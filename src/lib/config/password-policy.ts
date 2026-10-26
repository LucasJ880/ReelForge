/**
 * 账号密码规则（注册与密码找回同一口径）：至少 8 位、最多 128 位，bcrypt 12 轮。
 *
 * 纯常量与纯函数：客户端表单可以直接引用（不碰服务端模块）。注册路由
 * src/app/api/auth/register/route.ts 目前把同样的 8 / 128 / 12 写在 zod 与 bcrypt 调用里，
 * tests/password-reset.test.ts 守着两边不漂移。
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_BCRYPT_COST = 12;

export type PasswordPolicyViolation = "too_short" | "too_long";

export function passwordPolicyViolation(password: string): PasswordPolicyViolation | null {
  if (password.length < PASSWORD_MIN_LENGTH) return "too_short";
  if (password.length > PASSWORD_MAX_LENGTH) return "too_long";
  return null;
}
