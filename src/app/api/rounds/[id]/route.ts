import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const round = await db.round.findUnique({
    where: { id },
    include: {
      deliveryOrder: true,
      baseDistillation: true,
      angles: {
        orderBy: { sortOrder: "asc" },
        include: {
          videoBrief: {
            include: {
              scripts: {
                where: { isCurrent: true },
                include: {
                  scenePlans: {
                    orderBy: { sceneIndex: "asc" },
                    include: { videoPrompts: true },
                  },
                },
              },
              qaReviews: { orderBy: { createdAt: "desc" }, take: 1 },
              publishRecords: {
                orderBy: { createdAt: "desc" },
                take: 1,
                include: { metricsSnapshots: true },
              },
              videoJobs: { orderBy: { createdAt: "desc" } },
            },
          },
          sourceDistillation: true,
        },
      },
      scoreReports: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!round) return NextResponse.json({ error: "轮次不存在" }, { status: 404 });
  return NextResponse.json(round);
}
