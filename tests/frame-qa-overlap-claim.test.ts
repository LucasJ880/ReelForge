import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ProviderSubmissionState, VideoJobStatus, VideoProvider } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  CRON_FRAME_QA_BUDGET,
  FRAME_QA_CHECKING,
  __test__ as gateTest,
  decideFrameQaGate,
  frameQaBudgetUsage,
  frameQaClaimWhere,
  runWithFrameQaBudget,
  type FrameQaGateDeps,
} from "../src/lib/services/frame-qa-gate";
import { reconcileVideoJob, __test__ as videoSvcTest } from "../src/lib/services/video-service";
import type { FrameQaVerdict } from "../src/lib/video-generation/frame-qa";

/**
 * runtime LENS-3：重叠的 cron 调用各有一份质检预算——
 *  1. 同一段只许一个调用在质检（frameQaStatus=CHECKING 占位 + 租期），别的调用 defer、把预算名额还回去；
 *  2. 旧尝试的结论不许写到新一轮上：终态 CAS 钉住 externalJobId + providerRequestKey。
 *
 * 全部内存实现：不跑 ffmpeg、不调 vision、不连数据库、不调供应商。
 */

process.env.FRAME_QA_DISABLED = "true";

type Row = Record<string, unknown>;

function scalar(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

/// 只覆盖本文件用到的 where 形状：等值 / null / in / not / lt / OR
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "OR") return (cond as Row[]).some((c) => matches(row, c));
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date || typeof cond !== "object") return scalar(value) === scalar(cond);
    const ops = cond as Row;
    if ("in" in ops) return (ops.in as unknown[]).includes(value);
    if ("not" in ops) {
      if (value === null || value === undefined) return false; // SQL：NULL <> x 不为真
      return scalar(value) !== scalar(ops.not);
    }
    if ("lt" in ops) {
      if (value === null || value === undefined) return false;
      return (scalar(value) as number) < (scalar(ops.lt) as number);
    }
    throw new Error(`unsupported where ${key}: ${JSON.stringify(cond)}`);
  });
}

function patch(t: TestContext, model: Record<string, unknown>, patches: Record<string, unknown>) {
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = model[key];
    model[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) model[key] = originals[key];
  });
}

const PASS: FrameQaVerdict = { ok: true, checked: true, frameCount: 6, issues: [], summary: "帧质检通过" };
const NOW = new Date("2026-10-25T08:00:00.000Z");

function completedRow(overrides: Row = {}): Row {
  return {
    id: "seg-1",
    status: VideoJobStatus.RUNNING,
    externalJobId: "ext-attempt-1",
    providerRequestKey: "seg-1:attempt:1",
    frameQaStatus: null,
    frameQaCheckedAt: null,
    ...overrides,
  };
}

/// 默认占位实现跑在内存行上（与生产同一份 where）
function installClaimRows(t: TestContext, rows: Row[]) {
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    updateMany: async (args: { where: Row; data: Row }) => {
      let count = 0;
      for (const row of rows) {
        if (!matches(row, args.where)) continue;
        Object.assign(row, args.data);
        count += 1;
      }
      return { count };
    },
  });
}

function gateDeps(qaCalls: { n: number }, now: Date): FrameQaGateDeps {
  return {
    isFrameQaEnabled: () => true,
    runFrameTextQa: async () => {
      qaCalls.n += 1;
      return PASS;
    },
    loadPriorDetail: async () => null,
    now: () => now,
  };
}

test("runtime LENS-3：两次重叠的 cron 调用同一段只质检一次，后来者 defer 并把预算名额还回去", async (t) => {
  const row = completedRow();
  installClaimRows(t, [row]);
  const qaCalls = { n: 0 };
  const attempt = { externalJobId: "ext-attempt-1", providerRequestKey: "seg-1:attempt:1" };

  /// 调用 #1 占位后正在质检（这里在占位之后、结论落库之前插入调用 #2）
  let second: Awaited<ReturnType<typeof decideFrameQaGate>> | null = null;
  let secondUsage: ReturnType<typeof frameQaBudgetUsage> = null;
  const first = await runWithFrameQaBudget({ label: "cron:poll-videos#1", ...CRON_FRAME_QA_BUDGET }, () =>
    decideFrameQaGate(
      { jobId: "seg-1", provider: VideoProvider.SEEDANCE_T2V, videoUrl: "https://x/seg-1.mp4", priorFrameQaDetail: null, attempt },
      {
        ...gateDeps(qaCalls, NOW),
        runFrameTextQa: async () => {
          qaCalls.n += 1;
          assert.equal(row.frameQaStatus, FRAME_QA_CHECKING, "真跑质检前已经占位");
          await runWithFrameQaBudget({ label: "cron:poll-videos#2", ...CRON_FRAME_QA_BUDGET }, async () => {
            second = await decideFrameQaGate(
              { jobId: "seg-1", provider: VideoProvider.SEEDANCE_T2V, videoUrl: "https://x/seg-1.mp4", priorFrameQaDetail: null, attempt },
              gateDeps(qaCalls, new Date(NOW.getTime() + 20_000)),
            );
            secondUsage = frameQaBudgetUsage();
          });
          return PASS;
        },
      },
    ),
  );

  assert.equal(first.action, "pass");
  assert.equal(qaCalls.n, 1, "同一段的视频只下载、抽帧、调 vision 一次");
  assert.deepEqual(second, { action: "defer", reason: "frame_qa_claimed_elsewhere" });
  assert.equal(secondUsage!.used, 0, "没真跑就不占预算，名额留给别的段");
  assert.equal(secondUsage!.deferred, 1);
});

test("runtime LENS-3：占位有租期——持有者被平台杀掉后别的调用能接手；已被重试换掉的尝试占不到", () => {
  const attempt = { externalJobId: "ext-attempt-1", providerRequestKey: "seg-1:attempt:1" };
  const lease = gateTest.FRAME_QA_CLAIM_LEASE_MS;
  assert.ok(lease > gateTest.PER_CHECK_RESERVE_MS, "租期远大于单次检查的最坏耗时");

  const fresh = completedRow({ frameQaStatus: FRAME_QA_CHECKING, frameQaCheckedAt: new Date(NOW.getTime() - 30_000) });
  const abandoned = completedRow({ frameQaStatus: FRAME_QA_CHECKING, frameQaCheckedAt: new Date(NOW.getTime() - lease - 1) });
  const blockedBefore = completedRow({ frameQaStatus: "BLOCKED", frameQaCheckedAt: new Date(NOW.getTime() - 1_000) });
  const where = frameQaClaimWhere("seg-1", attempt, NOW);
  assert.equal(matches(fresh, where), false, "别人的占位还没过期");
  assert.equal(matches(abandoned, where), true, "占位过期可以接手");
  assert.equal(matches(completedRow(), where), true, "从未质检过");
  assert.equal(matches(blockedBefore, where), true, "上一轮的结论不是占位");

  /// 单条重试已经换了提交幂等键 / 批量重试已经清空任务号：旧尝试不再质检
  assert.equal(matches(completedRow({ providerRequestKey: "seg-1:attempt:2" }), where), false);
  assert.equal(matches(completedRow({ externalJobId: null }), where), false);
  assert.equal(matches(completedRow({ status: VideoJobStatus.FAILED }), where), false);
});

/// ---------- 终态 CAS 钉住这一次尝试 ----------

function installReconcileRow(t: TestContext, row: Row) {
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findUnique: async () => ({ ...row }),
    update: async (args: { data: Row }) => {
      Object.assign(row, args.data);
      return { ...row };
    },
    updateMany: async (args: { where: Row; data: Row }) => {
      if (!matches(row, args.where)) return { count: 0 };
      Object.assign(row, args.data);
      return { count: 1 };
    },
  });
}

function reconcileRow(overrides: Row = {}): Row {
  return {
    id: "seg-1",
    videoBriefId: null,
    externalJobId: "ext-attempt-1",
    providerRequestKey: "seg-1:attempt:1",
    status: VideoJobStatus.RUNNING,
    submissionState: ProviderSubmissionState.ACCEPTED,
    provider: VideoProvider.SEEDANCE_T2V,
    pollErrors: 0,
    retryCount: 0,
    timeoutAt: new Date(Date.now() + 10 * 60_000),
    submittedAt: new Date(Date.now() - 60_000),
    startedAt: new Date(Date.now() - 60_000),
    finishedAt: null,
    lastCheckedAt: null,
    lastProviderStatus: "running",
    errorMessage: null,
    userSafeError: null,
    outputVideoUrl: null,
    outputThumbUrl: null,
    finalVideoId: null,
    frameQaDetail: null,
    dispatchQuarantineDecision: null,
    createdAt: new Date(Date.now() - 60_000),
    ...overrides,
  };
}

function injectFetcher(t: TestContext, fn: () => Promise<unknown>) {
  videoSvcTest.__setStatusFetcherForTests(
    fn as unknown as Parameters<typeof videoSvcTest.__setStatusFetcherForTests>[0],
  );
  t.after(() => videoSvcTest.__setStatusFetcherForTests(null));
}

test("runtime LENS-3：旧尝试的「已完成」不会写到单条重试刚领取的新一轮上", async (t) => {
  const row = reconcileRow();
  installReconcileRow(t, row);
  injectFetcher(t, async () => {
    /// 这次 reconcile 在路上时，用户点了重试：claimFailedJobForRetry 换了幂等键、
    /// 行回到 RUNNING，新任务号还没写回（externalJobId 仍是旧的）
    Object.assign(row, { providerRequestKey: "seg-1:attempt:2", submissionState: ProviderSubmissionState.SUBMITTING });
    return { jobId: "ext-attempt-1", status: "completed", rawProviderStatus: "succeeded", videoUrl: "https://x/old.mp4" };
  });

  await reconcileVideoJob("seg-1");

  assert.equal(row.status, VideoJobStatus.RUNNING, "新一轮不被旧结论翻成 SUCCEEDED");
  assert.equal(row.outputVideoUrl, null, "旧产物不挂到新一轮上");
});

test("runtime LENS-3：旧尝试的「供应商失败」不会写到批量重试已重置的行上", async (t) => {
  const row = reconcileRow();
  installReconcileRow(t, row);
  injectFetcher(t, async () => {
    /// 批量重试：batchRetryResetData 清空任务号；tick 随即领取，行又是 RUNNING
    Object.assign(row, { externalJobId: null, providerRequestKey: "seg-1:attempt:1", status: VideoJobStatus.RUNNING });
    return { jobId: "ext-attempt-1", status: "failed", rawProviderStatus: "failed", errorMessage: "old attempt failed" };
  });

  await reconcileVideoJob("seg-1");

  assert.equal(row.status, VideoJobStatus.RUNNING);
  assert.equal(row.errorMessage, null);
});

test("runtime LENS-3：同一次尝试照常写终态（钉住的是尝试，不是挡住正常收割）", async (t) => {
  const row = reconcileRow();
  installReconcileRow(t, row);
  injectFetcher(t, async () => ({
    jobId: "ext-attempt-1",
    status: "completed",
    rawProviderStatus: "succeeded",
    videoUrl: "https://x/seg-1.mp4",
  }));

  await reconcileVideoJob("seg-1");

  assert.equal(row.status, VideoJobStatus.SUCCEEDED);
  assert.equal(row.outputVideoUrl, "https://x/seg-1.mp4");
});
