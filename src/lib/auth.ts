import { getServerSession, type NextAuthOptions, type Session } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  normalizeUserTypeForRole,
  type AccountRole,
  type AccountUserType,
} from "@/lib/auth-role-policy";
import {
  isDemoAccountEmail,
  isDemoLoginAllowed,
  isReservedTestEmail,
  isTestAccountLoginAllowed,
} from "@/lib/demo-account";

/**
 * 免登录时长（秒）。登录页 `sessionHint` 文案按这个值表述，两者必须一致。
 * 7 天滚动：每次活动续期，连续 7 天不来才需要重新登录。
 */
export const SESSION_IDLE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * 停用与角色复核（A4 5.1，取代「删除用户」）。
 *
 * JWT 会话是无状态的：账号停用、角色变更之后，旧 token 在 7 天滚动期内照样有效
 * （bughunt #1 / #25）。所以分两层复核库里的 disabledAt / role / userType：
 * - jwt 回调：每次取会话都会跑，按用户节流到每个实例 5 分钟最多查一次库。
 *   节流放进程内存而不是 token：RSC 里的 getServerSession 写不回 cookie，
 *   token 里的「上次检查时间」永远是旧的。停用 / 账号不存在 → 抛错，
 *   NextAuth 会把这次会话当作无效（getServerSession 返回 null、清 cookie）。
 * - API 守卫（api-auth 的 requireAuth / requireRole）：走 getActiveServerSession，
 *   不吃 5 分钟窗口，付费与写操作在停用那一刻就拒绝。
 * 不放 middleware：middleware 跑在 edge，查不了库，也不该每个静态请求都查。
 */
export const ACCOUNT_RECHECK_TTL_MS = 5 * 60 * 1000;
/// API 守卫的「新鲜度」：同一请求里 jwt 回调刚查过的结果直接复用，不重复查库。
export const API_ACCOUNT_RECHECK_MAX_AGE_MS = 2_000;
const ACCOUNT_STATUS_CACHE_MAX_ENTRIES = 5_000;

export class AccountDisabledError extends Error {
  constructor(message = "账号已停用") {
    super(message);
    this.name = "AccountDisabledError";
  }
}

export type AccountStatus = {
  disabled: boolean;
  role: AccountRole;
  userType: AccountUserType | null;
};

const accountStatusCache = new Map<
  string,
  { checkedAt: number; status: AccountStatus | null }
>();

/**
 * 读账号的停用 / 角色状态。maxAgeMs 内查过就用缓存；null = 账号已不存在。
 */
export async function loadAccountStatus(
  userId: string,
  maxAgeMs: number,
  now = Date.now(),
): Promise<AccountStatus | null> {
  const cached = accountStatusCache.get(userId);
  if (cached && now - cached.checkedAt < maxAgeMs) return cached.status;

  const row = await db.adminUser.findUnique({
    where: { id: userId },
    select: { role: true, userType: true, disabledAt: true },
  });
  const status: AccountStatus | null = row
    ? {
        disabled: row.disabledAt !== null,
        role: row.role,
        userType: normalizeUserTypeForRole(row.userType, row.role),
      }
    : null;
  /// 上限只是防内存无界增长；清空的代价只是下一次多查一次库。
  if (accountStatusCache.size >= ACCOUNT_STATUS_CACHE_MAX_ENTRIES) {
    accountStatusCache.clear();
  }
  accountStatusCache.set(userId, { checkedAt: now, status });
  return status;
}

/** 停用 / 改角色之后调用：本实例立刻按新状态复核，不等 5 分钟。 */
export function forgetAccountStatus(userId: string): void {
  accountStatusCache.delete(userId);
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        /// 演示账号：生产环境禁止登录（凭据曾泄露在客户端包里），见 demo-account.ts。
        /// 保留测试域名（*.test / *.invalid …）的账号：真实生产禁止登录。
        const demoLoginBlocked = !isDemoLoginAllowed();
        const testLoginBlocked = !isTestAccountLoginAllowed();
        if (demoLoginBlocked && isDemoAccountEmail(credentials.email)) return null;
        if (testLoginBlocked && isReservedTestEmail(credentials.email)) return null;

        const user = await db.adminUser.findUnique({
          where: { email: credentials.email },
        });
        if (!user) return null;
        if (demoLoginBlocked && isDemoAccountEmail(user.email)) return null;
        if (testLoginBlocked && isReservedTestEmail(user.email)) return null;

        const valid = await bcrypt.compare(
          credentials.password,
          user.hashedPassword,
        );
        if (!valid) return null;
        /// 已停用：与密码错误同样返回 null（登录页统一提示），不额外暴露账号状态。
        if (user.disabledAt) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          userType: normalizeUserTypeForRole(user.userType, user.role),
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  /**
   * 滚动会话：连续 SESSION_IDLE_MAX_AGE_SECONDS 没有活动才失效，活跃用户不会在
   * 干活到一半被踢出去。updateAge 决定「多久续一次签」——设为 1 小时，既不会每次
   * 请求都重签 JWT，又能保证登录页承诺的免登录时长是真的。
   *
   * 注意：改小这里等于缩短所有人的免登录时长，登录页 sessionHint 的文案必须同步，
   * tests/session-lifetime.test.ts 会守住两者一致。
   */
  session: {
    strategy: "jwt",
    maxAge: SESSION_IDLE_MAX_AGE_SECONDS,
    updateAge: 60 * 60,
  },
  secret: process.env.AUTH_SECRET,
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = (
          user as {
            role?: "SUPER_ADMIN" | "OPERATOR" | "REVIEWER" | "CUSTOMER";
          }
        ).role;
        token.userType =
          (user as { userType?: "BUSINESS" | "PERSONAL" | "OPERATOR" | "SUPER_ADMIN" | null })
            .userType ?? null;
      }

      /// 刚登录（authorize 已查过停用）不用再查；之后每次取会话按 TTL 复核。
      /// 前端主动 update() 时不吃缓存，立刻按库里的角色刷新。
      if (!user && token.id) {
        let status: AccountStatus | null;
        try {
          status = await loadAccountStatus(
            token.id as string,
            trigger === "update" ? 0 : ACCOUNT_RECHECK_TTL_MS,
          );
        } catch (err) {
          /// 库抖动时不把所有在线用户踢下线；API 守卫还会再查一次。
          console.warn("[auth] account recheck failed, keeping session", err);
          return token;
        }
        if (!status || status.disabled) {
          throw new AccountDisabledError();
        }
        token.role = status.role;
        token.userType = status.userType;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
        session.user.role =
          (token.role as
            | "SUPER_ADMIN"
            | "OPERATOR"
            | "REVIEWER"
            | "CUSTOMER") || "CUSTOMER";
        session.user.userType =
          (token.userType as
            | "BUSINESS"
            | "PERSONAL"
            | "OPERATOR"
            | "SUPER_ADMIN"
            | null
            | undefined) ?? null;
      }
      return session;
    },
  },
};

/**
 * API 守卫专用的会话：getServerSession + 立即查库复核（不吃 5 分钟窗口）。
 * - 停用 / 账号已不存在 → null（守卫回 401，前端走重新登录）；
 * - 角色 / persona 以库里为准写回 session，改角色即时生效；
 * - 查库失败时退回会话原值（与 jwt 回调同一取舍：库抖动不等于账号有问题）。
 */
export async function getActiveServerSession(): Promise<Session | null> {
  return verifyActiveSession(await getServerSession(authOptions));
}

/** getActiveServerSession 的可测核心：拿一个已解出的会话去库里复核。 */
export async function verifyActiveSession(
  session: Session | null,
): Promise<Session | null> {
  const userId = session?.user?.id;
  if (!session?.user || !userId) return session;
  let status: AccountStatus | null;
  try {
    status = await loadAccountStatus(userId, API_ACCOUNT_RECHECK_MAX_AGE_MS);
  } catch (err) {
    console.warn("[auth] api account recheck failed, using session claims", err);
    return session;
  }
  if (!status || status.disabled) return null;
  session.user.role = status.role;
  session.user.userType = status.userType;
  return session;
}

export const __test__ = {
  resetAccountStatusCache(): void {
    accountStatusCache.clear();
  },
  /// 把缓存里的检查时间往前推，模拟「jwt 回调几秒前查过」。
  ageAccountStatusCache(ms: number): void {
    for (const entry of accountStatusCache.values()) entry.checkedAt -= ms;
  },
};
