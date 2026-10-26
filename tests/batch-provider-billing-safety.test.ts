import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  ProviderSubmissionState,
  VideoJobStatus,
  VideoProvider,
  type VideoJob,
} from "@prisma/client";
import { db } from "../src/lib/db";
import { classifyCustomerGenerationError } from "../src/lib/api/customer-generation-error";
import { __test__ as batchTest, retryFailedBatchJob } from "../src/lib/services/batch-service";
import {
  FRAME_QA_BLOCK_USER_ERROR,
  FRAME_QA_STATUS,
  decideFromVerdict,
  readFrameQaBlockCount,
} from "../src/lib/services/frame-qa-gate";
import { FRAME_QA_ERROR_PREFIX } from "../src/lib/video-generation/frame-qa";
import type {
  CreateVideoJobOptions,
  CreateVideoJobResult,
  VideoProvider as VideoProviderAdapter,
} from "../src/lib/video-generation/providers/types";

function patch(
  t: TestContext,
  target: Record<string, unknown>,
  values: Record<string, unknown>,
) {
  const originals: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = target[key];
    target[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) target[key] = value;
  });
}

function claimedJob(overrides: Partial<VideoJob> = {}) {
  return {
    id: "job-billing-safe",
    provider: VideoProvider.SEEDANCE_I2V,
    status: VideoJobStatus.RUNNING,
    submissionState: ProviderSubmissionState.NOT_STARTED,
    submitAttempts: 0,
    retryCount: 0,
    promptText: "show the product",
    negativePrompt: "morphing",
    assignedAssets: { assets: [{ id: "asset-1", url: "https://example.test/p.jpg" }], seed: 7 },
    templateSnapshot: {
      lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p" },
    },
    seed: 7,
    batchJobId: "batch-1",
    batchIndex: 0,
    createdAt: new Date("2026-07-13T20:00:00.000Z"),
    dispatchQuarantineDecision: null,
    claimOwner: "worker-1",
    ...overrides,
  } as unknown as VideoJob & { claimOwner: string };
}

function provider(
  create: (options: CreateVideoJobOptions) => Promise<CreateVideoJobResult>,
): VideoProviderAdapter {
  return {
    id: "byteplus",
    displayName: "Billing safety fixture",
    manualRetryBillingRisk: "possible",
    isConfigured: () => true,
    isMockMode: () => false,
    createVideoJob: create,
    getVideoJobStatus: async () => {
      throw new Error("unused");
    },
    cancelVideoJob: async () => ({ supported: false }),
    getGeneratedVideoUrl: () => null,
    normalizeProviderStatus: () => "unknown",
  };
}

function installProvider(t: TestContext, adapter: VideoProviderAdapter) {
  process.env.VIDEO_PROVIDER = "mock";
  process.env.VERCEL_ENV = "preview";
  batchTest.__setVideoProviderFactoryForTests(() => adapter);
  t.after(() => {
    batchTest.__setVideoProviderFactoryForTests(null);
    delete process.env.VIDEO_PROVIDER;
    delete process.env.VERCEL_ENV;
  });
}

test("RF-003: provider timeout becomes ACK_UNKNOWN and is never auto-requeued", async (t) => {
  let providerCalls = 0;
  installProvider(
    t,
    provider(async () => {
      providerCalls += 1;
      throw new Error("request timed out after upload");
    }),
  );

  const updates: Array<Record<string, unknown>> = [];
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    updateMany: async (args: { data: Record<string, unknown> }) => {
      updates.push(args.data);
      return { count: 1 };
    },
  });

  await batchTest.submitClaimedJob(claimedJob());

  assert.equal(providerCalls, 1);
  assert.equal(updates[0].submissionState, ProviderSubmissionState.SUBMITTING);
  assert.equal(updates[1].submissionState, ProviderSubmissionState.ACK_UNKNOWN);
  assert.equal(updates[1].status, VideoJobStatus.FAILED);
  assert.equal(updates[1].availableAt, null);
  assert.match(String(updates[1].userSafeError), /避免重复计费/);
});

test("RF-003: provider acknowledgement followed by DB persistence loss fails closed", async (t) => {
  let providerCalls = 0;
  installProvider(
    t,
    provider(async (options) => {
      providerCalls += 1;
      assert.equal(options.providerRequestKey, "job-billing-safe:attempt:1");
      return { providerJobId: "accepted-but-not-saved", providerId: "byteplus" };
    }),
  );

  const updates: Array<Record<string, unknown>> = [];
  let write = 0;
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    updateMany: async (args: { data: Record<string, unknown> }) => {
      updates.push(args.data);
      write += 1;
      return { count: write === 2 ? 0 : 1 };
    },
  });

  await batchTest.submitClaimedJob(claimedJob());

  assert.equal(providerCalls, 1);
  assert.equal(updates[2].submissionState, ProviderSubmissionState.ACK_UNKNOWN);
  assert.equal(updates[2].status, VideoJobStatus.FAILED);
  assert.match(String(updates[2].submissionErrorClass), /persistence/);
});

test("P03-B: provider acknowledgement writes the actual plan id and points onto the accepted row", async (t) => {
  installProvider(
    t,
    provider(async () => ({
      providerJobId: "accepted-degraded",
      providerId: "shuyu",
      providerPlanId: "video-plan-degrade-next",
      providerUnitPoints: 1200,
    })),
  );
  const updates: Array<Record<string, unknown>> = [];
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    updateMany: async (args: { data: Record<string, unknown> }) => {
      updates.push(args.data);
      return { count: 1 };
    },
  });

  await batchTest.submitClaimedJob(claimedJob());

  const accept = updates.find(
    (data) => data.submissionState === ProviderSubmissionState.ACCEPTED,
  );
  assert.ok(accept, "acknowledgement write exists");
  assert.equal(accept.externalJobId, "accepted-degraded");
  assert.equal(accept.providerPlanId, "video-plan-degrade-next");
  assert.equal(accept.providerUnitPoints, 1200);
});

test("P03-B: a provider that reports no plan leaves the batch creation-time cost snapshot untouched", async (t) => {
  installProvider(
    t,
    provider(async () => ({ providerJobId: "accepted-plain", providerId: "byteplus" })),
  );
  const updates: Array<Record<string, unknown>> = [];
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    updateMany: async (args: { data: Record<string, unknown> }) => {
      updates.push(args.data);
      return { count: 1 };
    },
  });

  await batchTest.submitClaimedJob(claimedJob());

  const accept = updates.find(
    (data) => data.submissionState === ProviderSubmissionState.ACCEPTED,
  );
  assert.ok(accept, "acknowledgement write exists");
  assert.ok(!("providerPlanId" in accept));
  assert.ok(!("providerUnitPoints" in accept));
});

test("RF-003: expired lease requeues only before submission; SUBMITTING is quarantined", async (t) => {
  const model = db.videoJob as unknown as Record<string, unknown>;
  const writes: Array<Record<string, unknown>> = [];
  patch(t, model, {
    findMany: async () => [
      { id: "not-started", submissionState: ProviderSubmissionState.NOT_STARTED },
      { id: "submitting", submissionState: ProviderSubmissionState.SUBMITTING },
    ],
    updateMany: async (args: { data: Record<string, unknown> }) => {
      writes.push(args.data);
      return { count: 1 };
    },
  });

  const recovered = await batchTest.recoverExpiredLeases("batch-1", new Date());
  assert.equal(recovered, 2);
  assert.equal(writes[0].status, VideoJobStatus.QUEUED);
  assert.equal(writes[0].submissionState, ProviderSubmissionState.NOT_STARTED);
  assert.equal(writes[1].status, VideoJobStatus.FAILED);
  assert.equal(writes[1].submissionState, ProviderSubmissionState.ACK_UNKNOWN);
});

test("RF-003: a batch ACK_UNKNOWN failure cannot be manually reset for paid resubmission", async (t) => {
  let updateCalls = 0;
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findFirst: async () => ({
      status: VideoJobStatus.FAILED,
      provider: VideoProvider.SEEDANCE_I2V,
      submissionState: ProviderSubmissionState.ACK_UNKNOWN,
      externalJobId: null,
      lastProviderStatus: null,
      errorMessage: "ack unknown",
    }),
    updateMany: async () => {
      updateCalls += 1;
      return { count: 1 };
    },
  });

  const retried = await retryFailedBatchJob("batch-1", "job-1");
  assert.deepEqual(retried, { outcome: "billing_unsafe" });
  assert.equal(updateCalls, 0);
});

test("RF-018: retry capability keeps explicit mock stalls recoverable without reopening real-provider ambiguity", async (t) => {
  const mockAdapter: VideoProviderAdapter = {
    ...provider(async () => ({ providerJobId: "mock", providerId: "mock" })),
    id: "mock",
    manualRetryBillingRisk: "none",
    isMockMode: () => true,
  };
  installProvider(t, mockAdapter);

  const stalled = {
    provider: VideoProvider.MOCK,
    videoRouteSnapshot: "mock",
    videoModelSnapshot: "aivora-deterministic-mock-v1",
    videoProviderAdapterSnapshot: "mock",
    submissionState: ProviderSubmissionState.ACCEPTED,
    externalJobId: "batchmock_stalled",
    lastProviderStatus: "running",
    errorMessage: "[watchdog:provider_stalled] no progress",
  };
  assert.equal(batchTest.isBillingSafeManualRetry(stalled), true);

  // Keep VIDEO_PROVIDER=mock from installProvider, but resolve the historical
  // real job from its persisted provider snapshot rather than today's default.
  batchTest.__setVideoProviderFactoryForTests(null);
  assert.equal(
    batchTest.isBillingSafeManualRetry({
      ...stalled,
      provider: VideoProvider.SEEDANCE_I2V,
      videoRouteSnapshot: "byteplus_international",
      videoModelSnapshot: "dreamina-seedance-2-0-260128",
      videoProviderAdapterSnapshot: "byteplus",
    }),
    false,
    "a real-provider timeout remains blocked until billing reconciliation",
  );
});

test("RF-033: paid-provider retry requires proof that no external job exists", () => {
  const base = {
    provider: VideoProvider.SEEDANCE_I2V,
    videoRouteSnapshot: "byteplus_international",
    videoModelSnapshot: "dreamina-seedance-2-0-260128",
    videoProviderAdapterSnapshot: "byteplus",
    submissionState: ProviderSubmissionState.NOT_STARTED,
    externalJobId: null,
    lastProviderStatus: null,
    errorMessage: null,
  };

  assert.equal(batchTest.isBillingSafeManualRetry(base), true);
  assert.equal(
    batchTest.isBillingSafeManualRetry({
      ...base,
      submissionState: ProviderSubmissionState.REJECTED,
    }),
    true,
  );
  assert.equal(
    batchTest.isBillingSafeManualRetry({
      ...base,
      submissionState: ProviderSubmissionState.REJECTED,
      externalJobId: "rejected-but-created",
    }),
    false,
  );
  assert.equal(
    batchTest.isBillingSafeManualRetry({
      ...base,
      submissionState: ProviderSubmissionState.ACCEPTED,
      externalJobId: "provider-job-failed",
      lastProviderStatus: "failed",
    }),
    false,
  );
  /// runtime LENS-1：帧质检拦截的段，供应商任务已确认完成——重试是一次新的生成，
  /// 不是「其实还在跑」的歧义重提；免费重抽次数由 frameQaDetail.blockCount 封顶。
  assert.equal(
    batchTest.isBillingSafeManualRetry({
      ...base,
      submissionState: ProviderSubmissionState.ACCEPTED,
      externalJobId: "provider-job-generated",
      lastProviderStatus: "succeeded",
      errorMessage: "[frame-qa] text overlay detected",
    }),
    true,
  );
  /// 质检前缀不是万能钥匙：提交状态不明、或根本没有确认过的供应商任务，照旧拒绝。
  assert.equal(
    batchTest.isBillingSafeManualRetry({
      ...base,
      submissionState: ProviderSubmissionState.ACK_UNKNOWN,
      externalJobId: "provider-job-generated",
      errorMessage: "[frame-qa] text overlay detected",
    }),
    false,
  );
  assert.equal(
    batchTest.isBillingSafeManualRetry({
      ...base,
      submissionState: ProviderSubmissionState.ACCEPTED,
      externalJobId: null,
      errorMessage: "[frame-qa] text overlay detected",
    }),
    false,
  );
});

test("runtime LENS-1：帧质检拦截的批量段可以重试，界面给出质检原因而不是「生成结果尚未确认」", async (t) => {
  installProvider(
    t,
    provider(async () => {
      throw new Error("retry must only requeue; the batch tick submits later");
    }),
  );
  /// 一条被质检拦下的段（reconcile 写的 FAILED：保留任务号、ACCEPTED、累计拦截 1 次）
  const row: Record<string, unknown> = {
    id: "job-frame-qa",
    batchJobId: "batch-1",
    status: VideoJobStatus.FAILED,
    provider: VideoProvider.SEEDANCE_I2V,
    videoRouteSnapshot: "buddy",
    videoModelSnapshot: "shuyu-video",
    videoProviderAdapterSnapshot: "shuyu",
    submissionState: ProviderSubmissionState.ACCEPTED,
    externalJobId: "shuyu-task-1",
    lastProviderStatus: "succeeded",
    errorMessage: `${FRAME_QA_ERROR_PREFIX} 帧质检拦截：第4帧 检测到画面叠加文字`,
    userSafeError: FRAME_QA_BLOCK_USER_ERROR,
    quotaRefundedAt: null,
    frameQaStatus: "BLOCKED",
    frameQaDetail: { v: 1, status: "BLOCKED", blockCount: 1 },
    retryCount: 0,
  };
  const casWheres: Array<Record<string, unknown>> = [];
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findFirst: async () => ({ ...row }),
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      casWheres.push(args.where);
      if (row.status !== args.where.status || row.submissionState !== args.where.submissionState) {
        return { count: 0 };
      }
      const { retryCount, ...rest } = args.data;
      Object.assign(row, rest, {
        retryCount: Number(row.retryCount) + Number((retryCount as { increment?: number })?.increment ?? 0),
      });
      return { count: 1 };
    },
    groupBy: async () => [],
  });
  patch(t, db.batchJob as unknown as Record<string, unknown>, {
    update: async () => ({}),
    findUnique: async () => ({
      id: "batch-1",
      userId: "customer-1",
      requestedCount: 1,
      updatedAt: new Date(),
      finishedAt: null,
    }),
  });

  /// 序列化器先说实话：这条可以重试，原因是质检拦截
  const error = classifyCustomerGenerationError({
    status: "FAILED",
    submissionState: String(row.submissionState),
    errorMessage: String(row.errorMessage),
    userSafeError: String(row.userSafeError),
    billingSafeToRetry: batchTest.isBillingSafeManualRetry(row as never),
  });
  assert.deepEqual(error, {
    code: "PROVIDER_ERROR",
    message: FRAME_QA_BLOCK_USER_ERROR,
    retryable: true,
    action: "retry",
  });
  /// 即便某条拦截段不能重试，原因也得是质检，不是「生成结果尚未确认」
  const blocked = classifyCustomerGenerationError({
    status: "FAILED",
    submissionState: "ACCEPTED",
    errorMessage: String(row.errorMessage),
    userSafeError: String(row.userSafeError),
    billingSafeToRetry: false,
  });
  assert.equal(blocked?.action, "contact_support");
  assert.match(String(blocked?.message), /画面质检未通过/);
  assert.doesNotMatch(String(blocked?.message), /尚未确认/);

  /// 拦截 → 重试 → 再拦截 → 再重试 → 第 3 次检出按 WOULD_BLOCK 放行
  assert.deepEqual(await retryFailedBatchJob("batch-1", "job-frame-qa"), { outcome: "retried" });
  assert.equal(row.status, VideoJobStatus.QUEUED);
  assert.equal(row.externalJobId, null, "新一轮从零提交");
  assert.deepEqual(row.frameQaDetail, { v: 1, status: "BLOCKED", blockCount: 1 }, "累计拦截次数随行保留");

  const BLOCK = {
    ok: false,
    checked: true,
    frameCount: 6,
    issues: [{ frameIndex: 3, detail: "检测到画面叠加文字" }],
    summary: "帧质检拦截：第4帧 检测到画面叠加文字",
  };
  const second = decideFromVerdict({
    verdict: BLOCK,
    priorBlockCount: readFrameQaBlockCount(row.frameQaDetail),
    checkedAt: new Date(),
  });
  assert.equal(second.action, "block");
  if (second.action !== "block") return;
  /// 第二次拦截：reconcile 按 failureData 写回 FAILED（新任务号、ACCEPTED）
  Object.assign(row, second.failureData, {
    status: VideoJobStatus.FAILED,
    submissionState: ProviderSubmissionState.ACCEPTED,
    externalJobId: "shuyu-task-2",
  });
  assert.equal(readFrameQaBlockCount(row.frameQaDetail), 2);

  assert.deepEqual(await retryFailedBatchJob("batch-1", "job-frame-qa"), { outcome: "retried" });
  const third = decideFromVerdict({
    verdict: BLOCK,
    priorBlockCount: readFrameQaBlockCount(row.frameQaDetail),
    checkedAt: new Date(),
  });
  assert.equal(third.action, "pass", "免费重抽用满后放行，不会无限重抽");
  if (third.action !== "pass") return;
  assert.equal(third.successData.frameQaStatus, FRAME_QA_STATUS.WOULD_BLOCK);
  assert.equal(row.retryCount, 2);
  assert.ok(
    casWheres.every((where) => where.status === VideoJobStatus.FAILED),
    "重试只翻 FAILED 行（CAS）",
  );
});
