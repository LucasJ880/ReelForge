import "next-auth";
import "next-auth/jwt";

type Role = "SUPER_ADMIN" | "OPERATOR" | "REVIEWER" | "CUSTOMER";

/**
 * Phase 5 — userType discriminator for persona-aware routing
 * 取值："BUSINESS" | "PERSONAL" | "OPERATOR" | "SUPER_ADMIN" | null
 * 注：null 表示存量账号还没选过 persona，应被 / page.tsx 强制跳 /persona。
 */
type UserType = "BUSINESS" | "PERSONAL" | "OPERATOR" | "SUPER_ADMIN";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role: Role;
      userType: UserType | null;
    };
  }

  interface User {
    role?: Role;
    userType?: UserType | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    userType?: UserType | null;
  }
}
