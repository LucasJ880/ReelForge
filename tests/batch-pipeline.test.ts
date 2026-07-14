import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  BatchJobStatus,
  ProviderSubmissionState,
  StyleTemplateStatus,
  VideoJobStatus,
  VideoProvider,
  type StyleTemplate,
} from "@prisma/client";
import { db } from "../src/lib/db";
import { __resetAppEnvForTests } from "../src/lib/config/env";
import {
  __test__,
  BatchImageIdConflictError,
  buildBatchVideoRows,
  createBatchJob,
  deriveBatchStatus,
} from "../src/lib/services/batch-service";

const TEMPLATE: StyleTemplate = {
  id: "tpl_batch_test",
  slug: "batch-test",
  version: 1,
  name: "Batch Test",
  nameZh: "批量测试",
  category: "测试",
  coverImage: "https://cdn.test/cover.jpg",
  promptSkeleton:
    "Use {IMAGE_REFS} to film {PRODUCT_NAME}. Camera pushes in. Softbox lighting. Fast pacing.",
  negativePrompt: "label blur, product morphing, text overlay",
  lockedParams: {
    duration: 10,
    aspectRatio: "9:16",
    resolution: "1080p",
    cameraStyle: "push in",
  },
  imagesPerVideo: { min: 1, max: 1 },
  status: StyleTemplateStatus.ACTIVE,
  activatedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const IMAGES = Array.from({ length: 20 }, (_, index) => ({
  id: `img_${index}`,
  url: `https://cdn.test/${index}.jpg`,
}));

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

test("INV-B1/B2：展开行只含模板填空 prompt，分配快照与模板版本可审计", () => {
  const rows = buildBatchVideoRows({
    batchId: "batch_rows",
    template: TEMPLATE,
    images: IMAGES,
    requestedCount: 100,
    productName: "Aivora Bottle",
    provider: "MOCK",
  });
  assert.equal(rows.length, 100);
  for (const [index, row] of rows.entries()) {
    assert.equal(row.batchItemKey, `batch_rows:${index}`);
    assert.match(row.promptText ?? "", /Aivora Bottle/);
    assert.match(row.promptText ?? "", /https:\/\/cdn\.test\//);
    assert.doesNotMatch(row.promptText ?? "", /\{IMAGE_REFS\}|\{PRODUCT_NAME\}/);
    assert.equal(
      (row.templateSnapshot as { version: number }).version,
      TEMPLATE.version,
    );
    assert.ok(row.assignedAssets);
  }
});

test("API-BATCH：重复图片 ID 在任何数据库访问前以 409 冲突拒绝", async (t) => {
  const batchModel = db.batchJob as unknown as Record<string, unknown>;
  let databaseTouched = false;
  patch(t, batchModel, {
    findUnique: async () => {
      databaseTouched = true;
      throw new Error("重复图片 ID 不应触发数据库访问");
    },
  });

  await assert.rejects(
    () =>
      createBatchJob({
        userId: "user_duplicate_images",
        templateId: TEMPLATE.id,
        templateVersion: TEMPLATE.version,
        images: [
          { id: "duplicate", url: "https://cdn.test/a.jpg" },
          { id: "duplicate", url: "https://cdn.test/b.jpg" },
        ],
        requestedCount: 2,
        idempotencyKey: "duplicate-image-request",
      }),
    (error: unknown) => {
      assert.ok(error instanceof BatchImageIdConflictError);
      assert.equal(error.code, "BATCH_IMAGE_ID_CONFLICT");
      assert.equal(error.httpStatus, 409);
      assert.match(error.message, /图片 ID 不得重复/);
      return true;
    },
  );
  assert.equal(databaseTouched, false);
});

test("AC-B4：同一 idempotencyKey 连发 3 次，只展开 N 个 VideoJob", async (t) => {
  process.env.VIDEO_PROVIDER = "mock";
  __resetAppEnvForTests();
  t.after(() => {
    delete process.env.VIDEO_PROVIDER;
    __resetAppEnvForTests();
  });

  let storedBatch: Record<string, unknown> | null = null;
  let videoJobCount = 0;
  const batchModel = db.batchJob as unknown as Record<string, unknown>;
  const styleModel = db.styleTemplate as unknown as Record<string, unknown>;
  const prisma = db as unknown as Record<string, unknown>;

  patch(t, batchModel, {
    findUnique: async () => storedBatch,
  });
  patch(t, styleModel, {
    findFirst: async () => TEMPLATE,
  });
  const tx = {
    batchJob: {
      findUnique: async () => storedBatch,
      create: async (args: { data: Record<string, unknown> }) => {
        storedBatch = {
          id: "batch_idempotent",
          ...args.data,
          queuedCount: 0,
          runningCount: 0,
          pausedCount: 0,
          completedCount: 0,
          failedCount: 0,
          cancelledCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return storedBatch;
      },
      update: async (args: { data: Record<string, unknown> }) => {
        storedBatch = { ...storedBatch, ...args.data };
        return storedBatch;
      },
    },
    videoJob: {
      createMany: async (args: { data: unknown[] }) => {
        videoJobCount += args.data.length;
        return { count: args.data.length };
      },
    },
  };
  patch(t, prisma, {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  });

  const input = {
    userId: "user_1",
    templateId: TEMPLATE.id,
    templateVersion: 1,
    images: IMAGES,
    requestedCount: 100,
    productName: "Bottle",
    idempotencyKey: "idem_same",
  };
  const [first, second, third] = [
    await createBatchJob(input),
    await createBatchJob(input),
    await createBatchJob(input),
  ];

  assert.equal(first.id, second.id);
  assert.equal(second.id, third.id);
  assert.equal(videoJobCount, 100, "重复请求不得二次展开");
  await assert.rejects(
    () =>
      createBatchJob({
        ...input,
        requestedCount: 99,
      }),
    /Idempotency-Key.*不同|不同的批量生成请求/,
    "同 key + 不同 payload 必须冲突，不能静默复用旧批次",
  );
});

test("AC-B3/INV-B5：200 个任务受信号量限制，peak 不超过 10 且真实并行", async () => {
  let inFlight = 0;
  let peak = 0;
  const started = Date.now();
  await __test__.mapConcurrent(
    Array.from({ length: 200 }, (_, index) => index),
    10,
    async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
    },
  );
  const elapsed = Date.now() - started;
  const expected = (200 / 10) * 10;
  assert.equal(peak, 10);
  assert.ok(elapsed >= expected * 0.7, `不能是假延迟: ${elapsed}ms`);
  assert.ok(elapsed < expected * 3, `应为并行而非串行: ${elapsed}ms`);
});

test("INV-B6：一条失败不阻塞其他条目，批次聚合为 partial_failed", () => {
  assert.equal(
    deriveBatchStatus({
      requestedCount: 100,
      counts: {
        [VideoJobStatus.SUCCEEDED]: 99,
        [VideoJobStatus.FAILED]: 1,
      },
    }),
    BatchJobStatus.PARTIAL_FAILED,
  );
});

test("批次状态：只要仍有 queued/running 就继续 RUNNING；全成功才 COMPLETED", () => {
  assert.equal(
    deriveBatchStatus({
      requestedCount: 100,
      counts: {
        [VideoJobStatus.SUCCEEDED]: 90,
        [VideoJobStatus.RUNNING]: 10,
      },
    }),
    BatchJobStatus.RUNNING,
  );
  assert.equal(
    deriveBatchStatus({
      requestedCount: 100,
      counts: { [VideoJobStatus.SUCCEEDED]: 100 },
    }),
    BatchJobStatus.COMPLETED,
  );
});

test("AC-B5：熔断 open 将剩余任务 PAUSED，closed 后自动恢复 QUEUED", async (t) => {
  const videoModel = db.videoJob as unknown as Record<string, unknown>;
  const batchModel = db.batchJob as unknown as Record<string, unknown>;
  const prisma = db as unknown as Record<string, unknown>;
  const videoUpdates: Array<Record<string, unknown>> = [];
  const batchUpdates: Array<Record<string, unknown>> = [];
  patch(t, videoModel, {
    updateMany: async (args: Record<string, unknown>) => {
      videoUpdates.push(args);
      return { count: 90 };
    },
  });
  patch(t, batchModel, {
    update: async (args: Record<string, unknown>) => {
      batchUpdates.push(args);
      return {};
    },
    updateMany: async (args: Record<string, unknown>) => {
      batchUpdates.push(args);
      return { count: 1 };
    },
  });
  patch(t, prisma, {
    $transaction: async (promises: Promise<unknown>[]) => Promise.all(promises),
  });
  const sample = {
    windowMin: 60,
    terminal: 3,
    stalled: 3,
    providerFailed: 0,
    succeeded: 0,
    inflight: 1,
    stallRate: 1,
    unhealthyRate: 1,
  };

  await __test__.applyBreaker("batch_breaker", {
    state: "open",
    allowed: false,
    sample,
    reason: "provider unhealthy",
  });
  assert.equal(
    (videoUpdates[0].data as { status: string }).status,
    VideoJobStatus.PAUSED,
  );
  assert.equal(
    (batchUpdates[0].data as { status: string }).status,
    BatchJobStatus.PAUSED,
  );

  await __test__.applyBreaker("batch_breaker", {
    state: "closed",
    allowed: true,
    sample: { ...sample, unhealthyRate: 0, stalled: 0 },
    reason: "recovered",
  });
  assert.equal(
    (videoUpdates[1].data as { status: string }).status,
    VideoJobStatus.QUEUED,
  );
  assert.equal(
    (batchUpdates[1].data as { status: string }).status,
    BatchJobStatus.RUNNING,
  );
});

test("INV-B3：worker 提交中被 kill 后，过期租约自动重排而不悬空", async (t) => {
  const videoModel = db.videoJob as unknown as Record<string, unknown>;
  let updateData: Record<string, unknown> | null = null;
  patch(t, videoModel, {
    findMany: async () => [
      {
        id: "job_orphaned_claim",
        submissionState: ProviderSubmissionState.NOT_STARTED,
      },
    ],
    updateMany: async (args: { data: Record<string, unknown> }) => {
      updateData = args.data;
      return { count: 1 };
    },
  });
  const recovered = await __test__.recoverExpiredLeases(
    "batch_worker_killed",
    new Date(),
  );
  assert.equal(recovered, 1);
  assert.ok(updateData);
  assert.equal(
    (updateData as Record<string, unknown>).status,
    VideoJobStatus.QUEUED,
  );
  assert.equal((updateData as Record<string, unknown>).leaseOwner, null);
});

test("全局并发：只回收已越过硬 deadline 的 provider 槽，避免废弃批次饿死新批次", async (t) => {
  const videoModel = db.videoJob as unknown as Record<string, unknown>;
  let findArgs: Record<string, unknown> | null = null;
  patch(t, videoModel, {
    findMany: async (args: Record<string, unknown>) => {
      findArgs = args;
      return [
        { id: "expired_1", batchJobId: null },
        { id: "expired_2", batchJobId: null },
      ];
    },
  });
  process.env.WATCHDOG_GRACE_MIN = "2";
  t.after(() => delete process.env.WATCHDOG_GRACE_MIN);
  const reconciled: string[] = [];
  const now = new Date("2026-07-13T18:00:00.000Z");

  const expired = await __test__.expireHardDeadlineProviderSlots(
    VideoProvider.MOCK,
    now,
    async (jobId) => {
      reconciled.push(jobId);
    },
  );

  assert.equal(expired, 2);
  assert.deepEqual(reconciled.sort(), ["expired_1", "expired_2"]);
  assert.ok(findArgs);
  const where = (findArgs as { where: Record<string, unknown> }).where;
  assert.equal(where.provider, VideoProvider.MOCK);
  assert.equal(where.status, VideoJobStatus.RUNNING);
  assert.deepEqual(where.timeoutAt, {
    lt: new Date("2026-07-13T17:58:00.000Z"),
  });
});

test("派发槽位：历史隔离与 EXPIRED 的 RUNNING 任务不占用实时并发", () => {
  assert.deepEqual(__test__.dispatchableRunningSlotFilter(true), {
    OR: [
      { dispatchQuarantineDecision: "RELEASED" },
      {
        dispatchQuarantineDecision: null,
        createdAt: { gt: new Date("2026-07-13T14:35:00.000Z") },
      },
    ],
  });
  assert.deepEqual(__test__.dispatchableRunningSlotFilter(false), {
    OR: [
      { dispatchQuarantineDecision: null },
      { dispatchQuarantineDecision: "RELEASED" },
    ],
  });
});

test("派发领取：10 个候选使用一次批量 CAS，避免 Neon 逐行事务超时", async (t) => {
  const prisma = db as unknown as Record<string, unknown>;
  const candidates = Array.from({ length: 10 }, (_, index) => ({
    id: `claim_${index}`,
    batchIndex: index,
  }));
  let findManyCalls = 0;
  let updateManyCalls = 0;
  const countFilters: unknown[] = [];
  const tx = {
    batchJob: {
      findUnique: async () => ({
        userId: "claim_user",
        user: { workspace: { plan: { batchConcurrencyLimit: 10 } } },
      }),
    },
    videoJob: {
      findFirst: async () => ({ provider: VideoProvider.MOCK }),
      count: async (args: { where: unknown }) => {
        countFilters.push(args.where);
        return 0;
      },
      findMany: async () => {
        findManyCalls += 1;
        return candidates;
      },
      updateMany: async () => {
        updateManyCalls += 1;
        return { count: candidates.length };
      },
    },
  };
  patch(t, prisma, {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  });
  const previous = {
    provider: process.env.VIDEO_PROVIDER,
    engineMock: process.env.VIDEO_ENGINE_MOCK,
    concurrency: process.env.PROVIDER_CONCURRENCY,
  };
  process.env.VIDEO_PROVIDER = "byteplus";
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.PROVIDER_CONCURRENCY = "10";
  t.after(() => {
    if (previous.provider === undefined) delete process.env.VIDEO_PROVIDER;
    else process.env.VIDEO_PROVIDER = previous.provider;
    if (previous.engineMock === undefined) delete process.env.VIDEO_ENGINE_MOCK;
    else process.env.VIDEO_ENGINE_MOCK = previous.engineMock;
    if (previous.concurrency === undefined) delete process.env.PROVIDER_CONCURRENCY;
    else process.env.PROVIDER_CONCURRENCY = previous.concurrency;
  });

  const claimed = await __test__.claimJobs({
    batchId: "batch_claim",
    maxClaims: 10,
    now: new Date("2026-07-14T05:00:00.000Z"),
  });

  assert.equal(claimed.length, 10);
  assert.equal(updateManyCalls, 1, "领取必须是一次 set-based CAS");
  assert.equal(findManyCalls, 2, "候选读取与 CAS 后回读各一次");
  assert.equal(countFilters.length, 2);
  for (const where of countFilters) {
    assert.deepEqual(
      (where as { OR: unknown }).OR,
      __test__.dispatchableRunningSlotFilter(true).OR,
    );
  }
});
