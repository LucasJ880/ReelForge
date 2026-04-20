import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { updateBriefSchema } from "@/lib/validators";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const brief = await db.videoBrief.findUnique({
    where: { id },
    include: {
      contentAngle: {
        include: { round: { include: { deliveryOrder: true } } },
      },
      scripts: {
        orderBy: { version: "desc" },
        include: {
          scenePlans: {
            orderBy: { sceneIndex: "asc" },
            include: { videoPrompts: true },
          },
        },
      },
      qaReviews: { orderBy: { createdAt: "desc" } },
      publishRecords: {
        orderBy: { createdAt: "desc" },
        include: { metricsSnapshots: true },
      },
      videoJobs: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!brief) return NextResponse.json({ error: "Brief 不存在" }, { status: 404 });
  return NextResponse.json(brief);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = updateBriefSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const brief = await db.videoBrief.update({
    where: { id },
    data: parsed.data,
  });
  return NextResponse.json(brief);
}
