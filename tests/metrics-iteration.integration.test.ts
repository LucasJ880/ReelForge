import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/lib/db";
import { generateRoundIterationReport } from "../src/lib/services/iteration-service";
import {
  recordRacingMetrics,
  scheduleNextRacingRound,
} from "../src/lib/services/racing-service";

const runDbTests = process.env.RUN_DB_TESTS === "true";

test("metrics snapshots can produce ScoreReport and DistillationFeature", { skip: !runDbTests }, async () => {
  const suffix = Date.now();
  const owner = await db.adminUser.create({
    data: {
      email: `racing-owner-${suffix}@example.test`,
      hashedPassword: "integration-test-only",
      role: "CUSTOMER",
      userType: "BUSINESS",
    },
  });
  const order = await db.deliveryOrder.create({
    data: {
      title: `metrics-integration-${suffix}`,
      productCategory: "pet_products",
      targetPlatform: "tiktok",
      targetCountry: "US",
      targetLanguage: "en",
      productInput: {},
      createdById: owner.id,
      maxRounds: 3,
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
    await assert.rejects(() => recordRacingMetrics({
      access: { userId: "another-customer", canViewAll: false },
      roundId: round.id,
      videoBriefId: brief.id,
      platform: "tiktok",
      externalPostId: `metric-${suffix}`,
      windowHours: 24,
      metrics: {
        views: 1,
      },
    }), /无权访问/);

    await recordRacingMetrics({
      access: { userId: owner.id, canViewAll: false },
      roundId: round.id,
      videoBriefId: brief.id,
      platform: "tiktok",
      externalPostId: `metric-${suffix}`,
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
    assert.equal(result.confidence.level, "LOW");
    assert.equal(result.confidence.observedSnapshots, 1);
    assert.match(result.confidence.limitations.join(" "), /仅 1 个变体/);

    const next = await scheduleNextRacingRound({
      roundId: round.id,
      access: { userId: owner.id, canViewAll: false },
      baseDistillationId: result.distillation.id,
    });
    assert.equal(next.roundIndex, 2);
    assert.equal(next.optimizationSlots, 3);
    assert.equal(next.explorationSlots, 2);
  } finally {
    await db.deliveryOrder.delete({ where: { id: order.id } }).catch(() => null);
    await db.adminUser.delete({ where: { id: owner.id } }).catch(() => null);
    await db.$disconnect();
  }
});
