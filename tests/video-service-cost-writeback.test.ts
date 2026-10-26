import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  ProviderSubmissionState,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";
import { db } from "../src/lib/db";
import { planSegments } from "../src/lib/duration/segment-planner";
import { __test__ as directorTest } from "../src/lib/services/director-service";
import {
  dispatchVideoGeneration,
  retryFailedVideoJob,
  __test__ as videoTest,
} from "../src/lib/services/video-service";
import { HISTORICAL_DISPATCH_CUTOFF } from "../src/lib/services/historical-dispatch-quarantine";
import { parseDirectorPlan } from "../src/lib/schemas/director-plan";

/**
 * P03-B 账实一致：单条视频提交被供应商受理后，行上的计价快照要换成「本次实际
 * 使用的套餐」（Shuyu 提交级降级会让实际套餐与创建时按默认套餐的估价不同）。
 *
 * 覆盖四处 submitVideoJob → persistAcceptedSubmission 调用点：
 *   1. submitSegmentJob（多段流首次提交）
 *   2. dispatchVideoGeneration（按镜头提交，旧单段流）
 *   3. retryFailedVideoJob 段重试分支
 *   4. retryFailedVideoJob 单段旧路径重试分支
 * 以及两条守卫：供应商没返回套餐时不覆盖创建时快照；CAS 落空时什么都不写。
 */

type Row = Record<string, unknown>;
type Write = { where: Row; data: Row };

const BYTEPLUS_ROUTE = {
  videoRouteSnapshot: "byteplus_international" as const,
  videoModelSnapshot: "dreamina-seedance-2-0-260128",
  videoProviderAdapterSnapshot: "byteplus" as const,
};
const BUDDY_ROUTE = {
  videoRouteSnapshot: "buddy" as const,
  videoModelSnapshot: "studio-video",
  videoProviderAdapterSnapshot: "shuyu" as const,
};

/// 创建行时按默认套餐落下的估价（模拟 resolveVideoRouteCostSnapshot 的结果）
const ESTIMATED_AT_CREATE = {
  providerPlanId: null,
  providerUnitPoints: 900,
  providerUnitPriceUsd: null,
};
/// 供应商受理时报告的实际套餐（提交级降级后换到的档）
const ACTUAL_AT_ACCEPT = {
  providerPlanId: "video-plan-fallback",
  providerUnitPoints: 700,
};

function patch(t: TestContext, target: Row, values: Row) {
  const originals: Row = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = target[key];
    target[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) target[key] = value;
  });
}

function installRealMode(t: TestContext) {
  const keys = ["VIDEO_PROVIDER", "VIDEO_ENGINE_MOCK", "VERCEL_ENV"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.VIDEO_PROVIDER = "byteplus";
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.VERCEL_ENV = "preview";
  /// 这些测试全部走 submitter 测试钩子，不该有任何真实网络请求（含 Shuyu /prices）。
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    throw new Error(`unexpected network call in cost writeback test: ${String(input)}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    videoTest.__setStatusFetcherForTests(null);
    videoTest.__setSubmitterForTests(null);
  });
}

/**
 * 单行 VideoJob 假表：updateMany 按 where 里的标量条件做 CAS（对象型过滤如
 * `{ in: [...] }` 不参与），所以 providerRequestKey / submissionState 不匹配时
 * 返回 count=0，与真实 Prisma 行为一致。create 时叠上创建时的估价。
 */
function fakeVideoJobTable(t: TestContext, seed: Row | null = null) {
  let row: Row | null = seed;
  const writes: Write[] = [];
  patch(t, db.videoJob as unknown as Row, {
    create: async (args: { data: Row }) => {
      row = {
        createdAt: new Date(),
        pollErrors: 0,
        retryCount: 0,
        dispatchQuarantineDecision: null,
        ...ESTIMATED_AT_CREATE,
        ...args.data,
      };
      return { ...row };
    },
    findUnique: async () => (row ? { ...row, videoBrief: {} } : null),
    findMany: async () => (row ? [{ ...row }] : []),
    updateMany: async (args: Write) => {
      writes.push({ where: args.where, data: args.data });
      if (!row) return { count: 0 };
      for (const [key, expected] of Object.entries(args.where)) {
        if (expected !== null && typeof expected === "object") continue;
        if (row[key] !== expected) return { count: 0 };
      }
      const next = { ...args.data };
      const attempts = next.submitAttempts;
      if (attempts && typeof attempts === "object" && "increment" in attempts) {
        next.submitAttempts =
          Number(row.submitAttempts ?? 0) +
          Number((attempts as { increment: number }).increment);
      }
      Object.assign(row, next);
      return { count: 1 };
    },
    update: async (args: { data: Row }) => {
      if (!row) throw new Error("missing row");
      Object.assign(row, args.data);
      return { ...row };
    },
  });
  return {
    get row(): Row {
      assert.ok(row, "expected a persisted VideoJob row");
      return row;
    },
    writes,
    acceptWrite(): Write {
      const accepts = writes.filter(
        (write) => write.data.submissionState === ProviderSubmissionState.ACCEPTED,
      );
      assert.equal(accepts.length, 1, "exactly one acknowledgement write");
      return accepts[0];
    },
  };
}

function directorPlan() {
  return parseDirectorPlan(
    directorTest.mockDirectorPlan({
      targetDurationSec: 15,
      segmentSlots: planSegments(15),
      clientBrief: { businessName: "Acme", productName: "Acme Pro" },
      productInput: {},
      targetCountry: "US",
      targetLanguage: "en-US",
      targetPlatform: "tiktok",
      angle: {
        title: "Product proof",
        hook: "Show the real product",
        narrative: null,
        type: "OPTIMIZATION",
        explorationTheme: null,
        localeNotes: null,
      },
    }),
  );
}

function failedSegmentJob(overrides: Row = {}): Row {
  return {
    id: "job-cost-retry",
    status: VideoJobStatus.FAILED,
    provider: VideoProvider.SEEDANCE_T2V,
    ...BYTEPLUS_ROUTE,
    externalJobId: "provider-original",
    submissionState: ProviderSubmissionState.ACCEPTED,
    providerRequestKey: "job-cost-retry:attempt:1",
    submitAttempts: 1,
    retryCount: 0,
    videoBriefId: "brief-cost-retry",
    segmentIndex: 0,
    finalVideoId: "final-cost-retry",
    errorMessage: "provider failed",
    createdAt: new Date(HISTORICAL_DISPATCH_CUTOFF.getTime() + 60_000),
    dispatchQuarantineDecision: null,
    ...ESTIMATED_AT_CREATE,
    ...overrides,
  };
}

function assertActualSnapshotPersisted(table: ReturnType<typeof fakeVideoJobTable>) {
  const { data } = table.acceptWrite();
  assert.equal(data.providerPlanId, ACTUAL_AT_ACCEPT.providerPlanId);
  assert.equal(data.providerUnitPoints, ACTUAL_AT_ACCEPT.providerUnitPoints);
  assert.equal(table.row.submissionState, ProviderSubmissionState.ACCEPTED);
  assert.equal(table.row.providerPlanId, ACTUAL_AT_ACCEPT.providerPlanId);
  assert.equal(table.row.providerUnitPoints, ACTUAL_AT_ACCEPT.providerUnitPoints);
}

test("调用点 1 · submitSegmentJob：受理后以实际套餐覆盖创建时估价；buddy 线路美元位为 null", async (t) => {
  installRealMode(t);
  const table = fakeVideoJobTable(t);
  const plan = directorPlan();
  videoTest.__setSubmitterForTests(async () => ({
    jobId: "shuyu-task-1",
    ...ACTUAL_AT_ACCEPT,
  }));

  const job = await videoTest.submitSegmentJob({
    briefId: "brief-cost-1",
    finalVideoId: "final-cost-1",
    aspectRatio: "9:16",
    segment: plan.segmentPlan[0],
    segmentCount: 1,
    referenceImageUrls: [],
    routeSnapshot: BUDDY_ROUTE,
  });

  assert.equal(job?.externalJobId, "shuyu-task-1");
  assertActualSnapshotPersisted(table);
  const { where, data } = table.acceptWrite();
  assert.equal(data.providerUnitPriceUsd, null, "积分计价线路不记美元单价");
  /// CAS 条件不因回写而改变
  assert.equal(where.submissionState, ProviderSubmissionState.SUBMITTING);
  assert.equal(where.providerRequestKey, table.row.providerRequestKey);
});

test("调用点 2 · dispatchVideoGeneration：按镜头提交同样回写；非 buddy 线路不写美元位（口径尚未接入）", async (t) => {
  installRealMode(t);
  const table = fakeVideoJobTable(t);
  const brief = {
    id: "brief-cost-scene",
    status: "RENDER_QUEUED",
    errorMessage: null,
    finalVideoId: null,
    aspectRatio: "9:16",
    durationSec: 15,
    referenceImageUrls: [],
    ...BYTEPLUS_ROUTE,
    scripts: [{ id: "script-cost-scene" }],
  };
  patch(t, db.videoBrief as unknown as Row, {
    findUnique: async () => ({ ...brief }),
    update: async () => ({ ...brief }),
  });
  patch(t, db.scenePlan as unknown as Row, {
    findMany: async () => [
      {
        id: "scene-cost-1",
        sceneIndex: 0,
        durationSec: 10,
        videoPrompts: [
          {
            promptText: "Show the real product on a desk",
            provider: VideoProvider.SEEDANCE_T2V,
            params: { ratio: "9:16" },
            referenceImageUrl: null,
          },
        ],
      },
    ],
  });
  videoTest.__setSubmitterForTests(async () => ({
    jobId: "ark-task-1",
    ...ACTUAL_AT_ACCEPT,
  }));

  const created = await dispatchVideoGeneration("brief-cost-scene");

  assert.equal(created.length, 1);
  assert.equal(created[0]?.externalJobId, "ark-task-1");
  assertActualSnapshotPersisted(table);
  const { data } = table.acceptWrite();
  assert.ok(
    !("providerUnitPriceUsd" in data),
    "resolveVideoRouteCostSnapshot 尚未接入美元价：不写、不写 null 盖掉",
  );
});

test("调用点 3 · retryFailedVideoJob 段重试：重试受理后回写实际套餐，retryCount 同步", async (t) => {
  installRealMode(t);
  const table = fakeVideoJobTable(t, failedSegmentJob());
  patch(t, db.videoBrief as unknown as Row, {
    findUnique: async () => ({
      aspectRatio: "9:16",
      directorPlan: directorPlan(),
      referenceImageUrls: [],
      videoGenerationPlan: null,
    }),
  });
  patch(t, db.finalVideo as unknown as Row, { update: async () => ({}) });
  videoTest.__setStatusFetcherForTests(async () => ({
    jobId: "provider-original",
    status: "failed",
    rawProviderStatus: "failed",
  }));
  videoTest.__setSubmitterForTests(async () => ({
    jobId: "provider-retry",
    ...ACTUAL_AT_ACCEPT,
  }));

  const updated = await retryFailedVideoJob("job-cost-retry");

  assert.equal(updated.externalJobId, "provider-retry");
  assertActualSnapshotPersisted(table);
  assert.equal(table.acceptWrite().data.retryCount, 1);
});

test("调用点 4 · retryFailedVideoJob 单段旧路径：从 ScenePlan 重提后同样回写", async (t) => {
  installRealMode(t);
  const table = fakeVideoJobTable(
    t,
    failedSegmentJob({
      segmentIndex: null,
      finalVideoId: null,
      externalJobId: null,
      submissionState: ProviderSubmissionState.REJECTED,
      providerRequestKey: null,
    }),
  );
  patch(t, db.scenePlan as unknown as Row, {
    findFirst: async () => ({
      id: "scene-legacy",
      sceneIndex: 0,
      durationSec: 12,
      videoPrompts: [
        {
          promptText: "Legacy single scene",
          provider: VideoProvider.SEEDANCE_T2V,
          params: { ratio: "9:16" },
          referenceImageUrl: null,
        },
      ],
    }),
  });
  patch(t, db.videoBrief as unknown as Row, {
    findUnique: async () => ({ referenceImageUrls: [] }),
  });
  videoTest.__setSubmitterForTests(async () => ({
    jobId: "provider-legacy-retry",
    ...ACTUAL_AT_ACCEPT,
  }));

  const updated = await retryFailedVideoJob("job-cost-retry");

  assert.equal(updated.externalJobId, "provider-legacy-retry");
  assertActualSnapshotPersisted(table);
});

test("供应商没返回套餐（byteplus / mock）：不覆盖创建时的计价快照", async (t) => {
  installRealMode(t);
  const table = fakeVideoJobTable(t);
  const plan = directorPlan();
  videoTest.__setSubmitterForTests(async () => ({ jobId: "ark-task-plain" }));

  await videoTest.submitSegmentJob({
    briefId: "brief-cost-plain",
    finalVideoId: "final-cost-plain",
    aspectRatio: "9:16",
    segment: plan.segmentPlan[0],
    segmentCount: 1,
    referenceImageUrls: [],
    routeSnapshot: BYTEPLUS_ROUTE,
  });

  const { data } = table.acceptWrite();
  assert.ok(!("providerPlanId" in data), "没值就不写 providerPlanId");
  assert.ok(!("providerUnitPoints" in data), "没值就不写 providerUnitPoints");
  assert.equal(table.row.submissionState, ProviderSubmissionState.ACCEPTED);
  assert.equal(table.row.providerUnitPoints, ESTIMATED_AT_CREATE.providerUnitPoints);
  assert.equal(table.row.providerPlanId, ESTIMATED_AT_CREATE.providerPlanId);
});

test("CAS 落空（幂等键已被另一轮接管）：受理回写整体不落地，计价快照保持原值", async (t) => {
  installRealMode(t);
  const table = fakeVideoJobTable(
    t,
    failedSegmentJob({
      status: VideoJobStatus.RUNNING,
      submissionState: ProviderSubmissionState.SUBMITTING,
      providerRequestKey: "job-cost-retry:attempt:2",
      externalJobId: null,
    }),
  );

  await assert.rejects(
    () =>
      videoTest.persistAcceptedSubmission({
        jobId: "job-cost-retry",
        providerRequestKey: "job-cost-retry:attempt:1",
        externalJobId: "stale-attempt-task",
        submittedAt: new Date(),
        ...ACTUAL_AT_ACCEPT,
      }),
    /could not be persisted/,
  );

  assert.equal(table.row.externalJobId, null);
  assert.equal(table.row.providerUnitPoints, ESTIMATED_AT_CREATE.providerUnitPoints);
  assert.equal(table.row.providerPlanId, ESTIMATED_AT_CREATE.providerPlanId);
  assert.equal(table.row.submissionState, ProviderSubmissionState.SUBMITTING);
});
