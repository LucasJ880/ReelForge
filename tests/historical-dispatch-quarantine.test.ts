import assert from "node:assert/strict";
import test from "node:test";
import {
  callProviderWithHistoricalGuard,
  HISTORICAL_DISPATCH_CUTOFF,
  isHistoricalDispatchQuarantined,
} from "../src/lib/services/historical-dispatch-quarantine";

const OLD_JOB = {
  createdAt: new Date(HISTORICAL_DISPATCH_CUTOFF.getTime() - 1),
  dispatchQuarantineDecision: null,
};

const REAL_ENV = {
  VIDEO_PROVIDER: "byteplus",
  VIDEO_ENGINE_MOCK: "false",
  BYTEPLUS_ARK_API_KEY: "test-placeholder-never-used",
};

test("GATE0-6：mock 关闭 + 密钥存在时，隔离栏旧任务产生 0 次 provider 调用", async () => {
  let providerCalls = 0;
  const result = await callProviderWithHistoricalGuard({
    record: OLD_JOB,
    env: REAL_ENV,
    call: async () => {
      providerCalls += 1;
      return "provider-job-id";
    },
  });

  assert.deepEqual(result, { called: false });
  assert.equal(providerCalls, 0);
});

test("GATE0-6：mock 模式仍可回归旧任务，不触发真实模式隔离", async () => {
  let providerCalls = 0;
  const result = await callProviderWithHistoricalGuard({
    record: OLD_JOB,
    env: { VIDEO_PROVIDER: "mock", VIDEO_ENGINE_MOCK: "true" },
    call: async () => {
      providerCalls += 1;
      return "mock-job-id";
    },
  });

  assert.equal(result.called, true);
  assert.equal(providerCalls, 1);
});

test("GATE0-6：人工 RELEASED 放行；EXPIRED 在 mock 下也永久阻断", () => {
  assert.equal(
    isHistoricalDispatchQuarantined(
      { ...OLD_JOB, dispatchQuarantineDecision: "RELEASED" },
      REAL_ENV,
    ),
    false,
  );
  assert.equal(
    isHistoricalDispatchQuarantined(
      { ...OLD_JOB, dispatchQuarantineDecision: "EXPIRED" },
      { VIDEO_PROVIDER: "mock", VIDEO_ENGINE_MOCK: "true" },
    ),
    true,
  );
});

test("GATE0-6：截止线之后的新任务不被历史隔离栏误拦", () => {
  assert.equal(
    isHistoricalDispatchQuarantined(
      {
        createdAt: new Date(HISTORICAL_DISPATCH_CUTOFF.getTime() + 1),
        dispatchQuarantineDecision: null,
      },
      REAL_ENV,
    ),
    false,
  );
});
