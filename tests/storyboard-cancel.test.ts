import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";

import { db } from "../src/lib/db";
import {
  __test__ as storyboardServiceTest,
  cancelStoryboardRun,
  cancelStoryboardRunsForVideoJobs,
  composeSingleVideoReferenceImages,
  createStoryboardRun,
  findResumableStoryboardRunForUser,
  pollPendingStoryboardRuns,
  regenerateStoryboardFrame,
  requireApprovedStoryboardVideoReferencesForBrief,
  storyboardRunView,
  StoryboardRequestError,
} from "../src/lib/video-generation/storyboard-service";

/**
 * 故事板真取消（round 1025 · A2 3.1 / 3.3 / 3.4）。
 *
 * 不变量：
 * - 只取消 GENERATING / AWAITING_APPROVAL；派发预留或已挂 brief 的拒绝；
 * - QUEUED 帧在同一事务里落成「未提交」终态，永不再提交；已提交 / ACK_UNKNOWN 帧继续对账；
 * - 幂等键改写墓碑值，解绑 brief / job / reservation；
 * - 所有 run 状态写入都是带显式源状态的 updateMany，CANCELLED 永不被覆盖。
 *
 * 全部 monkey-patch Prisma，不触真实 DB，零计费。
 */

type Write = { where: Record<string, unknown>; data: Record<string, unknown> };

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
    for (const key of Object.keys(originals)) model[key] = originals[key];
  });
}

function frame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "frame-x",
    ordinal: 0,
    attempt: 1,
    isCurrent: true,
    beat: "beat",
    prompt: "prompt",
    status: "QUEUED",
    submissionState: "NOT_STARTED",
    lastProviderStatus: null,
    externalTaskId: null,
    submittedAt: null,
    outputUrl: null,
    outputAsset: null,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "run-1",
    userId: "owner-1",
    idempotencyKey: "key-1",
    status: "GENERATING",
    approvalPolicy: "MANUAL",
    durationSec: 15,
    aspectRatio: "9:16",
    approvedAt: null,
    errorCode: null,
    errorMessage: null,
    dispatchReservationKey: null,
    videoBriefId: null,
    videoJobId: null,
    inputImageUrls: [],
    inputAssetIds: [],
    frames: [
      frame({ id: "f0", ordinal: 0, status: "SUCCEEDED", submissionState: "ACCEPTED", outputUrl: "https://a.test/0.png" }),
      frame({ id: "f1", ordinal: 1, status: "PROCESSING", submissionState: "ACCEPTED", externalTaskId: "ext-1" }),
      frame({ id: "f2", ordinal: 2, status: "QUEUED" }),
      frame({ id: "f3", ordinal: 3, status: "QUEUED" }),
    ],
    ...overrides,
  };
}

/** 一个最小的事务替身：记录 run / frame 的 updateMany，按需返回 count。 */
function harness(
  t: TestContext,
  options: { runRows: Array<Record<string, unknown>>; casCount?: number },
) {
  const runWrites: Write[] = [];
  const frameWrites: Write[] = [];
  let reads = 0;
  let transactions = 0;
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findFirst: async () => {
      const row = options.runRows[Math.min(reads, options.runRows.length - 1)];
      reads += 1;
      return row ? { ...row } : null;
    },
  });
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      transactions += 1;
      return fn({
        storyboardRun: {
          updateMany: async (args: Write) => {
            runWrites.push(args);
            return { count: options.casCount ?? 1 };
          },
        },
        storyboardFrame: {
          updateMany: async (args: Write) => {
            frameWrites.push(args);
            return { count: 2 };
          },
        },
      });
    },
  });
  return {
    runWrites,
    frameWrites,
    get transactions() {
      return transactions;
    },
  };
}

async function rejectsWithCode(promise: Promise<unknown>, code: string, status = 409) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof StoryboardRequestError, String(error));
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

test("取消生成中的故事板：CAS 改 CANCELLED、墓碑幂等键、解绑、QUEUED 帧不再提交", async (t) => {
  const h = harness(t, {
    runRows: [run(), run({ status: "CANCELLED", idempotencyKey: "cancelled:run-1:key-1" })],
  });

  const view = await cancelStoryboardRun("run-1", "owner-1");

  assert.equal(h.transactions, 1);
  assert.equal(h.runWrites.length, 1);
  const { where, data } = h.runWrites[0];
  assert.equal(where.id, "run-1");
  assert.equal(where.userId, "owner-1");
  assert.equal(where.idempotencyKey, "key-1");
  assert.deepEqual(where.status, { in: ["GENERATING", "AWAITING_APPROVAL"] });
  assert.equal(where.dispatchReservationKey, null, "a dispatch-reserved run is never cancelled");
  assert.equal(where.videoBriefId, null, "a brief-attached run is never cancelled");
  assert.equal(where.videoJobId, null, "a user cancel never detaches a batch storyboard");
  assert.equal(data.status, "CANCELLED");
  assert.equal(data.idempotencyKey, "cancelled:run-1:key-1", "the key is tombstoned so a resubmit starts fresh");
  assert.equal(data.videoBriefId, null);
  assert.equal(data.videoJobId, null);
  assert.equal(data.dispatchReservationKey, null);

  assert.equal(h.frameWrites.length, 1, "only queued frames are touched");
  const frameWrite = h.frameWrites[0];
  assert.equal(frameWrite.where.storyboardRunId, "run-1");
  assert.equal(frameWrite.where.status, "QUEUED");
  assert.equal(frameWrite.where.submissionState, "NOT_STARTED");
  assert.equal(frameWrite.data.status, "FAILED");
  assert.equal(frameWrite.data.errorCode, "RUN_CANCELLED");
  assert.equal(frameWrite.data.submissionState, undefined, "an unsent frame keeps NOT_STARTED (truthfully never submitted)");
  assert.match(String(frameWrite.data.errorMessage), /不产生费用/);

  assert.equal(view.status, "CANCELLED");
  assert.equal(view.canCancel, false);
  assert.ok(view.frames.every((item) => item.canRegenerate === false), "a cancelled round can never regenerate");
});

test("取消是幂等的：已取消直接返回，不再写库", async (t) => {
  const h = harness(t, { runRows: [run({ status: "CANCELLED" })] });
  const view = await cancelStoryboardRun("run-1", "owner-1");
  assert.equal(view.status, "CANCELLED");
  assert.equal(h.transactions, 0);
});

test("已交给视频派发（预留或已挂 brief）的故事板拒绝取消", async (t) => {
  const reserved = harness(t, { runRows: [run({ status: "APPROVED", dispatchReservationKey: "req-1" })] });
  await rejectsWithCode(cancelStoryboardRun("run-1", "owner-1"), "STORYBOARD_IN_DISPATCH");
  assert.equal(reserved.transactions, 0);
});

test("已挂 brief 的故事板拒绝取消", async (t) => {
  const attached = harness(t, { runRows: [run({ status: "APPROVED", videoBriefId: "brief-1" })] });
  await rejectsWithCode(cancelStoryboardRun("run-1", "owner-1"), "STORYBOARD_IN_DISPATCH");
  assert.equal(attached.transactions, 0);
});

test("批量任务上的故事板不能单独取消（只能随批次取消，避免批次重建后重复出图）", async (t) => {
  const bound = harness(t, { runRows: [run({ videoJobId: "job-1" })] });
  await rejectsWithCode(cancelStoryboardRun("run-1", "owner-1"), "STORYBOARD_IN_BATCH");
  assert.equal(bound.transactions, 0);
  assert.equal(storyboardRunView(run({ videoJobId: "job-1" }) as never).canCancel, false);
});

test("APPROVED / FAILED 不走服务端取消（不再产生费用），给 INVALID_STATE", async (t) => {
  const approved = harness(t, { runRows: [run({ status: "APPROVED" })] });
  await rejectsWithCode(cancelStoryboardRun("run-1", "owner-1"), "INVALID_STATE");
  assert.equal(approved.transactions, 0);
});

test("读写之间被确认：CAS 落空后按最新状态给人话；仍可取消则明确告诉调用方没取消", async (t) => {
  await t.test("刚被确认", async (st) => {
    harness(st, { runRows: [run({ status: "AWAITING_APPROVAL" }), run({ status: "APPROVED" })], casCount: 0 });
    await rejectsWithCode(cancelStoryboardRun("run-1", "owner-1"), "INVALID_STATE");
  });
  await t.test("刚开始派发", async (st) => {
    harness(st, {
      runRows: [run({ status: "AWAITING_APPROVAL" }), run({ status: "AWAITING_APPROVAL", dispatchReservationKey: "req-2" })],
      casCount: 0,
    });
    await rejectsWithCode(cancelStoryboardRun("run-1", "owner-1"), "STORYBOARD_IN_DISPATCH");
  });
  await t.test("瞬时竞争", async (st) => {
    harness(st, { runRows: [run(), run()], casCount: 0 });
    await rejectsWithCode(cancelStoryboardRun("run-1", "owner-1"), "STATE_CHANGED");
  });
});

test("cancelStoryboardRunsForVideoJobs 只取消挂在这些任务上的生成中故事板", async (t) => {
  const findManyArgs: Array<Record<string, unknown>> = [];
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findMany: async (args: Record<string, unknown>) => {
      findManyArgs.push(args);
      return [
        { id: "run-a", userId: "owner-1", idempotencyKey: "batch-storyboard:job-a:r0" },
        { id: "run-b", userId: "owner-1", idempotencyKey: "batch-storyboard:job-b:r0" },
      ];
    },
  });
  const runWrites: Write[] = [];
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        storyboardRun: {
          updateMany: async (args: Write) => {
            runWrites.push(args);
            // run-b 已被并发取消 / 推进：CAS 落空，不计数。
            return { count: args.where.id === "run-a" ? 1 : 0 };
          },
        },
        storyboardFrame: { updateMany: async () => ({ count: 0 }) },
      }),
  });

  assert.equal(await cancelStoryboardRunsForVideoJobs([]), 0);
  assert.equal(findManyArgs.length, 0, "an empty job list never queries");

  const cancelled = await cancelStoryboardRunsForVideoJobs(["job-a", "job-b", "job-a"]);
  assert.equal(cancelled, 1);
  const where = findManyArgs[0].where as Record<string, unknown>;
  assert.deepEqual(where.videoJobId, { in: ["job-a", "job-b"] });
  assert.deepEqual(where.status, { in: ["GENERATING", "AWAITING_APPROVAL"] });
  assert.equal(runWrites.length, 2);
  assert.equal(runWrites[0].data.idempotencyKey, "cancelled:run-a:batch-storyboard:job-a:r0");
  assert.equal(runWrites[0].data.videoJobId, null, "the batch job is unbound so a retry can attach a fresh run");
  assert.equal(runWrites[0].where.videoJobId, undefined, "the batch path cancels runs that are bound to jobs");
  assert.match(String(runWrites[0].data.errorMessage), /批量任务已取消/);
});

test("已取消的 run：advanceRun 不迁移状态、不提交排队帧", async (t) => {
  const runWrites: unknown[] = [];
  let submitLookups = 0;
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findFirst: async () => run({ status: "CANCELLED" }),
    updateMany: async (args: unknown) => {
      runWrites.push(args);
      return { count: 1 };
    },
  });
  patch(t, db.storyboardFrame as unknown as Record<string, unknown>, {
    findUnique: async () => {
      submitLookups += 1;
      return null;
    },
  });
  const result = await storyboardServiceTest.advanceRun("run-1");
  assert.equal(result.status, "CANCELLED");
  assert.equal(runWrites.length, 0, "CANCELLED is never overwritten");
  assert.equal(submitLookups, 0, "no queued frame is submitted for a cancelled round");
});

test("advanceRun 判 FAILED 只从 GENERATING / AWAITING_APPROVAL 迁出", async (t) => {
  const runWrites: Write[] = [];
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findFirst: async () =>
      run({
        frames: [
          frame({ id: "f0", ordinal: 0, status: "SUCCEEDED", submissionState: "ACCEPTED" }),
          frame({ id: "f1", ordinal: 1, status: "FAILED", submissionState: "REJECTED" }),
          frame({ id: "f2", ordinal: 2, status: "SUCCEEDED", submissionState: "ACCEPTED" }),
          frame({ id: "f3", ordinal: 3, status: "SUCCEEDED", submissionState: "ACCEPTED" }),
        ],
      }),
    updateMany: async (args: Write) => {
      runWrites.push(args);
      return { count: 1 };
    },
  });
  await storyboardServiceTest.advanceRun("run-1");
  const failedWrite = runWrites.find((write) => write.data.status === "FAILED");
  assert.ok(failedWrite);
  assert.deepEqual(failedWrite!.where.status, { in: ["GENERATING", "AWAITING_APPROVAL"] });
});

test("排队帧提交前再确认 run 未取消（帧级 CAS 带 run 级兜底）", async (t) => {
  const claims: Write[] = [];
  let runStatus = "CANCELLED";
  patch(t, db.storyboardFrame as unknown as Record<string, unknown>, {
    findUnique: async () => ({
      ...frame({ id: "f2", ordinal: 2, providerRequestKey: "rk" }),
      storyboardRun: { id: "run-1", status: runStatus, aspectRatio: "9:16", inputImageUrls: [], frames: [] },
    }),
    updateMany: async (args: Write) => {
      claims.push(args);
      return { count: 0 };
    },
  });
  await storyboardServiceTest.submitStoryboardFrame("f2");
  assert.equal(claims.length, 0, "a cancelled run's frame is never claimed for submission");

  runStatus = "GENERATING";
  await storyboardServiceTest.submitStoryboardFrame("f2");
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].where.storyboardRun, { status: { not: "CANCELLED" } });
});

test("轮询继续对账已取消 run 里已提交的帧（收回已付费素材），不碰没有在途帧的", async (t) => {
  const findManyArgs: Array<Record<string, unknown>> = [];
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findMany: async (args: Record<string, unknown>) => {
      findManyArgs.push(args);
      return [];
    },
  });
  await pollPendingStoryboardRuns(20);
  const or = (findManyArgs[0].where as { OR: Array<Record<string, unknown>> }).OR;
  const cancelledBranch = or.find((branch) => branch.status === "CANCELLED");
  assert.ok(cancelledBranch, "cancelled runs with in-flight frames stay in the reconcile queue");
  const some = (cancelledBranch!.frames as { some: Record<string, unknown> }).some;
  assert.equal(some.isCurrent, true);
  assert.deepEqual(some.OR, [
    { status: "PROCESSING" },
    { status: "FAILED", submissionState: "ACK_UNKNOWN", externalTaskId: { not: null } },
  ]);
});

test("恢复入口不会把已取消的故事板带回来", async (t) => {
  const whereArgs: Array<Record<string, unknown>> = [];
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findFirst: async (args: { where: Record<string, unknown> }) => {
      whereArgs.push(args.where);
      return null;
    },
  });
  assert.equal(await findResumableStoryboardRunForUser("owner-1"), null);
  const statuses = (whereArgs[0].status as { in: string[] }).in;
  assert.ok(!statuses.includes("CANCELLED"));
});

test("视图：生成中且未派发才 canCancel", () => {
  assert.equal(storyboardRunView(run() as never).canCancel, true);
  assert.equal(storyboardRunView(run({ status: "AWAITING_APPROVAL" }) as never).canCancel, true);
  assert.equal(storyboardRunView(run({ dispatchReservationKey: "req" }) as never).canCancel, false);
  assert.equal(storyboardRunView(run({ status: "APPROVED" }) as never).canCancel, false);
  assert.equal(storyboardRunView(run({ status: "FAILED" }) as never).canCancel, false);
});

/** regenerateStoryboardFrame 的事务替身。 */
function regenerateHarness(
  t: TestContext,
  existing: Record<string, unknown> | null,
  options: { runCas?: number } = {},
) {
  const runWrites: Write[] = [];
  const frameWrites: Write[] = [];
  const creates: unknown[] = [];
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        storyboardFrame: {
          findFirst: async () => existing,
          updateMany: async (args: Write) => {
            frameWrites.push(args);
            return { count: 1 };
          },
          create: async (args: unknown) => {
            creates.push(args);
            return { id: "f-new" };
          },
        },
        storyboardRun: {
          updateMany: async (args: Write) => {
            runWrites.push(args);
            return { count: options.runCas ?? 1 };
          },
        },
      }),
  });
  return { runWrites, frameWrites, creates };
}

test("已取消的一轮不能重做分镜", async (t) => {
  const h = regenerateHarness(t, {
    ...frame({ id: "f0", status: "SUCCEEDED", submissionState: "ACCEPTED" }),
    storyboardRunId: "run-1",
    storyboardRun: { id: "run-1", status: "CANCELLED" },
  });
  await rejectsWithCode(
    regenerateStoryboardFrame({ userId: "owner-1", runId: "run-1", frameId: "f0" }),
    "STORYBOARD_CANCELLED",
  );
  assert.equal(h.runWrites.length + h.frameWrites.length + h.creates.length, 0);
});

test("单帧最多重做 3 次，第 4 次给人话", async (t) => {
  const h = regenerateHarness(t, {
    ...frame({ id: "f0", attempt: 4, status: "SUCCEEDED", submissionState: "ACCEPTED" }),
    storyboardRunId: "run-1",
    storyboardRun: { id: "run-1", status: "AWAITING_APPROVAL" },
  });
  await assert.rejects(
    regenerateStoryboardFrame({ userId: "owner-1", runId: "run-1", frameId: "f0" }),
    (error: unknown) => {
      assert.ok(error instanceof StoryboardRequestError);
      assert.equal(error.code, "FRAME_REGENERATION_LIMIT");
      assert.match(error.message, /重做了 3 次/);
      return true;
    },
  );
  assert.equal(h.creates.length, 0);
});

test("重做把 run 拉回 GENERATING 用显式源状态 CAS；落空（并发取消）整笔回滚", async (t) => {
  const h = regenerateHarness(
    t,
    {
      ...frame({ id: "f0", attempt: 2, status: "SUCCEEDED", submissionState: "ACCEPTED" }),
      storyboardRunId: "run-1",
      storyboardRun: { id: "run-1", status: "AWAITING_APPROVAL" },
    },
    { runCas: 0 },
  );
  await rejectsWithCode(
    regenerateStoryboardFrame({ userId: "owner-1", runId: "run-1", frameId: "f0" }),
    "INVALID_STATE",
  );
  assert.equal(h.runWrites.length, 1);
  const where = h.runWrites[0].where;
  assert.deepEqual(where.status, { in: ["GENERATING", "AWAITING_APPROVAL", "FAILED"] });
  assert.equal(where.dispatchReservationKey, null);
  assert.equal(where.videoBriefId, null);
  assert.equal(h.frameWrites.length, 0, "the current frame is not invalidated when the run CAS misses");
  assert.equal(h.creates.length, 0);
});

test("用户发起的重做计入每小时限流；批量自动重投不计", async (t) => {
  const bumps: Array<Record<string, unknown>> = [];
  patch(t, db.rateLimitBucket as unknown as Record<string, unknown>, {
    upsert: async (args: { where: { bucketKey_windowKey: Record<string, unknown> } }) => {
      bumps.push(args.where.bucketKey_windowKey);
      return { count: 31 };
    },
  });
  regenerateHarness(t, null);

  await rejectsWithCode(
    regenerateStoryboardFrame({ userId: "owner-1", runId: "run-1", frameId: "f0", userInitiated: true }),
    "RATE_LIMITED",
    429,
  );
  assert.equal(bumps.length, 1);
  assert.equal(bumps[0].bucketKey, "storyboard-frame-regenerate:user:owner-1");

  // 批量路径不传 userInitiated：不碰限流桶（frame 不存在 → NOT_FOUND）。
  await rejectsWithCode(
    regenerateStoryboardFrame({ userId: "owner-1", runId: "run-1", frameId: "f0" }),
    "NOT_FOUND",
    404,
  );
  assert.equal(bumps.length, 1);
});

test("故事板创建：同键回放不计数，新建才计数；超限在建 run 之前拒绝", async (t) => {
  const bumps: unknown[] = [];
  let creates = 0;
  let existing: Record<string, unknown> | null = run({ requestHash: "other-content" });
  patch(t, db.rateLimitBucket as unknown as Record<string, unknown>, {
    upsert: async () => {
      bumps.push(1);
      return { count: 11 };
    },
  });
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findUnique: async () => existing,
    create: async () => {
      creates += 1;
      throw new Error("must not create past the limit");
    },
  });
  const input = {
    userId: "owner-1",
    idempotencyKey: "key-new",
    prompt: "Show the shade lowering over a sunny window",
    durationSec: 15,
    aspectRatio: "9:16" as const,
  };
  // 已用过的幂等键（回放 / 冲突）在计数之前就被处理，不占名额。
  await rejectsWithCode(createStoryboardRun({ ...input, userInitiated: true }), "IDEMPOTENCY_CONFLICT");
  assert.equal(bumps.length, 0);

  existing = null;
  await rejectsWithCode(createStoryboardRun({ ...input, userInitiated: true }), "RATE_LIMITED", 429);
  assert.equal(bumps.length, 1);
  assert.equal(creates, 0);

  // 批量内部准备（不传 userInitiated）不计数：直接走到 create。
  await assert.rejects(createStoryboardRun(input), /must not create past the limit/);
  assert.equal(bumps.length, 1);
});

test("单条视频参考图：实拍在前、故事板帧在后，去重并截断，帧不被挤掉", () => {
  const frames = ["https://a.test/f0.png", "https://a.test/f1.png", "https://a.test/f2.png", "https://a.test/f3.png"];
  assert.deepEqual(
    composeSingleVideoReferenceImages({
      productImageUrls: ["https://a.test/p0.jpg", "https://a.test/p1.jpg", "https://a.test/p0.jpg"],
      storyboardFrameUrls: frames,
    }),
    ["https://a.test/p0.jpg", "https://a.test/p1.jpg", ...frames],
  );
  const many = Array.from({ length: 9 }, (_, index) => `https://a.test/p${index}.jpg`);
  const composed = composeSingleVideoReferenceImages({ productImageUrls: many, storyboardFrameUrls: frames });
  assert.equal(composed.length, 8);
  assert.deepEqual(composed.slice(0, 4), many.slice(0, 4), "real photos lead");
  assert.deepEqual(composed.slice(4), frames, "every storyboard frame still fits");
  assert.deepEqual(
    composeSingleVideoReferenceImages({ productImageUrls: [], storyboardFrameUrls: frames }),
    frames,
  );
  assert.deepEqual(
    composeSingleVideoReferenceImages({ productImageUrls: many, storyboardFrameUrls: frames, limit: 4 }),
    [many[0], ...frames.slice(0, 3)],
    "even under a tight cap at least one real photo leads",
  );
});

test("派发取参考图：已确认故事板 + 这轮故事板的源图（商家实拍）", async (t) => {
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findUnique: async () =>
      run({
        status: "APPROVED",
        inputImageUrls: ["https://a.test/real-1.jpg"],
        frames: Array.from({ length: 4 }, (_, ordinal) =>
          frame({
            id: `f${ordinal}`,
            ordinal,
            status: "SUCCEEDED",
            submissionState: "ACCEPTED",
            outputAsset: { userId: "owner-1", url: `https://a.test/frame-${ordinal}.png` },
          }),
        ),
      }),
  });
  assert.deepEqual(await requireApprovedStoryboardVideoReferencesForBrief("brief-1"), [
    "https://a.test/real-1.jpg",
    "https://a.test/frame-0.png",
    "https://a.test/frame-1.png",
    "https://a.test/frame-2.png",
    "https://a.test/frame-3.png",
  ]);
});

test("所有故事板 run 状态写入都是带源状态的 updateMany（静态守卫）", async () => {
  const service = await readFile("src/lib/video-generation/storyboard-service.ts", "utf8");
  assert.doesNotMatch(service, /storyboardRun\.update\(/, "no unconditional run update may overwrite CANCELLED");
  assert.doesNotMatch(service, /status: \{ not: StoryboardRunStatus\.FAILED \}/);
  // 视频派发入口对故事板的预留 / 挂载同样只认 APPROVED 源状态。
  const dispatch = await readFile("src/app/api/video-generation/dispatch/route.ts", "utf8");
  assert.doesNotMatch(dispatch, /storyboardRun\.update\(/);
});
