import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { checkBriefAccess } from "@/lib/services/brief-access";

const reportSchema = z.object({
  briefId: z.string().min(1).max(100),
  reason: z.enum(["UNSAFE_CONTENT", "IP_OR_BRAND", "PRIVACY", "MISLEADING", "QUALITY_FAILURE", "OTHER"]),
  details: z.string().trim().max(2_000).optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "举报信息不完整" }, { status: 400 });
  const access = await checkBriefAccess(parsed.data.briefId, auth.session);
  if (!access.allowed) return NextResponse.json({ error: "找不到该视频" }, { status: 404 });

  const report = await db.contentReport.create({
    data: {
      reporterId: auth.session.user.id,
      targetBriefId: parsed.data.briefId,
      reason: parsed.data.reason,
      details: parsed.data.details || null,
    },
    select: { id: true, status: true },
  });
  return NextResponse.json({ report }, { status: 201 });
}
