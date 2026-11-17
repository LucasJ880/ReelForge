import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ProviderSubmissionState, VideoJobStatus, VideoProvider } from "@prisma/client";
import { db } from "../src/lib/db";
import { reconcileVideoJob, __test__ as videoSvcTest } from "../src/lib/services/video-service";

/**
 * runtime LENS-3：旧尝试的结论不许写到新一轮上——终态 CAS 钉住 externalJobId + providerRequestKey。
 *
 * 2026-11-16 成片画面质检整套删除：供应商「已完成」不再经过任何门禁，reconcile 直接转成功，
 * 质检那三列（frameQaStatus / frameQaCheckedAt / frameQaDetail）不读也不写；旧行上的值原样留着。
 *
 * 全部内存实现：不连数据库、不调供应商。
 */

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
    frameQaStatus: null,
    frameQaCheckedAt: null,
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

test("供应商已完成 → 直接转成功：不等 cron、不分生产 / 本机、不写质检列", async (t) => {
  const env = process.env as Record<string, string | undefined>;
  const previous = { NODE_ENV: env.NODE_ENV, FRAME_QA_ENABLED: env.FRAME_QA_ENABLED };
  /// 当年的门禁在这两个条件下会 defer（生产 + 不在 cron 预算上下文里）；现在没有这条路
  env.NODE_ENV = "production";
  env.FRAME_QA_ENABLED = "on";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  });
  const row = reconcileRow();
  const writes: Row[] = [];
  installReconcileRow(t, row);
  const model = db.videoJob as unknown as { updateMany: (args: { where: Row; data: Row }) => Promise<{ count: number }> };
  const inner = model.updateMany;
  model.updateMany = async (args) => {
    writes.push(args.data);
    return inner(args);
  };
  injectFetcher(t, async () => ({
    jobId: "ext-attempt-1",
    status: "completed",
    rawProviderStatus: "succeeded",
    videoUrl: "https://x/seg-1.mp4",
  }));

  await reconcileVideoJob("seg-1");

  assert.equal(row.status, VideoJobStatus.SUCCEEDED);
  assert.equal(row.outputVideoUrl, "https://x/seg-1.mp4");
  assert.equal(writes.length, 1, "一次 CAS 写入就到终态");
  for (const column of ["frameQaStatus", "frameQaCheckedAt", "frameQaDetail"]) {
    assert.equal(column in writes[0], false, `${column} 不再写`);
  }
  assert.equal(row.frameQaStatus, null);
});

for (const stale of [
  { frameQaStatus: "CHECKING", frameQaCheckedAt: new Date(), frameQaDetail: null },
  { frameQaStatus: "BLOCKED", frameQaCheckedAt: new Date(Date.now() - 60_000), frameQaDetail: { v: 1, status: "BLOCKED", blockCount: 2 } },
  { frameQaStatus: "UNVERIFIED", frameQaCheckedAt: new Date(Date.now() - 60_000), frameQaDetail: { v: 1, status: "UNVERIFIED", blockCount: 0 } },
]) {
  test(`读旧记录：带着当年质检标记（${stale.frameQaStatus}）的在途行照样收割成成功，标记原样`, async (t) => {
    const row = reconcileRow(stale);
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
    assert.equal(row.frameQaStatus, stale.frameQaStatus, "旧标记不动");
    assert.deepEqual(row.frameQaDetail, stale.frameQaDetail);
  });
}
