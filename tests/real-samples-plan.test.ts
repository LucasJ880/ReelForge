/**
 * X-SCAF-1：样片脚本多线路化的纯函数（线路臂解析、幂等键 v4、旧条目并入、时间戳推进）
 * 与付费实验预算闸。不连库、不触网。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SHUYU_RESERVE_POINTS_DEFAULT,
  checkBudgetGate,
  estimateSpend,
  parsePositiveLimit,
} from "../scripts/lib/experiment-budget";
import {
  BATCH_KEY_REV,
  SampleArmError,
  advanceTiming,
  assertRunKeyForArms,
  effectiveWaveSize,
  inferLegacyArmId,
  isCurrentRevKey,
  isExperimentRun,
  parseSampleArms,
  sampleIdempotencyKey,
  sampleVideoFileName,
} from "../scripts/lib/real-samples-plan";

test("线路臂：空 = buddy 默认套餐；buddy@planId 带显式套餐；逗号多臂", () => {
  assert.deepEqual(parseSampleArms(undefined), [{ id: "buddy", routeId: "buddy", planId: null }]);
  assert.deepEqual(parseSampleArms(" buddy , buddy@video-plan-1080 "), [
    { id: "buddy", routeId: "buddy", planId: null },
    { id: "buddy@video-plan-1080", routeId: "buddy", planId: "video-plan-1080" },
  ]);
  assert.deepEqual(parseSampleArms("volcengine_cn_legacy"), [
    { id: "volcengine_cn_legacy", routeId: "volcengine_cn_legacy", planId: null },
  ]);
});

test("线路臂：D-2/D-8 之外的通道、重复臂、volcengine 混跑一律拒绝", () => {
  assert.throws(() => parseSampleArms("byteplus_international"), SampleArmError);
  assert.throws(() => parseSampleArms("fal"), SampleArmError);
  assert.throws(() => parseSampleArms("buddy,buddy"), /重复/);
  assert.throws(() => parseSampleArms("buddy,volcengine_cn_legacy"), /单独跑/);
  assert.throws(() => parseSampleArms("buddy@"), /不合法/);
  assert.throws(() => parseSampleArms("buddy@ bad id"), /不合法/);
});

test("对照实验（多臂或显式套餐）必须 exp-2611- 运行键，并发 ≤ 2", () => {
  const single = parseSampleArms("buddy");
  const multi = parseSampleArms("buddy,buddy@p-1080");
  const explicit = parseSampleArms("buddy@p-720");
  assert.equal(isExperimentRun(single), false);
  assert.equal(isExperimentRun(multi), true);
  assert.equal(isExperimentRun(explicit), true);
  assert.doesNotThrow(() => assertRunKeyForArms("template-samples-20260803-v1", single));
  assert.throws(() => assertRunKeyForArms("template-samples-20260803-v1", multi), /exp-2611-/);
  assert.doesNotThrow(() => assertRunKeyForArms("exp-2611-e12-a", explicit));
  assert.equal(effectiveWaveSize(6, single), 6);
  assert.equal(effectiveWaveSize(6, multi), 2);
  assert.equal(effectiveWaveSize(1, multi), 1);
});

test("幂等键 v4：带 :${armId} 后缀；force 时并入模板版本与重试号", () => {
  assert.equal(BATCH_KEY_REV, "v4");
  assert.equal(
    sampleIdempotencyKey({ runKey: "rk", slug: "commerce-food-sizzle", armId: "buddy" }),
    "rk:commerce-food-sizzle:v4:buddy",
  );
  assert.equal(
    sampleIdempotencyKey({
      runKey: "rk",
      slug: "s",
      armId: "buddy@p-1080",
      force: { templateVersion: 3, retryRev: "2" },
    }),
    "rk:s:v4:buddy@p-1080:t3:r2",
  );
  assert.equal(isCurrentRevKey("rk:s:v4:buddy"), true);
  assert.equal(isCurrentRevKey("rk:s:v3"), false);
  assert.equal(isCurrentRevKey("rk:s:v3:vol"), false);
});

test("旧条目并入：v3 `:vol` 后缀 = volcengine，其余 = buddy；已有 armId 原样保留", () => {
  assert.equal(inferLegacyArmId({ idempotencyKey: "rk:s:v3" }), "buddy");
  assert.equal(inferLegacyArmId({ idempotencyKey: "rk:s:v3:vol" }), "volcengine_cn_legacy");
  assert.equal(inferLegacyArmId({ idempotencyKey: "rk:s:v3:vol:t2" }), "volcengine_cn_legacy");
  assert.equal(inferLegacyArmId({ idempotencyKey: "rk:s:v4:x", armId: "buddy@p" }), "buddy@p");
});

test("成片文件名：默认臂保持历史名，其它臂加安全后缀", () => {
  assert.equal(sampleVideoFileName("s", "buddy"), "s.mp4");
  assert.equal(sampleVideoFileName("s", "buddy@plan:a/b"), "s--buddy_plan_a_b.mp4");
});

test("时间戳推进：库字段覆盖；firstProcessingAt 只认处理中状态且只记第一次", () => {
  const t0 = new Date("2026-11-01T00:00:00.000Z");
  const t1 = new Date("2026-11-01T00:00:20.000Z");
  const t2 = new Date("2026-11-01T00:00:40.000Z");
  const queued = advanceTiming({}, { now: t0, submittedAt: t0, finishedAt: null, providerStatus: "queued" });
  assert.deepEqual(queued, { submittedAt: t0.toISOString() });
  const processing = advanceTiming(queued, { now: t1, submittedAt: t0, finishedAt: null, providerStatus: "processing" });
  assert.equal(processing.firstProcessingAt, t1.toISOString());
  const done = advanceTiming(processing, { now: t2, submittedAt: t0, finishedAt: t2, providerStatus: "processing" });
  assert.equal(done.firstProcessingAt, t1.toISOString());
  assert.equal(done.finishedAt, t2.toISOString());
  const skipped = advanceTiming({}, { now: t2, submittedAt: t0, finishedAt: t2, providerStatus: "completed" });
  assert.equal(skipped.firstProcessingAt, undefined);
  assert.equal(advanceTiming({}, { now: t1, submittedAt: null, finishedAt: null, providerStatus: "running" }).firstProcessingAt, t1.toISOString());
});

test("预算估算：按臂 × 条数汇总，未定价臂单独列出", () => {
  const estimate = estimateSpend([
    { armId: "buddy", count: 3, unitPoints: 700, unitUsd: null },
    { armId: "buddy@p-1080", count: 2, unitPoints: 3_600, unitUsd: null },
    { armId: "volc", count: 1, unitPoints: null, unitUsd: null },
    { armId: "empty", count: 0, unitPoints: null, unitUsd: null },
  ]);
  assert.equal(estimate.totalPoints, 3 * 700 + 2 * 3_600);
  assert.equal(estimate.maxUnitPoints, 3_600);
  assert.deepEqual(estimate.unpricedArms, ["volc"]);
});

test("预算闸：没上限、超上限、余额穿预留线、没余额、未定价都拒绝；三关都过才放行", () => {
  const estimate = estimateSpend([{ armId: "buddy", count: 10, unitPoints: 700, unitUsd: null }]);
  const base = { estimate, maxPoints: 10_000, maxUsd: null, availablePoints: 50_000, reservePoints: SHUYU_RESERVE_POINTS_DEFAULT };
  assert.deepEqual(checkBudgetGate(base), { ok: true, reasons: [] });
  assert.match(checkBudgetGate({ ...base, maxPoints: null }).reasons.join(), /硬上限/);
  assert.match(checkBudgetGate({ ...base, maxPoints: 6_999 }).reasons.join(), /> 硬上限/);
  assert.match(checkBudgetGate({ ...base, availablePoints: 13_999 }).reasons.join(), /预留线/);
  assert.equal(checkBudgetGate({ ...base, availablePoints: 14_000 }).ok, true);
  assert.match(checkBudgetGate({ ...base, availablePoints: null }).reasons.join(), /余额/);
  const unpriced = estimateSpend([{ armId: "x", count: 1, unitPoints: null, unitUsd: null }]);
  assert.equal(checkBudgetGate({ ...base, estimate: unpriced }).ok, false);
  const usd = estimateSpend([{ armId: "volc", count: 2, unitPoints: null, unitUsd: 1.5 }]);
  assert.match(checkBudgetGate({ ...base, estimate: usd }).reasons.join(), /美元硬上限/);
  assert.equal(checkBudgetGate({ ...base, estimate: usd, maxUsd: 3 }).ok, true);
  assert.equal(checkBudgetGate({ ...base, estimate: usd, maxUsd: 2.99 }).ok, false);
});

test("上限解析：空/非数/≤0 都视为没给", () => {
  assert.equal(parsePositiveLimit(undefined), null);
  assert.equal(parsePositiveLimit(""), null);
  assert.equal(parsePositiveLimit("abc"), null);
  assert.equal(parsePositiveLimit("0"), null);
  assert.equal(parsePositiveLimit("-5"), null);
  assert.equal(parsePositiveLimit(" 8000 "), 8_000);
});
