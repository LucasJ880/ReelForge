import "next-auth";
import "next-auth/jwt";

type Role = "ADMIN" | "USER";
type PlanTier = "FREE" | "PRO";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role: Role;
      planTier: PlanTier;
      /** ISO string for JSON safety through NextAuth session */
      planExpiresAt: string | null;
    };
  }

  interface User {
    role?: Role;
    planTier?: PlanTier;
    planExpiresAt?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    planTier?: PlanTier;
    planExpiresAt?: string | null;
  }
}
