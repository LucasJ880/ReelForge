import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { db } from "@/lib/db";

export async function GET() {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const reports = await db.contentReport.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { reporter: { select: { email: true } } },
  });
  return NextResponse.json({ reports });
}
