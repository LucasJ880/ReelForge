import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

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

        const user = await db.user.findUnique({
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
          planTier: user.planTier,
          planExpiresAt: user.planExpiresAt ? user.planExpiresAt.toISOString() : null,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt", maxAge: 6 * 60 * 60 },
  secret: process.env.AUTH_SECRET,
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: "ADMIN" | "USER" }).role;
        token.planTier = (user as { planTier?: "FREE" | "PRO" }).planTier ?? "FREE";
        token.planExpiresAt =
          (user as { planExpiresAt?: string | null }).planExpiresAt ?? null;
      }

      // 主动刷新 —— 当前端调用 useSession().update() 时走这里，
      // 让 ADMIN 新开通的订阅能立即生效而不需要重新登录。
      if (trigger === "update" && token.id) {
        const fresh = await db.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, planTier: true, planExpiresAt: true },
        });
        if (fresh) {
          token.role = fresh.role;
          token.planTier = fresh.planTier;
          token.planExpiresAt = fresh.planExpiresAt
            ? fresh.planExpiresAt.toISOString()
            : null;
        }
      }

      return token;
    },
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
        session.user.role = (token.role as "ADMIN" | "USER") || "USER";
        session.user.planTier = (token.planTier as "FREE" | "PRO") || "FREE";
        session.user.planExpiresAt = (token.planExpiresAt as string | null) ?? null;
      }
      return session;
    },
  },
};
