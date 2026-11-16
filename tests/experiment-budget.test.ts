/**
 * 付费实验预算闸（scripts/lib/experiment-budget.ts）的纯函数：按臂估算、硬上限、余额预留线。不连库、不触网。
 * 导演线路、评测集、soak 跑批都过这道闸。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SHUYU_RESERVE_POINTS_DEFAULT,
  checkBudgetGate,
  estimateSpend,
  parsePositiveLimit,
} from "../scripts/lib/experiment-budget";

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
