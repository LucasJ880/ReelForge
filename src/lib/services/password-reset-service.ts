import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { Locale } from "@/i18n/config";
import { PASSWORD_BCRYPT_COST, passwordPolicyViolation } from "@/lib/config/password-policy";
import { isDemoAccountEmail, isReservedTestEmail } from "@/lib/demo-account";
import {
  appBaseUrl,
  emailConfig,
  runAfterResponse,
  sendPasswordResetEmail,
  type NotifyOutcome,
} from "@/lib/services/notification-service";
import {
  bumpRateLimit,
  dailyWindowKey,
  hashVisitorKey,
  hashVisitorNetwork,
  hourlyWindowKey,
} from "@/lib/services/rate-limit-service";

/**
 * 密码找回（1025 整合轮）。
 *
 * 申请（requestPasswordReset）：
 *  - 永不透露邮箱是否注册：注册过、没注册、已停用，响应内容一样；查账号、写令牌、发信全部放到
 *    响应之后（runAfterResponse），连耗时也不随账号存在与否变化。
 *  - 限流先于一切账号查询：按访客网段每小时、按邮箱每小时 / 每天计数（桶键都是单向哈希，
 *    库里不存原始 IP 与邮箱）。429 对存在与不存在的邮箱一视同仁，同样不泄露账号。
 *  - 只有「发信没开通」（缺 RESEND_API_KEY / EMAIL_FROM / 站点根地址）返回 unavailable——
 *    这是全站配置，与具体账号无关；前端据此改为给联系邮箱。
 *  - 停用账号、演示账号（共享口令，重置会把所有人锁在外面）、保留测试域名账号（邮件投递不到）一律不发。
 *  - 令牌 32 字节随机数（base64url），库里只存 sha256；30 分钟有效；同一用户之前未用的链接
 *    在同一事务里写 usedAt 作废——只改状态，不删行（铁律：业务数据只归档不物理删除）。
 *
 * 确认（confirmPasswordReset）：
 *  - 校验存在、未用、未过期、账号未停用；bcrypt 12 轮（与注册同一口径，见 password-policy）。
 *  - 一个事务里先对 usedAt: null 做条件更新（CAS）占住令牌、再写新密码、再作废同一用户其余未用的链接；
 *    任何一步对不上就整体回滚。并发提交同一个令牌只有一个成功。
 *
 * 已知边界：JWT 会话无状态，重置密码不会让其它设备上已登录的会话失效（与停用账号的复核是两回事）。
 */

export const RESET_TOKEN_BYTES = 32;
export const RESET_TOKEN_TTL_MINUTES = 30;
export const RESET_TOKEN_TTL_MS = RESET_TOKEN_TTL_MINUTES * 60 * 1000;

/// 访客网段（IPv4 /24、IPv6 /48）每小时 10 次；同一邮箱每小时 3 次、每天 6 次（防邮件轰炸，也护住发信额度）
export const PASSWORD_RESET_RATE_LIMIT = {
  perNetworkPerHour: 10,
  perEmailPerHour: 3,
  perEmailPerDay: 6,
} as const;

const RATE_LIMIT_MESSAGE = "申请太频繁了，请稍后再试";

/// 32 字节的 base64url（无填充）正好 43 个字符
const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type PasswordResetDelivery = "email" | "unavailable";
export type PasswordResetFailure = "invalid_or_expired" | "weak_password";
export type ConfirmPasswordResetResult = { ok: true } | { ok: false; reason: PasswordResetFailure };
export type ResetTokenState = "valid" | "invalid";
/// 响应之后那一半的结果：只用于日志与测试，从不回给访客
export type PasswordResetIssueOutcome = "sent" | "skipped" | "send_failed";

export type ResetAccount = { id: string; email: string; disabledAt: Date | null };

export type ResetTokenRecord = {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
  userDisabledAt: Date | null;
};

/** 数据访问的窄接口：默认走 Prisma（prismaPasswordResetStore），测试注入内存实现。 */
export interface PasswordResetStore {
  findAccountByEmail(email: string): Promise<ResetAccount | null>;
  /** 同一事务：该用户所有未用的旧链接写 usedAt 作废，再写入新链接。 */
  issueToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestedIp: string | null;
    now: Date;
  }): Promise<void>;
  findToken(tokenHash: string): Promise<ResetTokenRecord | null>;
  /** CAS 消费：true = 本次把令牌从未用改成已用并写入了新密码；false = 令牌已被用掉 / 过期 / 账号停用。 */
  consumeToken(input: { tokenId: string; userId: string; hashedPassword: string; now: Date }): Promise<boolean>;
}

type SendResetEmail = (
  input: { to: string; link: string; locale: Locale; expiresInMinutes: number },
  deps: { env?: NodeJS.ProcessEnv },
) => Promise<NotifyOutcome>;

export type PasswordResetDeps = {
  store?: PasswordResetStore;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  rateLimit?: (bucketKey: string, windowKey: string, max: number, message?: string) => Promise<void>;
  /// 把「查账号 + 写令牌 + 发信」挪到响应之后；默认 runAfterResponse
  defer?: (task: () => Promise<unknown>) => void;
  sendEmail?: SendResetEmail;
  random?: (size: number) => Buffer;
  hashPassword?: (password: string) => Promise<string>;
};

/* ── 纯函数 ─────────────────────────────────────────────────────────── */

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateResetToken(random: (size: number) => Buffer = randomBytes): {
  token: string;
  tokenHash: string;
} {
  const token = random(RESET_TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashResetToken(token) };
}

export function isWellFormedResetToken(token: unknown): token is string {
  return typeof token === "string" && RESET_TOKEN_PATTERN.test(token);
}

export function resetTokenExpiresAt(now: Date): Date {
  return new Date(now.getTime() + RESET_TOKEN_TTL_MS);
}

/** 令牌此刻能不能用：存在、未用、未过期（到点即失效）、账号未停用。 */
export function resetTokenState(record: ResetTokenRecord | null, now: Date): ResetTokenState {
  if (!record) return "invalid";
  if (record.usedAt) return "invalid";
  if (record.expiresAt.getTime() <= now.getTime()) return "invalid";
  if (record.userDisabledAt) return "invalid";
  return "valid";
}

export function buildResetLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
}

export function normalizeResetEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 哪些账号收得到重置邮件：停用、演示（共享口令）、保留测试域名（投递不到）都不发。 */
export function isResettableAccount(account: ResetAccount): boolean {
  if (account.disabledAt) return false;
  if (isDemoAccountEmail(account.email)) return false;
  if (isReservedTestEmail(account.email)) return false;
  return true;
}

/* ── Prisma 实现 ────────────────────────────────────────────────────── */

export type PasswordResetPrismaClient = Pick<PrismaClient, "adminUser" | "passwordResetToken" | "$transaction">;

/// 事务里 CAS 没抢到：抛出它让 Prisma 回滚整笔事务
class ResetTokenNotClaimed extends Error {
  constructor() {
    super("password reset token was not claimed");
    this.name = "ResetTokenNotClaimed";
  }
}

export function prismaPasswordResetStore(client: PasswordResetPrismaClient = db): PasswordResetStore {
  return {
    findAccountByEmail(email) {
      return client.adminUser.findUnique({
        where: { email },
        select: { id: true, email: true, disabledAt: true },
      });
    },

    async issueToken({ userId, tokenHash, expiresAt, requestedIp, now }) {
      await client.$transaction(async (tx) => {
        /// 新链接一出，旧的未用链接全部作废（写 usedAt，不删行）
        await tx.passwordResetToken.updateMany({
          where: { userId, usedAt: null },
          data: { usedAt: now },
        });
        await tx.passwordResetToken.create({
          data: { userId, tokenHash, expiresAt, requestedIp },
        });
      });
    },

    async findToken(tokenHash) {
      const row = await client.passwordResetToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          usedAt: true,
          user: { select: { disabledAt: true } },
        },
      });
      return row
        ? {
            id: row.id,
            userId: row.userId,
            expiresAt: row.expiresAt,
            usedAt: row.usedAt,
            userDisabledAt: row.user.disabledAt,
          }
        : null;
    },

    async consumeToken({ tokenId, userId, hashedPassword, now }) {
      try {
        await client.$transaction(async (tx) => {
          /// CAS：只有「仍未用且未过期」的那一行能被占住；并发的第二个请求在这里拿到 count 0
          const claimed = await tx.passwordResetToken.updateMany({
            where: { id: tokenId, userId, usedAt: null, expiresAt: { gt: now } },
            data: { usedAt: now },
          });
          if (claimed.count !== 1) throw new ResetTokenNotClaimed();
          /// 账号在校验之后被停用：不写密码，整笔回滚
          const updated = await tx.adminUser.updateMany({
            where: { id: userId, disabledAt: null },
            data: { hashedPassword },
          });
          if (updated.count !== 1) throw new ResetTokenNotClaimed();
          /// 同一用户其余还没用的链接一并作废
          await tx.passwordResetToken.updateMany({
            where: { userId, usedAt: null },
            data: { usedAt: now },
          });
        });
        return true;
      } catch (error) {
        if (error instanceof ResetTokenNotClaimed) return false;
        throw error;
      }
    },
  };
}

/* ── 申请 ───────────────────────────────────────────────────────────── */

export async function requestPasswordReset(
  input: { email: string; ip: string | null; locale: Locale },
  deps: PasswordResetDeps = {},
): Promise<{ delivery: PasswordResetDelivery }> {
  const env = deps.env ?? process.env;
  const email = normalizeResetEmail(input.email);

  /// 发信没开通是全站配置，跟这个邮箱有没有账号无关；也不必再计数（这条路什么都不发）
  const baseUrl = appBaseUrl(env);
  if (!emailConfig(env) || !baseUrl) return { delivery: "unavailable" };

  const now = (deps.now ?? (() => new Date()))();
  const rateLimit = deps.rateLimit ?? bumpRateLimit;
  const emailKey = hashVisitorKey(`password-reset-email:${email}`);
  /// 计数先于任何账号查询：超限抛 RateLimitExceededError（路由回 429），对存在 / 不存在的邮箱一样
  await rateLimit(
    `password-reset:net:${hashVisitorNetwork(input.ip)}`,
    hourlyWindowKey(now),
    PASSWORD_RESET_RATE_LIMIT.perNetworkPerHour,
    RATE_LIMIT_MESSAGE,
  );
  await rateLimit(
    `password-reset:email-hour:${emailKey}`,
    hourlyWindowKey(now),
    PASSWORD_RESET_RATE_LIMIT.perEmailPerHour,
    RATE_LIMIT_MESSAGE,
  );
  await rateLimit(
    `password-reset:email-day:${emailKey}`,
    dailyWindowKey(now),
    PASSWORD_RESET_RATE_LIMIT.perEmailPerDay,
    RATE_LIMIT_MESSAGE,
  );

  const defer = deps.defer ?? runAfterResponse;
  defer(() => issuePasswordReset({ email, ip: input.ip, locale: input.locale, now, baseUrl }, deps));
  return { delivery: "email" };
}

/**
 * 申请的后半段（在响应之后跑）：查账号 → 写令牌 → 发信。绝不抛出；
 * 结果只进日志与测试，不回给访客。日志里不写邮箱、不写令牌。
 */
export async function issuePasswordReset(
  input: { email: string; ip: string | null; locale: Locale; now: Date; baseUrl: string },
  deps: PasswordResetDeps = {},
): Promise<PasswordResetIssueOutcome> {
  try {
    const store = deps.store ?? prismaPasswordResetStore();
    const account = await store.findAccountByEmail(normalizeResetEmail(input.email));
    if (!account || !isResettableAccount(account)) return "skipped";

    const { token, tokenHash } = generateResetToken(deps.random);
    await store.issueToken({
      userId: account.id,
      tokenHash,
      expiresAt: resetTokenExpiresAt(input.now),
      requestedIp: input.ip ? hashVisitorNetwork(input.ip) : null,
      now: input.now,
    });

    const send = deps.sendEmail ?? sendPasswordResetEmail;
    const outcome = await send(
      {
        to: account.email,
        link: buildResetLink(input.baseUrl, token),
        locale: input.locale,
        expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
      },
      { env: deps.env },
    );
    if (!outcome.sent) {
      console.warn("[password-reset] email not sent", { userId: account.id, reason: outcome.reason });
      return "send_failed";
    }
    return "sent";
  } catch (error) {
    console.warn("[password-reset] issue failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "send_failed";
  }
}

/* ── 确认 ───────────────────────────────────────────────────────────── */

/** 重置页打开时的只读预检：不消费令牌（邮箱安全扫描器预取链接也不会把它用掉）。 */
export async function inspectPasswordResetToken(
  token: string | null | undefined,
  deps: PasswordResetDeps = {},
): Promise<ResetTokenState> {
  if (!isWellFormedResetToken(token)) return "invalid";
  const store = deps.store ?? prismaPasswordResetStore();
  const record = await store.findToken(hashResetToken(token));
  return resetTokenState(record, (deps.now ?? (() => new Date()))());
}

export async function confirmPasswordReset(
  input: { token: string; password: string },
  deps: PasswordResetDeps = {},
): Promise<ConfirmPasswordResetResult> {
  /// 密码规则先查：不碰库就能答复
  if (passwordPolicyViolation(input.password)) return { ok: false, reason: "weak_password" };
  if (!isWellFormedResetToken(input.token)) return { ok: false, reason: "invalid_or_expired" };

  const store = deps.store ?? prismaPasswordResetStore();
  const clock = deps.now ?? (() => new Date());
  const record = await store.findToken(hashResetToken(input.token));
  if (!record || resetTokenState(record, clock()) !== "valid") {
    return { ok: false, reason: "invalid_or_expired" };
  }

  /// bcrypt 放在事务外（约 250ms，不占着事务）；只有通过校验的令牌才付这笔 CPU
  const hashPassword = deps.hashPassword ?? ((password: string) => bcrypt.hash(password, PASSWORD_BCRYPT_COST));
  const hashedPassword = await hashPassword(input.password);

  /// 消费时再取一次时间：哈希期间刚好过期的令牌同样作废
  const consumed = await store.consumeToken({
    tokenId: record.id,
    userId: record.userId,
    hashedPassword,
    now: clock(),
  });
  return consumed ? { ok: true } : { ok: false, reason: "invalid_or_expired" };
}
