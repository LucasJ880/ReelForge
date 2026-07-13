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
          userType: normalizeUserType(user.userType, user.role),
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
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
          token.userType = normalizeUserType(fresh.userType, fresh.role);
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

/**
 * Phase 5 — normalize userType.
 *
 * - 存量账号 userType=null 但 role=OPERATOR/SUPER_ADMIN → 自动落到 internal shell（避免 /persona 强跳）
 * - 已选过 BUSINESS/PERSONAL → 优先保留
 * - 缺省（理论上 default OPERATOR）→ 走 role 兜底
 */
function normalizeUserType(
  ut: string | null | undefined,
  role: "SUPER_ADMIN" | "OPERATOR" | "REVIEWER" | "CUSTOMER",
): "BUSINESS" | "PERSONAL" | "OPERATOR" | "SUPER_ADMIN" | null {
  if (ut === "BUSINESS" || ut === "PERSONAL") return ut;
  if (ut === "OPERATOR" || ut === "SUPER_ADMIN") return ut;
  if (role === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (role === "OPERATOR") return "OPERATOR";
  return null;
}
