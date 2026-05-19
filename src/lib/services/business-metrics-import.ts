import { db } from "@/lib/db";
import { recordMetricsSnapshot } from "@/lib/services/metrics-service";
import type { ContentMetricsInput } from "@/lib/services/metrics-service";

export async function listBusinessVideosForMetrics(userId: string) {
  const orders = await db.deliveryOrder.findMany({
    where: { createdById: userId },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: {
      id: true,
      title: true,
      rounds: {
        orderBy: { roundIndex: "desc" },
        take: 1,
        select: {
          angles: {
            take: 1,
            select: {
              videoBrief: {
                select: {
                  id: true,
                  persona: true,
                  finalVideo: { select: { status: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  return orders
    .map((o) => {
      const brief = o.rounds[0]?.angles[0]?.videoBrief;
      if (!brief || brief.persona === "PERSONAL") return null;
      if (brief.finalVideo?.status !== "READY") return null;
      return { orderId: o.id, title: o.title, briefId: brief.id };
    })
    .filter((x): x is { orderId: string; title: string; briefId: string } => !!x);
}

async function ensurePublishRecord(briefId: string) {
  const existing = await db.publishRecord.findFirst({
    where: { videoBriefId: briefId },
  });
  if (existing) return existing;
  return db.publishRecord.create({
    data: { videoBriefId: briefId, platform: "tiktok", status: "PUBLISHED" },
  });
}

export async function importBusinessVideoMetrics(params: {
  userId: string;
  briefId: string;
  windowHours: 12 | 24 | 48;
  metrics: ContentMetricsInput;
  publishUrl?: string | null;
}) {
  const brief = await db.videoBrief.findFirst({
    where: {
      id: params.briefId,
      persona: { not: "PERSONAL" },
      contentAngle: {
        round: { deliveryOrder: { createdById: params.userId } },
      },
    },
    select: { id: true },
  });
  if (!brief) {
    throw new Error("找不到该视频或无权录入数据");
  }

  const record = await ensurePublishRecord(brief.id);
  if (params.publishUrl) {
    await db.publishRecord.update({
      where: { id: record.id },
      data: { publishUrl: params.publishUrl, status: "PUBLISHED" },
    });
  }

  return recordMetricsSnapshot({
    publishRecordId: record.id,
    windowHours: params.windowHours,
    metrics: params.metrics,
    source: "business_portal",
  });
}
