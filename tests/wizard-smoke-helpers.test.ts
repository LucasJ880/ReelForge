import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSmokeResult,
  parseSmokeArgs,
  shouldRefuseDueToProduction,
  type SmokeWizardResult,
} from "../src/lib/services/wizard-smoke-helpers";

const okResult: SmokeWizardResult = {
  orderId: "do_1",
  scriptId: "sc_1",
  scenePlanIds: ["sp_1", "sp_2"],
  rawAssetIds: ["ra_1"],
  renderJobId: "rj_1",
  renderJobStatus: "DRAFT_READY",
  renderJobMode: "DRAFT",
  steps: [
    { name: "createOrder", status: "ok", detail: "do_1" },
    { name: "selectCard", status: "ok", detail: "real-estate-listing-walkthrough-pov" },
    { name: "generateScript", status: "ok" },
    { name: "generateStoryboard", status: "ok" },
    { name: "registerAsset", status: "ok" },
    { name: "createRender", status: "ok" },
  ],
};

test("evaluateSmokeResult: 全部 ok → pass", () => {
  const v = evaluateSmokeResult(okResult);
  assert.equal(v.ok, true);
  assert.equal(v.blockers.length, 0);
});

test("evaluateSmokeResult: orderId 缺失 → blocker", () => {
  const v = evaluateSmokeResult({ ...okResult, orderId: null });
  assert.equal(v.ok, false);
  assert.match(v.blockers.join("|"), /没有创建 DeliveryOrder/);
});

test("evaluateSmokeResult: 缺 createRender → blocker", () => {
  const v = evaluateSmokeResult({
    ...okResult,
    steps: okResult.steps.filter((s) => s.name !== "createRender"),
  });
  assert.equal(v.ok, false);
  assert.match(v.blockers.join("|"), /缺少必要 step：createRender/);
});

test("evaluateSmokeResult: render status FAILED → blocker", () => {
  const v = evaluateSmokeResult({ ...okResult, renderJobStatus: "FAILED" });
  assert.equal(v.ok, false);
  assert.match(v.blockers.join("|"), /render status 未达预期：FAILED/);
});

test("evaluateSmokeResult: MOCK 也算 pass", () => {
  const v = evaluateSmokeResult({
    ...okResult,
    renderJobMode: "MOCK",
    renderJobStatus: "MOCK",
  });
  assert.equal(v.ok, true);
});

test("evaluateSmokeResult: registerAsset failed 不算阻断", () => {
  const v = evaluateSmokeResult({
    ...okResult,
    steps: okResult.steps.map((s) =>
      s.name === "registerAsset"
        ? { name: "registerAsset", status: "failed" as const, detail: "network" }
        : s,
    ),
  });
  assert.equal(v.ok, true);
});

test("parseSmokeArgs: --cleanup / --allow-production", () => {
  assert.deepEqual(parseSmokeArgs([]), { cleanup: false, allowProduction: false });
  assert.deepEqual(parseSmokeArgs(["--cleanup"]), {
    cleanup: true,
    allowProduction: false,
  });
  assert.deepEqual(parseSmokeArgs(["--allow-production", "--cleanup"]), {
    cleanup: true,
    allowProduction: true,
  });
});

test("shouldRefuseDueToProduction: production 无 flag → refuse", () => {
  const r = shouldRefuseDueToProduction({
    nodeEnv: "production",
    allowProduction: false,
  });
  assert.equal(r.refuse, true);
  assert.match(r.reason ?? "", /production/);
});

test("shouldRefuseDueToProduction: production + allow → 放行", () => {
  const r = shouldRefuseDueToProduction({
    nodeEnv: "production",
    allowProduction: true,
  });
  assert.equal(r.refuse, false);
});

test("shouldRefuseDueToProduction: development → 放行", () => {
  const r = shouldRefuseDueToProduction({
    nodeEnv: "development",
    allowProduction: false,
  });
  assert.equal(r.refuse, false);
});
