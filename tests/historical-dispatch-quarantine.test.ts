import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { VideoJobStatus, VideoProvider } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  callProviderWithHistoricalGuard,
  HISTORICAL_DISPATCH_CUTOFF,
  isHistoricalDispatchQuarantined,
} from "../src/lib/services/historical-dispatch-quarantine";
import {
  reconcileVideoJob,
  retryFailedVideoJob,
  __test__ as videoServiceTest,
} from "../src/lib/services/video-service";

const OLD_JOB = {
  createdAt: new Date(HISTORICAL_DISPATCH_CUTOFF.getTime() - 1),
  dispatchQuarantineDecision: null,
};

const REAL_ENV = {
  VIDEO_PROVIDER: "byteplus",
  VIDEO_ENGINE_MOCK: "false",
  BYTEPLUS_ARK_API_KEY: "test-placeholder-never-used",
};

function installRealDispatchEnv(t: TestContext) {
  const keys = [
    "VIDEO_PROVIDER",
    "VIDEO_ENGINE_MOCK",
    "BYTEPLUS_ARK_API_KEY",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, REAL_ENV);
  t.after(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

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

test("RF-007：reconcile 与单任务 retry 均不能绕过历史隔离栏调用 provider", async (t) => {
  installRealDispatchEnv(t);

  const oldCreatedAt = new Date(HISTORICAL_DISPATCH_CUTOFF.getTime() - 1);
  const rows: Record<string, Record<string, unknown>> = {
    old_queued: {
      id: "old_queued",
      createdAt: oldCreatedAt,
      dispatchQuarantineDecision: null,
      status: VideoJobStatus.QUEUED,
      provider: VideoProvider.SEEDANCE_T2V,
      externalJobId: "provider_old_queued",
      timeoutAt: new Date(oldCreatedAt.getTime() - 60_000),
    },
    old_failed: {
      id: "old_failed",
      createdAt: oldCreatedAt,
      dispatchQuarantineDecision: null,
      status: VideoJobStatus.FAILED,
      provider: VideoProvider.SEEDANCE_T2V,
      externalJobId: "provider_old_failed",
      videoBriefId: "brief_old",
      errorMessage: "sweep: job timed out",
    },
  };

  const model = db.videoJob as unknown as Record<string, unknown>;
  const originals = {
    findUnique: model.findUnique,
    update: model.update,
    updateMany: model.updateMany,
  };
  let dbWrites = 0;
  model.findUnique = async (args: { where: { id: string } }) =>
    rows[args.where.id] ?? null;
  model.update = async () => {
    dbWrites += 1;
    throw new Error("隔离任务不应写状态");
  };
  model.updateMany = async () => {
    dbWrites += 1;
    throw new Error("隔离任务不应写状态");
  };
  t.after(() => {
    model.findUnique = originals.findUnique;
    model.update = originals.update;
    model.updateMany = originals.updateMany;
  });

  let providerCalls = 0;
  videoServiceTest.__setStatusFetcherForTests(async () => {
    providerCalls += 1;
    return {
      jobId: "must-not-be-called",
      status: "processing",
      rawProviderStatus: "running",
    };
  });
  t.after(() => videoServiceTest.__setStatusFetcherForTests(null));

  const reconciled = await reconcileVideoJob("old_queued");
  assert.equal(reconciled?.status, VideoJobStatus.QUEUED);
  await assert.rejects(
    () => retryFailedVideoJob("old_failed"),
    /历史任务仍处于派发隔离栏/,
  );
  assert.equal(providerCalls, 0, "所有查询/重提路径都必须产生 0 次 provider 调用");
  assert.equal(dbWrites, 0, "隔离任务不得先被 watchdog/sweeper 改状态后再绕过");
});
