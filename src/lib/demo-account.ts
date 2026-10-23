/**
 * 演示账号守卫（铁律 #4：demo 账号不跑付费生成）。
 *
 * 2026-10-23 审计发现演示账号的密码曾以明文打进客户端登录页，而单条、批量、产品图、
 * 故事板等付费入口都不拦它——任何访客都能一键登录、用公司的钱生成，产物还会
 * 作为「客户样片」注入所有用户的成品库。这里把判定收成一处：
 *
 * - 生产环境禁止演示账号登录；已签发的演示会话由 middleware 当作未登录处理，
 *   不依赖轮换 AUTH_SECRET 才生效。
 * - 非生产环境只有显式 `ALLOW_DEMO_LOGIN=1` 才放行（本地 e2e 用），且放行后
 *   仍是只读：任何 `/api/*` 写请求一律 403 DEMO_BLOCKED。
 *
 * 本文件会被 middleware（Edge runtime）引用：不得 import db 或任何 Node-only 模块。
 */

const DEFAULT_DEMO_ACCOUNT_EMAILS = ["demo@aivora.app"] as const;

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/// 默认名单永远生效；`DEMO_ACCOUNT_EMAILS` 只能追加，不能把默认账号移出名单。
export function demoAccountEmails(): string[] {
  const extra = (process.env.DEMO_ACCOUNT_EMAILS ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
  return [...new Set([...DEFAULT_DEMO_ACCOUNT_EMAILS, ...extra])];
}

export function isDemoAccountEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return demoAccountEmails().includes(normalizeEmail(email));
}

/// 生产环境无论怎么配置都返回 false（fail-closed）。
export function isDemoLoginAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_DEMO_LOGIN === "1"
  );
}

/// RFC 2606 / 6761 保留的测试顶级域。脚本曾用写死口令在生产库里建过
/// `*@aivora.test` 的 OPERATOR 账号，这类账号在真实生产里一律不许登录。
const RESERVED_TEST_TLDS = [".test", ".invalid", ".example", ".localhost"] as const;

export function isReservedTestEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = normalizeEmail(email).split("@")[1] ?? "";
  return RESERVED_TEST_TLDS.some((tld) => domain.endsWith(tld));
}

/// 非生产环境放行；`next start` 的本地验收演练（AIVORA_DRY_RUN=1 且不是
/// VERCEL_ENV=production）也放行，与 mock 泄漏守卫同一判据，真实生产 fail-closed。
export function isTestAccountLoginAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return (
    process.env.AIVORA_DRY_RUN === "1" &&
    process.env.VERCEL_ENV !== "production"
  );
}

export type DemoAccessDecision = "allow" | "unauthenticated" | "blocked";

/**
 * middleware 对一个已带会话的请求做的判定（纯函数，便于单测）：
 * - 保留测试域名账号且当前环境不允许 → unauthenticated（会话作废）
 * - 非演示账号 → allow
 * - 演示账号且当前环境不允许演示登录 → unauthenticated（会话作废）
 * - 演示账号对 `/api/*` 发写请求 → blocked
 */
export function decideDemoAccess(args: {
  email: string | null | undefined;
  method: string;
  pathname: string;
  loginAllowed?: boolean;
  testAccountLoginAllowed?: boolean;
}): DemoAccessDecision {
  if (
    isReservedTestEmail(args.email) &&
    !(args.testAccountLoginAllowed ?? isTestAccountLoginAllowed())
  ) {
    return "unauthenticated";
  }
  if (!isDemoAccountEmail(args.email)) return "allow";
  if (!(args.loginAllowed ?? isDemoLoginAllowed())) return "unauthenticated";
  if (
    args.pathname.startsWith("/api/") &&
    MUTATING_METHODS.has(args.method.toUpperCase())
  ) {
    return "blocked";
  }
  return "allow";
}

export const DEMO_BLOCKED_MESSAGE =
  "演示账号不能提交付费生成。注册一个自己的工作区即可体验完整流程。";

export function demoBlockedBody() {
  return {
    ok: false as const,
    code: "DEMO_BLOCKED" as const,
    error: DEMO_BLOCKED_MESSAGE,
    retryable: false,
  };
}
