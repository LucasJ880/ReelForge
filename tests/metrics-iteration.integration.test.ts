import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/lib/db";
import { generateRoundIterationReport } from "../src/lib/services/iteration-service";
import { recordMetricsSnapshot } from "../src/lib/services/metrics-service";

const runDbTests = process.env.RUN_DB_TESTS === "true";

test("metrics snapshots can produce ScoreReport and DistillationFeature", { skip: !runDbTests }, async () => {
  const order = await db.deliveryOrder.create({
    data: {
      title: `metrics-integration-${Date.now()}`,
      productCategory: "pet_products",
      targetPlatform: "tiktok",
      targetCountry: "US",
      targetLanguage: "en",
      productInput: {},
    },
  });

  try {
    const round = await db.round.create({
      data: { deliveryOrderId: order.id, roundIndex: 1, status: "LIVE" },
    });
    const angle = await db.contentAngle.create({
      data: {
        roundId: round.id,
        sortOrder: 1,
        type: "OPTIMIZATION",
        title: "Metric test angle",
      },
    });
    const brief = await db.videoBrief.create({
      data: {
        contentAngleId: angle.id,
        status: "PUBLISHED",
      },
    });
    const publish = await db.publishRecord.create({
      data: {
        videoBriefId: brief.id,
        status: "PUBLISHED",
        externalPostId: `metric-${Date.now()}`,
        publishedAt: new Date(),
      },
    });

    await recordMetricsSnapshot({
      publishRecordId: publish.id,
      windowHours: 24,
      metrics: {
        views: 1000,
        completion_rate: 0.45,
        retention_3s: 0.7,
        likes: 100,
        comments: 10,
        shares: 12,
        saves: 18,
      },
    });

    const result = await generateRoundIterationReport(round.id);
    assert.ok(result.scored.ranked.length > 0);
    assert.ok(result.distillation.id);
    assert.equal(result.nextRound.canSchedule, true);
  } finally {
    await db.deliveryOrder.delete({ where: { id: order.id } }).catch(() => null);
    await db.$disconnect();
  }
});
