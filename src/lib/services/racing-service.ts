import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createRound } from "@/lib/services/round-service";
import { generateRoundIterationReport } from "@/lib/services/iteration-service";
import { recordMetricsSnapshot, type ContentMetricsInput } from "@/lib/services/metrics-service";
import { calculateRacingConfidence } from "@/lib/services/racing-confidence";

export type RacingAccess = {
  userId: string;
  canViewAll: boolean;
};

function ownedRoundWhere(access: RacingAccess): Prisma.RoundWhereInput {
  return access.canViewAll
    ? {}
    : { deliveryOrder: { createdById: access.userId } };
}

export async function assertRacingRoundAccess(roundId: string, access: RacingAccess) {
  const round = await db.round.findFirst({
    where: { id: roundId, ...ownedRoundWhere(access) },
    select: { id: true, deliveryOrderId: true },
  });
  if (!round) throw new Error("找不到该赛马轮次或无权访问");
  return round;
}

export async function listRacingRounds(access: RacingAccess) {
  const rounds = await db.round.findMany({
    where: ownedRoundWhere(access),
    orderBy: { createdAt: "desc" },
    take: 40,
    include: {
      deliveryOrder: {
        select: {
          id: true,
          title: true,
          maxRounds: true,
          status: true,
          distillations: {
            orderBy: { createdAt: "desc" },
            take: 10,
            select: { id: true, sourceRoundId: true, summary: true, structured: true },
          },
        },
      },
      angles: {
        orderBy: { sortOrder: "asc" },
        include: {
          videoBrief: {
            select: {
              id: true,
              status: true,
              finalVideoUrl: true,
              finalThumbnailUrl: true,
              finalVideo: {
                select: { status: true, stitchedVideoUrl: true, thumbnailUrl: true },
              },
              publishRecords: {
                orderBy: { createdAt: "desc" },
                take: 1,
                include: { metricsSnapshots: { orderBy: { windowHours: "asc" } } },
              },
            },
          },
        },
      },
      scoreReports: {
        where: { videoBriefId: null },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      baseDistillation: { select: { id: true, summary: true, structured: true } },
    },
  });

  return rounds.map((round) => {
    const variants = round.angles.flatMap((angle) => {
      const brief = angle.videoBrief;
      if (!brief) return [];
      const placement = brief.publishRecords[0] ?? null;
      return [{
        angleId: angle.id,
        title: angle.title,
        type: angle.type,
        videoBriefId: brief.id,
        briefStatus: brief.status,
        videoUrl: brief.finalVideo?.stitchedVideoUrl ?? brief.finalVideoUrl,
        thumbnailUrl: brief.finalVideo?.thumbnailUrl ?? brief.finalThumbnailUrl,
        placement: placement ? {
          id: placement.id,
          platform: placement.platform,
          externalPostId: placement.externalPostId,
          publishUrl: placement.publishUrl,
          status: placement.status,
          snapshots: placement.metricsSnapshots.map((snapshot) => ({
            id: snapshot.id,
            windowHours: snapshot.windowHours,
            capturedAt: snapshot.capturedAt,
            metrics: snapshot.metrics,
          })),
        } : null,
      }];
    });
    const confidence = calculateRacingConfidence(
      variants.map((variant) => ({
        videoBriefId: variant.videoBriefId,
        windows: variant.placement?.snapshots.map((snapshot) => snapshot.windowHours) ?? [],
      })),
    );
    const generatedDistillation = round.deliveryOrder.distillations.find(
      (distillation) => distillation.sourceRoundId === round.id,
    ) ?? null;
    return {
      id: round.id,
      roundIndex: round.roundIndex,
      status: round.status,
      createdAt: round.createdAt,
      startedAt: round.startedAt,
      closedAt: round.closedAt,
      deliveryOrder: {
        id: round.deliveryOrder.id,
        title: round.deliveryOrder.title,
        maxRounds: round.deliveryOrder.maxRounds,
        status: round.deliveryOrder.status,
      },
      variants,
      confidence,
      latestReport: round.scoreReports[0] ? {
        id: round.scoreReports[0].id,
        compositeScore: round.scoreReports[0].compositeScore,
        explanation: round.scoreReports[0].explanation,
        ranking: round.scoreReports[0].ranking,
        createdAt: round.scoreReports[0].createdAt,
      } : null,
      baseDistillation: round.baseDistillation,
      generatedDistillation,
    };
  });
}

export async function recordRacingMetrics(params: {
  access: RacingAccess;
  roundId: string;
  videoBriefId: string;
  platform: string;
  externalPostId: string;
  publishUrl?: string | null;
  windowHours: 12 | 24 | 48;
  metrics: ContentMetricsInput;
}) {
  await assertRacingRoundAccess(params.roundId, params.access);
  const brief = await db.videoBrief.findFirst({
    where: {
      id: params.videoBriefId,
      contentAngle: { roundId: params.roundId },
    },
    select: { id: true },
  });
  if (!brief) throw new Error("该视频不属于此赛马轮次");

  const placement = await db.publishRecord.findFirst({
    where: { videoBriefId: brief.id },
    orderBy: { createdAt: "desc" },
  });
  const publishRecord = placement
    ? await db.publishRecord.update({
        where: { id: placement.id },
        data: {
          platform: params.platform,
          externalPostId: params.externalPostId,
          publishUrl: params.publishUrl ?? placement.publishUrl,
          status: "PUBLISHED",
          publishedAt: placement.publishedAt ?? new Date(),
        },
      })
    : await db.publishRecord.create({
        data: {
          videoBriefId: brief.id,
          platform: params.platform,
          externalPostId: params.externalPostId,
          publishUrl: params.publishUrl ?? null,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      });

  const snapshot = await recordMetricsSnapshot({
    publishRecordId: publishRecord.id,
    windowHours: params.windowHours,
    metrics: params.metrics,
    source: "racing_manual",
  });
  return { placement: publishRecord, snapshot };
}

export async function analyzeRacingRound(roundId: string, access: RacingAccess) {
  await assertRacingRoundAccess(roundId, access);
  return generateRoundIterationReport(roundId);
}

export async function scheduleNextRacingRound(params: {
  roundId: string;
  access: RacingAccess;
  baseDistillationId: string;
}) {
  const current = await assertRacingRoundAccess(params.roundId, params.access);
  const distillation = await db.distillationFeature.findFirst({
    where: {
      id: params.baseDistillationId,
      sourceRoundId: params.roundId,
      deliveryOrderId: current.deliveryOrderId,
    },
    select: { id: true },
  });
  if (!distillation) throw new Error("下一轮必须使用本轮生成的蒸馏结果");
  return createRound({
    deliveryOrderId: current.deliveryOrderId,
    baseDistillationId: distillation.id,
    optimizationSlots: 3,
    explorationSlots: 2,
  });
}

export function isInternalRacingUser(userType: string | null | undefined) {
  return userType === "OPERATOR" || userType === "SUPER_ADMIN";
}
