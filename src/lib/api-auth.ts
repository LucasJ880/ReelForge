import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

type Session = NonNullable<Awaited<ReturnType<typeof getServerSession>>>;

export type AuthGuardResult =
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse };

export async function requireAuth(): Promise<AuthGuardResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    };
  }
  return { ok: true, session };
}

export async function requireAdmin(): Promise<AuthGuardResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    };
  }
  if (session.user.role !== "ADMIN") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "此操作需要管理员权限" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session };
}
