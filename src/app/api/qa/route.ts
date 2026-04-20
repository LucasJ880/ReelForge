import { NextRequest, NextResponse } from "next/server";
import { requireReviewer } from "@/lib/api-auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const guard = await requireReviewer();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "PENDING";

  const items = await db.qAReview.findMany({
    where: status === "all" ? {} : { status: status as never },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      videoBrief: {
        include: {
          contentAngle: {
            include: { round: { include: { deliveryOrder: true } } },
          },
        },
      },
      reviewer: { select: { email: true, name: true } },
    },
  });

  return NextResponse.json({ items });
}
