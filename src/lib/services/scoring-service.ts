import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  calcCompositeScore,
  calcContentScore,
  normalizeContentMetrics,
} from "@/lib/config/scoring-weights";
import { CONTENT_SCORE_WEIGHTS } from "@/lib/config/scoring-weights";

/**
 * 为一个 Round 计算所有视频的分数 + 轮次级 ranking + top3。
 */
export async function scoreRound(roundId: string) {
  const round = await db.round.findUnique({
    where: { id: roundId },
    include: {
      angles: {
        include: {
          videoBrief: {
            include: {
              publishRecords: {
                include: { metricsSnapshots: true },
              },
            },
          },
        },
      },
    },
  });
  if (!round) throw new Error("轮次不存在");

  await db.round.update({
    where: { id: roundId },
    data: { status: "SCORING" },
  });

  // 清掉旧的 score 报告
  await db.scoreReport.deleteMany({ where: { roundId } });

  const perBrief: {
    videoBriefId: string;
    angleId: string;
    contentScore: number | null;
    compositeScore: number | null;
    reports: Record<number, number>;
  }[] = [];

  for (const angle of round.angles) {
    const brief = angle.videoBrief;
    if (!brief) continue;
    const publishRecord = brief.publishRecords.find(
      (r) => r.status === "PUBLISHED",
    );
    if (!publishRecord) {
      perBrief.push({
        videoBriefId: brief.id,
        angleId: angle.id,
        contentScore: null,
        compositeScore: null,
        reports: {},
      });
      continue;
    }

    const byWindow: Record<number, number> = {};
    for (const snap of publishRecord.metricsSnapshots) {
      const score = calcContentScore(snap.metrics as Record<string, number>);
      byWindow[snap.windowHours] = score;
      await db.scoreReport.create({
        data: {
          roundId,
          videoBriefId: brief.id,
          contentScore: score,
          weights: CONTENT_SCORE_WEIGHTS as unknown as Prisma.InputJsonValue,
          explanation: `Window ${snap.windowHours}h score=${score}`,
        },
      });
    }

    const composite = calcCompositeScore({
      h12: byWindow[12] ?? null,
      h24: byWindow[24] ?? null,
      h48: byWindow[48] ?? null,
    });
    perBrief.push({
      videoBriefId: brief.id,
      angleId: angle.id,
      contentScore: byWindow[48] ?? byWindow[24] ?? byWindow[12] ?? null,
      compositeScore: composite,
      reports: byWindow,
    });
  }

  // 轮次级排名
  const ranked = [...perBrief]
    .filter((p) => p.compositeScore != null)
    .sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0))
    .map((p, i) => ({
      videoBriefId: p.videoBriefId,
      rank: i + 1,
      score: p.compositeScore,
    }));

  const roundReport = await db.scoreReport.create({
    data: {
      roundId,
      compositeScore: ranked[0]?.score ?? null,
      weights: CONTENT_SCORE_WEIGHTS as unknown as Prisma.InputJsonValue,
      explanation: `Round ${round.roundIndex} ranked ${ranked.length} videos`,
      ranking: ranked as unknown as Prisma.InputJsonValue,
    },
  });

  // 前 3 标 ARCHIVED，其余标 DROPPED
  const topBriefIds = ranked.slice(0, 3).map((r) => r.videoBriefId);
  await db.videoBrief.updateMany({
    where: {
      id: { in: perBrief.map((p) => p.videoBriefId) },
    },
    data: { status: "SCORED" },
  });
  await db.videoBrief.updateMany({
    where: { id: { in: topBriefIds } },
    data: { status: "ARCHIVED" },
  });
  await db.videoBrief.updateMany({
    where: {
      id: {
        in: perBrief
          .map((p) => p.videoBriefId)
          .filter((id) => !topBriefIds.includes(id)),
      },
    },
    data: { status: "DROPPED" },
  });

  await db.round.update({
    where: { id: roundId },
    data: {
      status: "RANKED",
      closedAt: new Date(),
    },
  });

  return { ranked, roundReport, perBrief, topBriefIds };
}

/**
 * 从一个 publishRecord 的所有 metrics 简单取 composite（用于前端单条详情展示）。
 */
export function briefCompositeFromSnapshots(
  snapshots: { windowHours: number; metrics: unknown }[],
) {
  const byWindow: Record<number, number> = {};
  for (const s of snapshots) {
    byWindow[s.windowHours] = calcContentScore(
      s.metrics as Record<string, number>,
    );
  }
  return {
    byWindow,
    composite: calcCompositeScore({
      h12: byWindow[12] ?? null,
      h24: byWindow[24] ?? null,
      h48: byWindow[48] ?? null,
    }),
  };
}

export { normalizeContentMetrics };
