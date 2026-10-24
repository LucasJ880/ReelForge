import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { db } from "../src/lib/db";
import { __test__ as batchTest } from "../src/lib/services/batch-service";

/**
 * 批量故事板悬死解救回归（0804 真机复现的管线缺口①）。
 *
 * 不变量：storyboardRun FAILED 而 VideoJob 仍 QUEUED/PAUSED 的组合不允许活过
 * 一个 batch tick——要么帧被安全重投（run 回 GENERATING），要么按任务号对账，
 * 要么任务落成诚实失败并解绑 run（归档保留），让用户一键重试重建全新 run。
 *
 * 全部 monkey-patch Prisma，不触真实 DB，零计费。
 */

function patch(
  t: TestContext,
  model: Record<string, unknown>,
  patches: Record<string, unknown>,
) {
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = model[key];
    model[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) {
      model[key] = originals[key];
    }
  });
}

function deadFrame(overrides: Record<string, unknown> = {}) {
  return {
    id: "frame-1",
    attempt: 1,
    status: "FAILED",
    submissionState: "REJECTED",
    lastProviderStatus: null,
    externalTaskId: null,
    ...overrides,
  };
}

test("解救：确认救不回的 FAILED run → job 诚实失败 + run 解绑归档", async (t) => {
  const jobWrites: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const runWrites: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findMany: async () => [
      {
        id: "run-dead",
        videoJobId: "job-1",
        /// 重投预算耗尽（attempt=3）：既不可对账也不可再重投 → 死局
        frames: [deadFrame({ attempt: 3 })],
      },
    ],
  });
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        videoJob: {
          updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            jobWrites.push(args);
            return { count: 1 };
          },
        },
        storyboardRun: {
          updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            runWrites.push(args);
            return { count: 1 };
          },
        },
      }),
  });

  await batchTest.settleDeadStoryboardBatchJobs("batch-1");

  assert.equal(jobWrites.length, 1, "the queued job settles exactly once");
  assert.equal(jobWrites[0].where.id, "job-1");
  assert.equal(jobWrites[0].data.status, "FAILED");
  assert.equal(jobWrites[0].data.submissionErrorClass, "storyboard_failed");
  assert.match(
    String(jobWrites[0].data.userSafeError),
    /未提交生成/,
    "the user-facing copy states honestly that no video was submitted or billed",
  );
  assert.match(String(jobWrites[0].data.userSafeError), /重试/);
  assert.equal(runWrites.length, 1, "the dead run detaches for a clean rebuild");
  assert.equal(runWrites[0].data.videoJobId, null);
});

test("解救：任务号已知的 ACK_UNKNOWN 帧留给对账，不落死局", async (t) => {
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findMany: async () => [
      {
        id: "run-wait",
        videoJobId: "job-2",
        frames: [
          deadFrame({ submissionState: "ACK_UNKNOWN", externalTaskId: "shuyu-ext-1" }),
          deadFrame({ id: "frame-2", submissionState: "ACK_UNKNOWN", attempt: 3 }),
        ],
      },
    ],
  });
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async () => {
      throw new Error("a reconcilable run must not settle");
    },
  });

  await batchTest.settleDeadStoryboardBatchJobs("batch-1");
});

test("解救：全部帧都可安全重投时留给重投循环，不落死局", async (t) => {
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findMany: async () => [
      {
        id: "run-retryable",
        videoJobId: "job-3",
        /// 无任务号的 ACK_UNKNOWN（0804 悬死根因）+ REJECTED：都可安全重投
        frames: [
          deadFrame({ submissionState: "ACK_UNKNOWN" }),
          deadFrame({ id: "frame-2", submissionState: "REJECTED" }),
        ],
      },
    ],
  });
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async () => {
      throw new Error("a fully retryable run must not settle");
    },
  });

  await batchTest.settleDeadStoryboardBatchJobs("batch-1");
});

test("重投：无任务号的 ACK_UNKNOWN 帧按新 attempt 自动重投（0804 根因自愈）", async (t) => {
  let regenAttempts = 0;
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findMany: async () => [
      {
        id: "run-r",
        userId: "user-1",
        frames: [
          deadFrame({ id: "fA", submissionState: "ACK_UNKNOWN" }),
          deadFrame({ id: "fB", submissionState: "REJECTED" }),
        ],
      },
    ],
  });
  /// regenerateStoryboardFrame 的第一步就是 $transaction；返回 null 让它以
  /// NOT_FOUND 收尾（被重投循环逐帧吞掉），这里只数「发起了几次重投」。
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async () => {
      regenAttempts += 1;
      return null;
    },
  });

  await batchTest.retryRecoverableBatchFrames("batch-1");

  assert.equal(regenAttempts, 2, "both safely-retryable frames regenerate");
});

test("重投：存在任务号已知的 ACK_UNKNOWN 帧时整条 run 本轮不重投", async (t) => {
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findMany: async () => [
      {
        id: "run-hold",
        userId: "user-1",
        frames: [
          deadFrame({ id: "fA", submissionState: "ACK_UNKNOWN", externalTaskId: "shuyu-ext-9" }),
          deadFrame({ id: "fB", submissionState: "REJECTED" }),
        ],
      },
    ],
  });
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async () => {
      throw new Error("no regeneration may start while reconciliation is pending");
    },
  });

  await batchTest.retryRecoverableBatchFrames("batch-1");
});

test("重建：prepareBatchStoryboards 的幂等键按 retryCount 分代", async (t) => {
  let capturedKey: string | null = null;
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findMany: async () => [
      {
        id: "job-9",
        retryCount: 2,
        promptText: "faithful product demo",
        templateSnapshot: { lockedParams: { duration: 15, aspectRatio: "9:16" } },
        assignedAssets: { assets: [], seed: 7 },
      },
    ],
  });
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findUnique: async () => null,
    create: async (args: { data: { idempotencyKey: string } }) => {
      capturedKey = args.data.idempotencyKey;
      /// 键已捕获，提交前中止（不触 provider）
      throw new Error("stop-before-submit");
    },
  });

  await assert.rejects(
    () => batchTest.prepareBatchStoryboards("batch-1", "user-1"),
    /stop-before-submit|1 concurrent item/,
  );
  assert.equal(
    capturedKey,
    "batch-storyboard:job-9:r2",
    "a retried job rebuilds a fresh storyboard run instead of replaying the dead one",
  );
});
