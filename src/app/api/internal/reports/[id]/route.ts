import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/api-auth";
import { db } from "@/lib/db";

const actionSchema = z.object({
  action: z.enum(["review", "dismiss", "takedown"]),
  resolutionNote: z.string().trim().min(1).max(2_000),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "处理说明不能为空" }, { status: 400 });
  const { id } = await params;
  const existing = await db.contentReport.findUnique({ where: { id }, select: { id: true, status: true, targetBriefId: true } });
  if (!existing) return NextResponse.json({ error: "举报不存在" }, { status: 404 });

  if (parsed.data.action === "takedown") {
    if (existing.status === "ACTIONED") return NextResponse.json({ error: "该举报已完成处理" }, { status: 409 });
    const result = await db.$transaction(async (tx) => {
      const brief = await tx.videoBrief.updateMany({
        where: { id: existing.targetBriefId, takedownAt: null },
        data: { takedownAt: new Date(), takedownReason: parsed.data.resolutionNote, takedownById: auth.session.user.id },
      });
      if (brief.count !== 1) throw new Error("TAKEDOWN_CAS_CONFLICT");
      return tx.contentReport.update({
        where: { id: existing.id },
        data: { status: "ACTIONED", reviewedById: auth.session.user.id, resolutionNote: parsed.data.resolutionNote, actionedAt: new Date() },
      });
    }).catch((error: unknown) => error instanceof Error && error.message === "TAKEDOWN_CAS_CONFLICT" ? null : Promise.reject(error));
    if (!result) return NextResponse.json({ error: "视频已下架或状态已改变，请刷新" }, { status: 409 });
    return NextResponse.json({ report: result });
  }

  const report = await db.contentReport.update({
    where: { id },
    data: {
      status: parsed.data.action === "dismiss" ? "DISMISSED" : "REVIEWING",
      reviewedById: auth.session.user.id,
      resolutionNote: parsed.data.resolutionNote,
    },
  });
  return NextResponse.json({ report });
}
