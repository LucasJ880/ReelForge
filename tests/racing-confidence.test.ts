import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { calculateRacingConfidence } from "../src/lib/services/racing-confidence";

test("Phase3 confidence：五变体且 12/24/48h 完整时为 HIGH", () => {
  const result = calculateRacingConfidence(
    Array.from({ length: 5 }, (_, index) => ({
      videoBriefId: `brief-${index}`,
      windows: [12, 24, 48],
    })),
  );
  assert.equal(result.level, "HIGH");
  assert.equal(result.score, 1);
  assert.equal(result.snapshotCoverage, 1);
  assert.deepEqual(result.limitations, []);
});

test("Phase3 confidence：小样本不夸大结论强度", () => {
  const result = calculateRacingConfidence([
    { videoBriefId: "brief-1", windows: [12, 24, 48] },
  ]);
  assert.equal(result.level, "LOW");
  assert.ok(result.score < 0.8);
  assert.match(result.limitations.join(" "), /仅 1 个变体/);
});

test("Phase3 confidence：缺 48h 窗口时披露排名仍可能变化", () => {
  const result = calculateRacingConfidence([
    { videoBriefId: "brief-1", windows: [12, 24] },
    { videoBriefId: "brief-2", windows: [12, 24] },
    { videoBriefId: "brief-3", windows: [12] },
  ]);
  assert.notEqual(result.level, "HIGH");
  assert.match(result.limitations.join(" "), /缺少 48h/);
});

test("Phase3 ownership：客户 API 通过 DeliveryOrder.createdById 限定轮次与变体", async () => {
  const [service, metricsRoute, page] = await Promise.all([
    readFile("src/lib/services/racing-service.ts", "utf8"),
    readFile("src/app/api/racing/rounds/[id]/metrics/route.ts", "utf8"),
    readFile("src/app/(platform)/app/racing/page.tsx", "utf8"),
  ]);
  assert.match(service, /deliveryOrder:\s*\{ createdById: access\.userId \}/);
  assert.match(service, /contentAngle:\s*\{ roundId: params\.roundId \}/);
  assert.match(metricsRoute, /requireAuth\(\)/);
  assert.match(metricsRoute, /isInternalRacingUser/);
  assert.doesNotMatch(metricsRoute, /requireOperator/);
  assert.match(page, /listRacingRounds/);
});

test("Phase3 journey：手动 Placement、分析置信度与下一轮均有真实端点", async () => {
  const [dashboard, iteration, dispatch] = await Promise.all([
    readFile("src/components/racing/racing-dashboard.tsx", "utf8"),
    readFile("src/lib/services/iteration-service.ts", "utf8"),
    readFile("src/app/api/video-generation/dispatch/route.ts", "utf8"),
  ]);
  assert.match(dashboard, /\/metrics/);
  assert.match(dashboard, /\/analyze/);
  assert.match(dashboard, /\/next/);
  assert.match(dashboard, /12 小时/);
  assert.match(dashboard, /48 小时/);
  assert.match(iteration, /calculateRacingConfidence/);
  assert.match(dispatch, /maxRounds:\s*3/);
});
