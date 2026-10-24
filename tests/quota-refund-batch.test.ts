import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import {
  BatchJobStatus,
  Prisma,
  ProviderSubmissionState,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";
import type { Session } from "next-auth";
import { db } from "../src/lib/db";
import {
  cancelPendingBatchJobs,
  cancelUnauthorizedBatch,
  cancelledBatchIdempotencyKey,
  deriveBatchStatus,
  retryFailedBatchJob,
  retryFailedBatchJobs,
  toCustomerBatchStatus,
} from "../src/lib/services/batch-service";
import {
  currentUsagePeriodKey,
  QuotaExceededError,
} from "../src/lib/services/quota-service";
import {
  planLedgerRecharge,
  planLedgerRefund,
  QUOTA_LEDGER_PHASE,
  QUOTA_REFUND_CUTOFF_DEFAULT,
  quotaRefundCutoff,
  reconcileUndeliveredQuotaRefunds,
  refundUndeliveredBatchJob,
  type QuotaLedgerEntry,
} from "../src/lib/services/quota-refund-service";
import { sweepStuckTasks } from "../src/lib/services/sweep-service";
import { groupSubmissionKey } from "../src/lib/batch/batch-group-submission";
import {
  emptyStore,
  installQuotaFakeDb,
  meterAmount,
  type QuotaFakeStore,
  type Row,
} from "./helpers/quota-fake-db";

/**
 * 1025 · A1a「钱」批量路径回归（D1：客户只为已交付的成片计数）。
 * 全部跑在内存版 Prisma 上（tests/helpers/quota-fake-db.ts），不连任何数据库。
 */

const CUTOFF = new Date(QUOTA_REFUND_CUTOFF_DEFAULT);
const AUTHORIZED_AT = new Date("2026-10-26T09:00:00.000Z");
const FAILED_AT = new Date("2026-11-01T10:00:00.000Z");
const NOW = new Date("2026-11-01T12:00:00.000Z");
const USER = "customer-1";

const CUSTOMER: Session = {
  user: { id: USER, email: "c@example.test", role: "OPERATOR", userType: "PERSONAL" },
  expires: "2099-01-01T00:00:00.000Z",
};
const STAFF: Session = {
  user: { id: USER, email: "s@example.test", role: "OPERATOR", userType: "OPERATOR" },
  expires: "2099-01-01T00:00:00.000Z",
};

/// 重试补扣发生在真实当月；这几条用例的「再失败」也在真实当下，截止线放到更早。
const EARLY_CUTOFF = new Date("2026-01-01T00:00:00.000Z");

function patchMethod(
  t: TestContext,
  target: unknown,
  method: string,
  fn: (...args: never[]) => unknown,
) {
  const model = target as Record<string, unknown>;
  const original = model[method];
  model[method] = fn;
  t.after(() => {
    model[method] = original;
  });
}

function enforceQuota(t: TestContext) {
  const previous = process.env.QUOTA_ENFORCE;
  process.env.QUOTA_ENFORCE = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.QUOTA_ENFORCE;
    else process.env.QUOTA_ENFORCE = previous;
  });
}

function batchJobRow(overrides: Row = {}): Row {
  return {
    id: "batch-1",
    userId: USER,
    requestedCount: 3,
    status: BatchJobStatus.RUNNING,
    quotaConsumedAt: AUTHORIZED_AT,
    idempotencyKey: "wizard-key-1",
    cancelledCount: 0,
    finishedAt: null,
    ...overrides,
  };
}

function videoJobRow(overrides: Row = {}): Row {
  return {
    id: "job-1",
    batchJobId: "batch-1",
    videoBriefId: null,
    status: VideoJobStatus.FAILED,
    provider: VideoProvider.MOCK,
    videoRouteSnapshot: null,
    videoModelSnapshot: null,
    videoProviderAdapterSnapshot: null,
    submissionState: ProviderSubmissionState.NOT_STARTED,
    externalJobId: null,
    lastProviderStatus: null,
    errorMessage: "mock rejected before billing",
    quotaRefundedAt: null,
    finishedAt: FAILED_AT,
    createdAt: AUTHORIZED_AT,
    updatedAt: FAILED_AT,
    retryCount: 0,
    ...overrides,
  };
}

function authorizationLogs(batchId = "batch-1", count = 3): Row[] {
  return (["VIDEO_DISPATCH", "SEEDANCE_SEGMENT"] as const).map((resource) => ({
    id: `auth-${batchId}-${resource}`,
    userId: USER,
    resource,
    amount: count,
    createdAt: AUTHORIZED_AT,
    metadata: { batchId, phase: QUOTA_LEDGER_PHASE.batchAuthorization },
  }));
}

function meteredStore(): QuotaFakeStore {
  const store = emptyStore();
  store.batchJobs.push(batchJobRow());
  store.usageLogs.push(...authorizationLogs());
  store.meters.push(
    { userId: USER, periodKey: "2026-10", resource: "VIDEO_DISPATCH", amount: 3 },
    { userId: USER, periodKey: "2026-10", resource: "SEEDANCE_SEGMENT", amount: 3 },
    { userId: USER, periodKey: "2026-11", resource: "VIDEO_DISPATCH", amount: 4 },
    { userId: USER, periodKey: "2026-11", resource: "SEEDANCE_SEGMENT", amount: 4 },
  );
  return store;
}

function itemLogs(store: QuotaFakeStore, jobId: string): Row[] {
  return store.usageLogs.filter(
    (log) => (log.metadata as Row | undefined)?.videoJobId === jobId,
  );
}

function job(store: QuotaFakeStore, id = "job-1"): Row {
  const row = store.videoJobs.find((candidate) => candidate.id === id);
  assert.ok(row, `job ${id} exists`);
  return row;
}

// ---------------------------------------------------------------------------
// 流水净额（纯函数）
// ---------------------------------------------------------------------------

test("D1 ledger: refunds the net charge into the month of the latest positive record", () => {
  const entries: QuotaLedgerEntry[] = [
    { resource: "VIDEO_DISPATCH", amount: 1, createdAt: AUTHORIZED_AT, phase: "batch_authorization" },
    { resource: "SEEDANCE_SEGMENT", amount: 1, createdAt: AUTHORIZED_AT, phase: "batch_authorization" },
  ];
  assert.deepEqual(planLedgerRefund(entries), [
    { resource: "VIDEO_DISPATCH", amount: 1, periodKey: "2026-10", chargePhase: "batch_authorization" },
    { resource: "SEEDANCE_SEGMENT", amount: 1, periodKey: "2026-10", chargePhase: "batch_authorization" },
  ]);
  assert.deepEqual(planLedgerRecharge(entries), [], "an unrefunded item needs no recharge");

  const refunded: QuotaLedgerEntry[] = [
    ...entries,
    { resource: "VIDEO_DISPATCH", amount: -1, createdAt: FAILED_AT, phase: "batch_item_refund" },
    { resource: "SEEDANCE_SEGMENT", amount: -1, createdAt: FAILED_AT, phase: "batch_item_refund" },
  ];
  assert.deepEqual(planLedgerRefund(refunded), [], "net zero never refunds twice");
  assert.deepEqual(planLedgerRecharge(refunded), [
    { resource: "VIDEO_DISPATCH", amount: 1 },
    { resource: "SEEDANCE_SEGMENT", amount: 1 },
  ]);

  const recharged: QuotaLedgerEntry[] = [
    ...refunded,
    { resource: "VIDEO_DISPATCH", amount: 1, createdAt: new Date("2026-12-02T00:00:00Z"), phase: "batch_retry_recharge" },
    { resource: "SEEDANCE_SEGMENT", amount: 1, createdAt: new Date("2026-12-02T00:00:00Z"), phase: "batch_retry_recharge" },
  ];
  assert.deepEqual(
    planLedgerRefund(recharged).map((item) => item.periodKey),
    ["2026-12", "2026-12"],
    "a refund after a recharge goes back to the recharge month",
  );
  assert.deepEqual(planLedgerRefund([]), [], "unmetered items (exempt / scripts) never touch meters");
  assert.deepEqual(planLedgerRecharge([]), []);
});

test("D1 cutoff: defaults to the deploy day, honours a valid override, rejects garbage", () => {
  assert.equal(quotaRefundCutoff({}).toISOString(), QUOTA_REFUND_CUTOFF_DEFAULT);
  assert.equal(
    quotaRefundCutoff({ QUOTA_REFUND_CUTOFF: "2026-11-01T00:00:00Z" }).toISOString(),
    "2026-11-01T00:00:00.000Z",
  );
  assert.equal(
    quotaRefundCutoff({ QUOTA_REFUND_CUTOFF: "not-a-date" }).toISOString(),
    QUOTA_REFUND_CUTOFF_DEFAULT,
  );
});

// ---------------------------------------------------------------------------
// 按条返还
// ---------------------------------------------------------------------------

test("D1 batch refund: a failed item returns 1 video + 1 segment to the authorization month, exactly once", async (t) => {
  const store = meteredStore();
  store.videoJobs.push(videoJobRow());
  const fake = installQuotaFakeDb(t, store);

  assert.equal(await refundUndeliveredBatchJob("job-1", { now: NOW, cutoff: CUTOFF }), "refunded");
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 2);
  assert.equal(meterAmount(store, USER, "2026-10", "SEEDANCE_SEGMENT"), 2);
  assert.equal(meterAmount(store, USER, "2026-11", "VIDEO_DISPATCH"), 4, "current month untouched");
  assert.ok(job(store).quotaRefundedAt instanceof Date);
  const refunds = itemLogs(store, "job-1");
  assert.deepEqual(
    refunds.map((log) => [log.resource, log.amount]),
    [
      ["VIDEO_DISPATCH", -1],
      ["SEEDANCE_SEGMENT", -1],
    ],
  );
  for (const log of refunds) {
    assert.deepEqual(log.metadata, {
      batchId: "batch-1",
      videoJobId: "job-1",
      phase: "batch_item_refund",
      reason: "failed",
      chargedPeriodKey: "2026-10",
      chargePhase: "batch_authorization",
    });
  }

  assert.equal(await refundUndeliveredBatchJob("job-1", { now: NOW, cutoff: CUTOFF }), "skipped");
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 2, "replay never refunds twice");
  assert.equal(itemLogs(store, "job-1").length, 2);
  assert.ok(
    fake.isolationLevels.every((level) => level === Prisma.TransactionIsolationLevel.Serializable),
  );
});

test("D1 batch refund: a cancelled item is refunded like a failure", async (t) => {
  const store = meteredStore();
  store.videoJobs.push(videoJobRow({ status: VideoJobStatus.CANCELLED }));
  installQuotaFakeDb(t, store);

  assert.equal(await refundUndeliveredBatchJob("job-1", { now: NOW, cutoff: CUTOFF }), "refunded");
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 2);
  assert.equal((itemLogs(store, "job-1")[0].metadata as Row).reason, "cancelled");
});

test("D1 batch refund: no positive authorization record (exempt / script) only stamps the mark", async (t) => {
  const store = meteredStore();
  store.usageLogs.length = 0;
  store.videoJobs.push(videoJobRow({ status: VideoJobStatus.CANCELLED }));
  installQuotaFakeDb(t, store);

  assert.equal(await refundUndeliveredBatchJob("job-1", { now: NOW, cutoff: CUTOFF }), "stamped");
  assert.ok(job(store).quotaRefundedAt instanceof Date);
  assert.equal(store.usageLogs.length, 0, "no ledger rows are invented");
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 3);
});

test("D1 batch refund: delivered, still-running and pre-cutoff items are never touched", async (t) => {
  const store = meteredStore();
  store.videoJobs.push(
    videoJobRow({ id: "job-ok", status: VideoJobStatus.SUCCEEDED }),
    videoJobRow({ id: "job-running", status: VideoJobStatus.RUNNING, finishedAt: null }),
    videoJobRow({ id: "job-old", finishedAt: new Date(CUTOFF.getTime() - 1) }),
    videoJobRow({
      id: "job-old-unfinished",
      finishedAt: null,
      createdAt: new Date(CUTOFF.getTime() - 1),
    }),
  );
  installQuotaFakeDb(t, store);

  for (const id of ["job-ok", "job-running", "job-old", "job-old-unfinished"]) {
    assert.equal(await refundUndeliveredBatchJob(id, { now: NOW, cutoff: CUTOFF }), "skipped", id);
    assert.equal(job(store, id).quotaRefundedAt, null, `${id} stays unmarked`);
  }
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 3);
  assert.equal(store.usageLogs.length, 2, "only the two authorization rows remain");
});

test("D1 batch refund: a meter that cannot be decremented stamps without inventing a ledger row", async (t) => {
  const store = meteredStore();
  store.meters.length = 0;
  store.videoJobs.push(videoJobRow());
  installQuotaFakeDb(t, store);
  t.mock.method(console, "warn", () => {});

  assert.equal(await refundUndeliveredBatchJob("job-1", { now: NOW, cutoff: CUTOFF }), "stamped");
  assert.equal(itemLogs(store, "job-1").length, 0);
  assert.ok(job(store).quotaRefundedAt instanceof Date);
});

// ---------------------------------------------------------------------------
// 已返还条目再重试：先补扣
// ---------------------------------------------------------------------------

function refundedStore(): QuotaFakeStore {
  const store = meteredStore();
  store.batchJobs[0].status = BatchJobStatus.PARTIAL_FAILED;
  store.videoJobs.push(videoJobRow({ quotaRefundedAt: FAILED_AT }));
  for (const resource of ["VIDEO_DISPATCH", "SEEDANCE_SEGMENT"]) {
    store.usageLogs.push({
      id: `refund-${resource}`,
      userId: USER,
      resource,
      amount: -1,
      createdAt: FAILED_AT,
      metadata: { batchId: "batch-1", videoJobId: "job-1", phase: "batch_item_refund" },
    });
  }
  return store;
}

test("D1 retry: a refunded item is re-charged 1 + 1 in the same transaction that requeues it", async (t) => {
  enforceQuota(t);
  const store = refundedStore();
  const fake = installQuotaFakeDb(t, store);
  const period = currentUsagePeriodKey();
  const before = meterAmount(store, USER, period, "VIDEO_DISPATCH");

  assert.deepEqual(
    await retryFailedBatchJob("batch-1", "job-1", { session: CUSTOMER }),
    { outcome: "retried" },
  );
  assert.equal(job(store).status, VideoJobStatus.QUEUED);
  assert.equal(job(store).quotaRefundedAt, null, "the new round is unrefunded");
  assert.equal(meterAmount(store, USER, period, "VIDEO_DISPATCH"), before + 1);
  const recharges = itemLogs(store, "job-1").filter((log) => Number(log.amount) > 0);
  assert.deepEqual(
    recharges.map((log) => [log.resource, log.amount, (log.metadata as Row).phase]),
    [
      ["VIDEO_DISPATCH", 1, "batch_retry_recharge"],
      ["SEEDANCE_SEGMENT", 1, "batch_retry_recharge"],
    ],
  );
  assert.ok(
    fake.isolationLevels.includes(Prisma.TransactionIsolationLevel.Serializable),
  );

  // 再失败一次：返还回到补扣那个月，而不是授权月——净额始终不为负。
  Object.assign(job(store), {
    status: VideoJobStatus.FAILED,
    finishedAt: new Date(),
  });
  assert.equal(
    await refundUndeliveredBatchJob("job-1", { now: new Date(), cutoff: EARLY_CUTOFF }),
    "refunded",
  );
  assert.equal(meterAmount(store, USER, period, "VIDEO_DISPATCH"), before);
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 3);
});

test("D1 retry: quota exhausted refuses the retry and leaves the item failed and refunded", async (t) => {
  enforceQuota(t);
  const store = refundedStore();
  const period = currentUsagePeriodKey();
  store.meters = store.meters.filter((m) => m.periodKey !== period);
  store.meters.push(
    { userId: USER, periodKey: period, resource: "VIDEO_DISPATCH", amount: 30 },
    { userId: USER, periodKey: period, resource: "SEEDANCE_SEGMENT", amount: 10 },
  );
  installQuotaFakeDb(t, store);

  await assert.rejects(
    () => retryFailedBatchJob("batch-1", "job-1", { session: CUSTOMER }),
    QuotaExceededError,
  );
  assert.equal(job(store).status, VideoJobStatus.FAILED, "requeue rolled back with the charge");
  assert.ok(job(store).quotaRefundedAt instanceof Date);
  assert.equal(meterAmount(store, USER, period, "VIDEO_DISPATCH"), 30);
  assert.equal(
    itemLogs(store, "job-1").filter((log) => Number(log.amount) > 0).length,
    0,
  );
});

test("D1 retry: an exempt session retries without a charge and the next failure is not refunded twice", async (t) => {
  enforceQuota(t);
  const store = refundedStore();
  installQuotaFakeDb(t, store);

  assert.deepEqual(
    await retryFailedBatchJob("batch-1", "job-1", { session: STAFF }),
    { outcome: "retried" },
  );
  assert.equal(itemLogs(store, "job-1").filter((log) => Number(log.amount) > 0).length, 0);
  Object.assign(job(store), { status: VideoJobStatus.FAILED, finishedAt: new Date() });
  assert.equal(
    await refundUndeliveredBatchJob("job-1", { now: new Date(), cutoff: EARLY_CUTOFF }),
    "stamped",
    "auth 1 − refund 1 = 0: nothing left to return",
  );
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 3);
});

test("D1 retry: a script without a session cannot re-run a refunded item while metering is on", async (t) => {
  enforceQuota(t);
  const store = refundedStore();
  installQuotaFakeDb(t, store);

  assert.deepEqual(await retryFailedBatchJob("batch-1", "job-1"), {
    outcome: "billing_unsafe",
  });
  assert.equal(job(store).status, VideoJobStatus.FAILED);
});

test("D1 retry-all: free items are retried first; quota stops only the refunded ones", async (t) => {
  enforceQuota(t);
  const store = refundedStore();
  store.videoJobs.push(videoJobRow({ id: "job-2", quotaRefundedAt: null }));
  const period = currentUsagePeriodKey();
  store.meters = store.meters.filter((m) => m.periodKey !== period);
  store.meters.push({ userId: USER, periodKey: period, resource: "VIDEO_DISPATCH", amount: 30 });
  installQuotaFakeDb(t, store);

  assert.equal(await retryFailedBatchJobs("batch-1", { session: CUSTOMER }), 1);
  assert.equal(job(store, "job-2").status, VideoJobStatus.QUEUED);
  assert.equal(job(store, "job-1").status, VideoJobStatus.FAILED);
  assert.match(String(store.batchJobs[0].statusReason), /额度不足/);

  // 只剩已返还的条目且额度不足：按额度错误拒绝，而不是「重试了 0 条」。
  job(store, "job-2").status = VideoJobStatus.SUCCEEDED;
  await assert.rejects(
    () => retryFailedBatchJobs("batch-1", { session: CUSTOMER }),
    QuotaExceededError,
  );
});

// ---------------------------------------------------------------------------
// 清扫器对账
// ---------------------------------------------------------------------------

test("D1 reconciler: refunds metered items, stamps unmetered ones, skips the rest; idempotent", async (t) => {
  const store = meteredStore();
  store.batchJobs.push(batchJobRow({ id: "batch-free", idempotencyKey: "k2" }));
  store.videoJobs.push(
    videoJobRow({ id: "job-failed" }),
    videoJobRow({ id: "job-cancelled", status: VideoJobStatus.CANCELLED }),
    videoJobRow({ id: "job-ok", status: VideoJobStatus.SUCCEEDED }),
    videoJobRow({ id: "job-old", finishedAt: new Date(CUTOFF.getTime() - 60_000) }),
    videoJobRow({ id: "job-free", batchJobId: "batch-free" }),
  );
  installQuotaFakeDb(t, store);

  const first = await reconcileUndeliveredQuotaRefunds(NOW, { cutoff: CUTOFF });
  assert.deepEqual(first.refundedJobs.sort(), ["job-cancelled", "job-failed"]);
  assert.equal(first.stampedJobs, 1, "the unmetered batch only gets its mark");
  assert.equal(first.errors, 0);
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 1);
  assert.equal(job(store, "job-old").quotaRefundedAt, null, "history is not refunded");
  assert.equal(job(store, "job-ok").quotaRefundedAt, null);

  const second = await reconcileUndeliveredQuotaRefunds(NOW, { cutoff: CUTOFF });
  assert.deepEqual(second.refundedJobs, []);
  assert.equal(second.stampedJobs, 0);
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 1);
});

function withDatabaseUrl(t: TestContext) {
  const previous = process.env.DATABASE_URL;
  // 只为打开清扫器里的对账开关；所有模型都已换成内存实现，不会真的连接。
  process.env.DATABASE_URL = "postgresql://fake:fake@127.0.0.1:1/never-connected";
  t.after(() => {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  });
}

test("D1 sweep: the reconciler runs at the end of sweepStuckTasks", async (t) => {
  withDatabaseUrl(t);
  const store = meteredStore();
  store.videoJobs.push(videoJobRow());
  installQuotaFakeDb(t, store);
  patchMethod(t, db.finalVideo, "findMany", async () => []);

  const result = await sweepStuckTasks(NOW);
  assert.deepEqual(result.quotaRefunds?.refundedJobs, ["job-1"]);
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 2);
});

test("D1 sweep: a reconciler failure never breaks the sweep", async (t) => {
  withDatabaseUrl(t);
  installQuotaFakeDb(t, meteredStore());
  patchMethod(t, db.finalVideo, "findMany", async () => []);
  patchMethod(t, db.batchJob, "findMany", async () => {
    throw new Error("neon hiccup");
  });
  t.mock.method(console, "warn", () => {});

  const result = await sweepStuckTasks(NOW);
  assert.deepEqual(result.timedOutJobs, []);
  assert.ok((result.quotaRefunds?.errors ?? 0) >= 1);
});

// ---------------------------------------------------------------------------
// 1.2 授权失败 → 已取消；取消释放幂等键
// ---------------------------------------------------------------------------

test("1.2 unauthorized batch: CAS to CANCELLED, key released, queued items cancelled and stamped", async (t) => {
  const store = emptyStore();
  store.batchJobs.push(
    batchJobRow({ status: BatchJobStatus.EXPANDING, quotaConsumedAt: null }),
  );
  store.videoJobs.push(
    videoJobRow({ id: "q-1", status: VideoJobStatus.QUEUED, finishedAt: null }),
    videoJobRow({ id: "q-2", status: VideoJobStatus.QUEUED, finishedAt: null }),
  );
  installQuotaFakeDb(t, store);

  assert.equal(
    await cancelUnauthorizedBatch({ batchId: "batch-1", userId: USER, reason: "本月额度不足" }),
    true,
  );
  const batch = store.batchJobs[0];
  assert.equal(batch.status, BatchJobStatus.CANCELLED);
  assert.equal(batch.idempotencyKey, "cancelled:batch-1:wizard-key-1");
  assert.equal(batch.cancelledCount, 2);
  assert.equal(batch.queuedCount, 0);
  for (const id of ["q-1", "q-2"]) {
    assert.equal(job(store, id).status, VideoJobStatus.CANCELLED);
    assert.ok(job(store, id).quotaRefundedAt instanceof Date, "never authorized: nothing to refund");
  }
});

test("1.2 unauthorized batch: an already-authorized batch is left untouched", async (t) => {
  const store = emptyStore();
  store.batchJobs.push(batchJobRow({ status: BatchJobStatus.RUNNING }));
  store.videoJobs.push(videoJobRow({ status: VideoJobStatus.QUEUED, finishedAt: null }));
  installQuotaFakeDb(t, store);

  assert.equal(
    await cancelUnauthorizedBatch({ batchId: "batch-1", userId: USER, reason: "x" }),
    false,
  );
  assert.equal(store.batchJobs[0].status, BatchJobStatus.RUNNING);
  assert.equal(store.batchJobs[0].idempotencyKey, "wizard-key-1");
  assert.equal(job(store).status, VideoJobStatus.QUEUED, "job cancel rolled back");
});

test("1.2 / iron rule 7: cancelling pending items releases the batch idempotency key once", async (t) => {
  const store = emptyStore();
  store.batchJobs.push(batchJobRow());
  store.videoJobs.push(
    videoJobRow({ id: "done", status: VideoJobStatus.SUCCEEDED }),
    videoJobRow({ id: "queued", status: VideoJobStatus.QUEUED, finishedAt: null }),
  );
  installQuotaFakeDb(t, store);

  assert.equal(await cancelPendingBatchJobs("batch-1"), 1);
  assert.equal(store.batchJobs[0].idempotencyKey, "cancelled:batch-1:wizard-key-1");
  assert.equal(store.batchJobs[0].status, BatchJobStatus.CANCELLED, "completed + cancelled is cancelled");
  assert.equal(job(store, "done").status, VideoJobStatus.SUCCEEDED, "delivered media is kept");
  assert.equal(
    cancelledBatchIdempotencyKey("batch-1", "cancelled:batch-1:wizard-key-1"),
    "cancelled:batch-1:wizard-key-1",
    "never double-prefixed",
  );
});

test("1.2 route: authorization failure cancels the expanded batch before the error is returned", async () => {
  const route = await readFile("src/app/api/batches/route.ts", "utf8");
  const authorize = route.indexOf("await authorizeBatchQuotaForSession");
  const cancel = route.indexOf("await cancelUnauthorizedBatch");
  const rethrow = route.indexOf("throw authorizationError");
  assert.ok(authorize > 0 && cancel > authorize && rethrow > cancel);
  assert.ok(
    route.indexOf("await processBatchTick") > rethrow,
    "no tick runs for an unauthorized batch",
  );
});

// ---------------------------------------------------------------------------
// 1.5 状态推导
// ---------------------------------------------------------------------------

test("1.5 status: cancellation is its own state, never a failure", () => {
  const cases: Array<[Partial<Record<VideoJobStatus, number>>, BatchJobStatus]> = [
    [{ SUCCEEDED: 2, CANCELLED: 1 }, BatchJobStatus.CANCELLED],
    [{ CANCELLED: 3 }, BatchJobStatus.CANCELLED],
    [{ SUCCEEDED: 1, FAILED: 1, CANCELLED: 1 }, BatchJobStatus.PARTIAL_FAILED],
    [{ FAILED: 2, CANCELLED: 1 }, BatchJobStatus.FAILED],
    [{ SUCCEEDED: 2, FAILED: 1 }, BatchJobStatus.PARTIAL_FAILED],
    [{ SUCCEEDED: 3 }, BatchJobStatus.COMPLETED],
    [{ SUCCEEDED: 1, CANCELLED: 1, QUEUED: 1 }, BatchJobStatus.RUNNING],
  ];
  for (const [counts, expected] of cases) {
    assert.equal(
      deriveBatchStatus({ requestedCount: 3, counts }),
      expected,
      JSON.stringify(counts),
    );
  }
});

test("1.5 customer status: a cancelled batch says delivered videos are kept and the rest is not counted", () => {
  const status = toCustomerBatchStatus({
    id: "batch-1",
    userId: USER,
    templateId: "tpl",
    templateVersion: 1,
    productName: null,
    requestedCount: 3,
    status: BatchJobStatus.CANCELLED,
    queuedCount: 0,
    pausedCount: 0,
    runningCount: 0,
    completedCount: 2,
    failedCount: 0,
    cancelledCount: 1,
    finishedAt: NOW,
    createdAt: AUTHORIZED_AT,
    updatedAt: NOW,
    template: {
      id: "tpl",
      version: 1,
      name: "Tpl",
      nameZh: "模板",
      category: "x",
      coverImage: "https://example.test/c.png",
    },
    videoJobs: [],
  } as unknown as Parameters<typeof toCustomerBatchStatus>[0]);
  assert.match(String(status.statusReason), /已取消/);
  assert.match(String(status.statusReason), /不计额度/);
});

// ---------------------------------------------------------------------------
// 1.3 多分组提交
// ---------------------------------------------------------------------------

test("1.3 wizard keys: one stable key per group, a new key only when the group changes", () => {
  const keys = new Map<string, { fingerprint: string; key: string }>();
  let minted = 0;
  const mint = () => `key-${++minted}`;
  const first = groupSubmissionKey(keys, "g1", "body-a", mint);
  const second = groupSubmissionKey(keys, "g2", "body-b", mint);
  assert.notEqual(first, second, "groups never share a key");
  assert.equal(groupSubmissionKey(keys, "g1", "body-a", mint), first, "retry replays its own key");
  assert.notEqual(groupSubmissionKey(keys, "g1", "body-a2", mint), first, "edited group gets a new key");
});

test("1.3 wizard: succeeded groups leave the queue so a resubmit never re-creates them", async () => {
  const wizard = await readFile("src/components/batch/batch-create-wizard.tsx", "utf8");
  assert.match(wizard, /groupSubmissionKey\(\s*submissionKeysRef\.current,\s*group\.id,/);
  assert.doesNotMatch(wizard, /submissionIdentityRef/, "the shared single key is gone");
  assert.match(
    wizard,
    /createdBatchIds\.push\(data\.batch\.id\);[\s\S]{0,400}submissionKeysRef\.current\.delete\(group\.id\)[\s\S]{0,200}setQueuedGroups\(\(current\) =>\s*current\.filter\(\(queued\) => queued\.id !== group\.id\)/,
  );
});
