import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { normalizeUserTypeForRole } from "@/lib/auth-role-policy";

/**
 * 免登录时长（秒）。登录页 `sessionHint` 文案按这个值表述，两者必须一致。
 * 7 天滚动：每次活动续期，连续 7 天不来才需要重新登录。
 */
export const SESSION_IDLE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

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

        const user = await db.adminUser.findUnique({
          where: { email: credentials.email },
        });
        if (!user) return null;

        const valid = await bcrypt.compare(
          credentials.password,
          user.hashedPassword,
        );
        if (!valid) return null;

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

      if (trigger === "update" && token.id) {
        const fresh = await db.adminUser.findUnique({
          where: { id: token.id as string },
          select: { role: true, userType: true },
        });
        if (fresh) {
          token.role = fresh.role;
          token.userType = normalizeUserTypeForRole(fresh.userType, fresh.role);
        }
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
