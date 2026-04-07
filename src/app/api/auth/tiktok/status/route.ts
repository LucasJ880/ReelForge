import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const account = await db.tikTokAccount.findFirst({
    orderBy: { updatedAt: "desc" },
    select: {
      openId: true,
      displayName: true,
      avatarUrl: true,
      tokenExpiresAt: true,
      updatedAt: true,
    },
  });

  if (!account) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    tokenExpired: account.tokenExpiresAt < new Date(),
    updatedAt: account.updatedAt,
  });
}

export async function DELETE() {
  await db.tikTokAccount.deleteMany();
  return NextResponse.json({ ok: true });
}
