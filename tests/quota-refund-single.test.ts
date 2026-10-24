import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import {
  ProviderSubmissionState,
  VideoBriefStatus,
  VideoDispatchRequestState,
  VideoJobStatus,
} from "@prisma/client";
import type { Session } from "next-auth";
import {
  compensateDirectDispatchQuota,
  currentUsagePeriodKey,
  DirectDispatchQuotaCompensationError,
  QuotaExceededError,
} from "../src/lib/services/quota-service";
import {
  QUOTA_LEDGER_PHASE,
  QUOTA_REFUND_CUTOFF_DEFAULT,
  rechargeRefundedBriefForSession,
  reconcileUndeliveredQuotaRefunds,
  refundFailedBrief,
} from "../src/lib/services/quota-refund-service";
import { db } from "../src/lib/db";
import {
  emptyStore,
  installQuotaFakeDb,
  meterAmount,
  type QuotaFakeStore,
  type Row,
} from "./helpers/quota-fake-db";

/**
 * 1025 · A1a「钱」单条路径回归：brief 终态失败按单返还、重试补扣、
 * 派发扣费后抛异常的零任务即时补偿（1.4）。内存版 Prisma，不连数据库。
 */

const CUTOFF = new Date(QUOTA_REFUND_CUTOFF_DEFAULT);
const REQUESTED_AT = new Date("2026-10-27T15:00:00.000Z");
const BRIEF_AT = new Date("2026-10-27T15:00:05.000Z");
const COMPLETED_AT = new Date("2026-10-27T15:00:20.000Z");
const FAILED_AT = new Date("2026-10-27T15:40:00.000Z");
const NOW = new Date("2026-10-27T16:00:00.000Z");
const USER = "customer-1";

const CUSTOMER: Session = {
  user: { id: USER, email: "c@example.test", role: "OPERATOR", userType: "BUSINESS" },
  expires: "2099-01-01T00:00:00.000Z",
};

function enforceQuota(t: TestContext) {
  const previous = process.env.QUOTA_ENFORCE;
  process.env.QUOTA_ENFORCE = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.QUOTA_ENFORCE;
    else process.env.QUOTA_ENFORCE = previous;
  });
}

function successBody(briefId: string): Row {
  return {
    ok: true,
    deliveryOrderId: "order-1",
    briefId,
    batch: [{ briefId, deliveryOrderId: "order-1" }],
  };
}

function dispatchRequest(overrides: Row = {}): Row {
  return {
    id: "request-1",
    userId: USER,
    state: VideoDispatchRequestState.COMPLETED,
    createdAt: REQUESTED_AT,
    completedAt: COMPLETED_AT,
    quotaConsumedAt: REQUESTED_AT,
    responseBody: successBody("brief-1"),
    ...overrides,
  };
}

function authorization(requestId = "request-1", segments = 2): Row[] {
  return [
    { resource: "VIDEO_DISPATCH", amount: 1 },
    { resource: "SEEDANCE_SEGMENT", amount: segments },
  ].map((item) => ({
    id: `auth-${requestId}-${item.resource}`,
    userId: USER,
    ...item,
    createdAt: REQUESTED_AT,
    metadata: { requestId, phase: QUOTA_LEDGER_PHASE.directDispatchAuthorization },
  }));
}

function failedBrief(overrides: Row = {}): Row {
  return {
    id: "brief-1",
    ownerId: USER,
    status: VideoBriefStatus.RENDER_FAILED,
    quotaRefundedAt: null,
    finalVideoUrl: null,
    brandedVideoUrl: null,
    createdAt: BRIEF_AT,
    finalVideo: null,
    ...overrides,
  };
}

function segmentJob(overrides: Row = {}): Row {
  return {
    id: "segment-0",
    videoBriefId: "brief-1",
    batchJobId: null,
    status: VideoJobStatus.FAILED,
    submissionState: ProviderSubmissionState.ACCEPTED,
    finishedAt: FAILED_AT,
    createdAt: BRIEF_AT,
    quotaRefundedAt: null,
    ...overrides,
  };
}

function singleStore(): QuotaFakeStore {
  const store = emptyStore();
  store.dispatchRequests.push(dispatchRequest());
  store.usageLogs.push(...authorization());
  store.briefs.push(failedBrief());
  store.videoJobs.push(segmentJob(), segmentJob({ id: "segment-1" }));
  store.meters.push(
    { userId: USER, periodKey: "2026-10", resource: "VIDEO_DISPATCH", amount: 1 },
    { userId: USER, periodKey: "2026-10", resource: "SEEDANCE_SEGMENT", amount: 2 },
  );
  return store;
}

function brief(store: QuotaFakeStore, id = "brief-1"): Row {
  const row = store.briefs.find((candidate) => candidate.id === id);
  assert.ok(row);
  return row;
}

function briefLogs(store: QuotaFakeStore, briefId = "brief-1"): Row[] {
  return store.usageLogs.filter((log) => (log.metadata as Row).briefId === briefId);
}

// ---------------------------------------------------------------------------
// brief 终态失败按单返还
// ---------------------------------------------------------------------------

test("D1 single refund: a failed brief linked by its success response returns 1 video + its segments, once", async (t) => {
  const store = singleStore();
  installQuotaFakeDb(t, store);

  assert.equal(await refundFailedBrief("brief-1", { now: NOW, cutoff: CUTOFF }), "refunded");
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 0);
  assert.equal(meterAmount(store, USER, "2026-10", "SEEDANCE_SEGMENT"), 0);
  assert.ok(brief(store).quotaRefundedAt instanceof Date);
  assert.deepEqual(
    briefLogs(store).map((log) => [log.resource, log.amount, (log.metadata as Row).phase, (log.metadata as Row).requestId]),
    [
      ["VIDEO_DISPATCH", -1, "brief_refund", "request-1"],
      ["SEEDANCE_SEGMENT", -2, "brief_refund", "request-1"],
    ],
  );

  assert.equal(await refundFailedBrief("brief-1", { now: NOW, cutoff: CUTOFF }), "skipped");
  assert.equal(briefLogs(store).length, 2, "never refunded twice");
});

test("D1 single refund: a brief behind a failure response is linked by its request window", async (t) => {
  const store = singleStore();
  store.dispatchRequests[0] = dispatchRequest({
    state: VideoDispatchRequestState.FAILED,
    responseBody: { ok: false, code: "SUBMISSION_ACK_UNKNOWN" },
  });
  installQuotaFakeDb(t, store);

  assert.equal(await refundFailedBrief("brief-1", { now: NOW, cutoff: CUTOFF }), "refunded");
  assert.equal(meterAmount(store, USER, "2026-10", "SEEDANCE_SEGMENT"), 0);
});

test("D1 single refund: an already-compensated request only stamps the brief", async (t) => {
  const store = singleStore();
  store.dispatchRequests[0].quotaConsumedAt = null;
  store.usageLogs.push(
    ...[
      { resource: "VIDEO_DISPATCH", amount: -1 },
      { resource: "SEEDANCE_SEGMENT", amount: -2 },
    ].map((item) => ({
      id: `comp-${item.resource}`,
      userId: USER,
      ...item,
      createdAt: COMPLETED_AT,
      metadata: { requestId: "request-1", phase: QUOTA_LEDGER_PHASE.directDispatchCompensation },
    })),
  );
  installQuotaFakeDb(t, store);

  assert.equal(await refundFailedBrief("brief-1", { now: NOW, cutoff: CUTOFF }), "stamped");
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 1);
  assert.equal(briefLogs(store).length, 0);
});

test("D1 single refund: unmetered origin (no request, e.g. internal flow) only stamps", async (t) => {
  const store = singleStore();
  store.dispatchRequests.length = 0;
  installQuotaFakeDb(t, store);

  assert.equal(await refundFailedBrief("brief-1", { now: NOW, cutoff: CUTOFF }), "stamped");
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 1);
});

test("D1 single refund: two concurrent failure responses are ambiguous → stamp only, never guess", async (t) => {
  const store = singleStore();
  store.dispatchRequests[0] = dispatchRequest({
    state: VideoDispatchRequestState.FAILED,
    responseBody: { ok: false },
  });
  store.dispatchRequests.push(
    dispatchRequest({
      id: "request-2",
      state: VideoDispatchRequestState.FAILED,
      responseBody: { ok: false },
    }),
  );
  installQuotaFakeDb(t, store);
  t.mock.method(console, "warn", () => {});

  assert.equal(await refundFailedBrief("brief-1", { now: NOW, cutoff: CUTOFF }), "stamped");
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 1);
});

test("D1 single refund: in-flight requests, active segments, delivered and historical briefs are left alone", async (t) => {
  const store = singleStore();
  store.dispatchRequests[0] = dispatchRequest({
    state: VideoDispatchRequestState.PROCESSING,
    completedAt: null,
    responseBody: null,
  });
  store.briefs.push(
    failedBrief({ id: "brief-running", createdAt: new Date("2026-10-28T00:00:00Z") }),
    failedBrief({ id: "brief-delivered", finalVideoUrl: "https://example.test/v.mp4" }),
    failedBrief({ id: "brief-old", createdAt: new Date("2026-09-01T00:00:00Z") }),
  );
  store.videoJobs.push(
    segmentJob({ id: "running-seg", videoBriefId: "brief-running", status: VideoJobStatus.QUEUED, finishedAt: null }),
    segmentJob({ id: "old-seg", videoBriefId: "brief-old", finishedAt: new Date("2026-09-01T01:00:00Z") }),
  );
  installQuotaFakeDb(t, store);

  const inFlightNow = new Date(REQUESTED_AT.getTime() + 60_000);
  assert.equal(await refundFailedBrief("brief-1", { now: inFlightNow, cutoff: CUTOFF }), "skipped");
  assert.equal(brief(store).quotaRefundedAt, null, "the route may still compensate it");
  for (const id of ["brief-running", "brief-delivered", "brief-old"]) {
    assert.equal(await refundFailedBrief(id, { now: NOW, cutoff: CUTOFF }), "skipped", id);
    assert.equal(brief(store, id).quotaRefundedAt, null, id);
  }
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 1);
});

test("money LENS-1: a FAILED segment left SUBMITTING by a killed route no longer blocks its refund forever", async (t) => {
  const store = singleStore();
  /// 路由提交途中被杀：行停在 SUBMITTING、没有任务号；清扫器在 timeoutAt + 宽限后盲判 FAILED，
  /// 但不改 submissionState。
  Object.assign(store.videoJobs[0], {
    submissionState: ProviderSubmissionState.SUBMITTING,
    externalJobId: null,
    submittedAt: new Date(NOW.getTime() - 50 * 60_000),
  });
  installQuotaFakeDb(t, store);

  // 刚提交几分钟的 SUBMITTING 仍可能在路上：等它落定。
  const justSubmitted = new Date(store.videoJobs[0].submittedAt as Date);
  assert.equal(
    await refundFailedBrief("brief-1", { now: new Date(justSubmitted.getTime() + 5 * 60_000), cutoff: CUTOFF }),
    "skipped",
  );
  assert.equal(brief(store).quotaRefundedAt, null);

  // 早已超出路由执行上限：不可能再提交成功，按 D1 返还。
  assert.equal(await refundFailedBrief("brief-1", { now: NOW, cutoff: CUTOFF }), "refunded");
  assert.ok(brief(store).quotaRefundedAt instanceof Date);
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 0);
  assert.equal(meterAmount(store, USER, "2026-10", "SEEDANCE_SEGMENT"), 0);
});

test("money LENS-1: the reconciler leaves out briefs it cannot settle yet, so they never pin the queue head", async (t) => {
  const store = singleStore();
  store.briefs.push(
    failedBrief({ id: "brief-inflight" }),
    failedBrief({ id: "brief-running" }),
    failedBrief({ id: "brief-stale-submitting" }),
  );
  store.videoJobs.push(
    segmentJob({
      id: "inflight-seg",
      videoBriefId: "brief-inflight",
      submissionState: ProviderSubmissionState.SUBMITTING,
      submittedAt: new Date(NOW.getTime() - 2 * 60_000),
    }),
    segmentJob({ id: "running-seg", videoBriefId: "brief-running", status: VideoJobStatus.RUNNING, finishedAt: null }),
    segmentJob({
      id: "stale-seg",
      videoBriefId: "brief-stale-submitting",
      submissionState: ProviderSubmissionState.SUBMITTING,
      submittedAt: new Date(NOW.getTime() - 60 * 60_000),
    }),
  );
  installQuotaFakeDb(t, store);
  const briefModel = db.videoBrief as unknown as Record<string, (args: unknown) => Promise<Row[]>>;
  const fakeFindMany = briefModel.findMany;
  const candidates: string[][] = [];
  briefModel.findMany = async (args: unknown) => {
    const rows = await fakeFindMany(args);
    candidates.push(rows.map((row) => String(row.id)));
    return rows;
  };
  t.after(() => {
    briefModel.findMany = fakeFindMany;
  });

  const result = await reconcileUndeliveredQuotaRefunds(NOW, { cutoff: CUTOFF });

  assert.deepEqual(
    candidates[0]?.slice().sort(),
    ["brief-1", "brief-stale-submitting"],
    "有段在跑、提交可能还在路上的 brief 不占对账名额",
  );
  assert.equal(result.errors, 0);
  assert.equal(brief(store, "brief-inflight").quotaRefundedAt, null);
  assert.equal(brief(store, "brief-running").quotaRefundedAt, null);
  assert.ok(brief(store, "brief-stale-submitting").quotaRefundedAt instanceof Date);
});

// ---------------------------------------------------------------------------
// 重试补扣
// ---------------------------------------------------------------------------

function refundedStore(): QuotaFakeStore {
  const store = singleStore();
  store.briefs[0].quotaRefundedAt = FAILED_AT;
  store.meters = [];
  store.usageLogs.push(
    ...[
      { resource: "VIDEO_DISPATCH", amount: -1 },
      { resource: "SEEDANCE_SEGMENT", amount: -2 },
    ].map((item) => ({
      id: `refund-${item.resource}`,
      userId: USER,
      ...item,
      createdAt: FAILED_AT,
      metadata: { briefId: "brief-1", requestId: "request-1", phase: QUOTA_LEDGER_PHASE.briefRefund },
    })),
  );
  return store;
}

test("D1 single retry: a refunded brief is re-charged what was returned before it re-runs", async (t) => {
  enforceQuota(t);
  const store = refundedStore();
  installQuotaFakeDb(t, store);
  const period = currentUsagePeriodKey();

  assert.deepEqual(await rechargeRefundedBriefForSession(CUSTOMER, "brief-1"), {
    recharged: true,
    cleared: true,
  });
  assert.equal(brief(store).quotaRefundedAt, null);
  assert.equal(meterAmount(store, USER, period, "VIDEO_DISPATCH"), 1);
  assert.equal(meterAmount(store, USER, period, "SEEDANCE_SEGMENT"), 2);
  const recharge = briefLogs(store).filter((log) => Number(log.amount) > 0);
  assert.deepEqual(
    recharge.map((log) => [log.resource, log.amount, (log.metadata as Row).phase]),
    [
      ["VIDEO_DISPATCH", 1, "brief_retry_recharge"],
      ["SEEDANCE_SEGMENT", 2, "brief_retry_recharge"],
    ],
  );

  // 刚补扣、重提还没落定时不返还；宽限过后再失败，返还回补扣那个月。
  const rechargedAt = recharge[0].createdAt as Date;
  const early = new Date(rechargedAt.getTime() + 60_000);
  const late = new Date(rechargedAt.getTime() + 10 * 60_000);
  const cutoff = new Date("2026-01-01T00:00:00Z");
  assert.equal(await refundFailedBrief("brief-1", { now: early, cutoff }), "skipped");
  assert.equal(await refundFailedBrief("brief-1", { now: late, cutoff }), "refunded");
  assert.equal(meterAmount(store, USER, period, "VIDEO_DISPATCH"), 0);
  assert.equal(meterAmount(store, USER, period, "SEEDANCE_SEGMENT"), 0);
});

test("D1 single retry: quota exhausted refuses the retry and keeps the refund mark", async (t) => {
  enforceQuota(t);
  const store = refundedStore();
  const period = currentUsagePeriodKey();
  store.meters.push({ userId: USER, periodKey: period, resource: "SEEDANCE_SEGMENT", amount: 59 });
  installQuotaFakeDb(t, store);

  await assert.rejects(
    () => rechargeRefundedBriefForSession(CUSTOMER, "brief-1"),
    QuotaExceededError,
  );
  assert.ok(brief(store).quotaRefundedAt instanceof Date);
  assert.equal(meterAmount(store, USER, period, "VIDEO_DISPATCH"), 0);
});

test("D1 single retry: a never-refunded brief needs no recharge", async (t) => {
  enforceQuota(t);
  const store = singleStore();
  installQuotaFakeDb(t, store);

  assert.deepEqual(await rechargeRefundedBriefForSession(CUSTOMER, "brief-1"), {
    recharged: false,
    cleared: false,
  });
  assert.equal(store.usageLogs.length, 2);
});

test("money LENS-3: a brief refunded by dispatch compensation is re-charged on retry even when two dispatches overlap", async (t) => {
  enforceQuota(t);
  const store = emptyStore();
  /// 两个标签页几秒内各派发一次：A、B 两笔请求的处理窗口互相重叠
  const B_REQUESTED_AT = new Date(REQUESTED_AT.getTime() + 2_000);
  store.dispatchRequests.push(
    dispatchRequest({
      id: "request-A",
      state: VideoDispatchRequestState.PROCESSING,
      completedAt: null,
      responseBody: null,
    }),
    dispatchRequest({
      id: "request-B",
      state: VideoDispatchRequestState.PROCESSING,
      createdAt: B_REQUESTED_AT,
      completedAt: null,
      quotaConsumedAt: B_REQUESTED_AT,
      responseBody: null,
    }),
  );
  store.usageLogs.push(...authorization("request-A"), ...authorization("request-B"));
  store.briefs.push(
    failedBrief({ id: "brief-A1" }),
    failedBrief({ id: "brief-B1", createdAt: new Date(BRIEF_AT.getTime() + 1_000) }),
  );
  for (const briefId of ["brief-A1", "brief-B1"]) {
    for (const index of [0, 1]) {
      store.videoJobs.push(
        segmentJob({
          id: `${briefId}-seg-${index}`,
          videoBriefId: briefId,
          submissionState: ProviderSubmissionState.REJECTED,
          submissionErrorClass: "definitely_not_created:provider_response",
          externalJobId: null,
        }),
      );
    }
  }
  store.meters.push(
    { userId: USER, periodKey: "2026-10", resource: "VIDEO_DISPATCH", amount: 2 },
    { userId: USER, periodKey: "2026-10", resource: "SEEDANCE_SEGMENT", amount: 4 },
  );
  installQuotaFakeDb(t, store);

  /// 供应商把每段都判定为「肯定没建出任务」：路由按请求即时补偿并给 brief 打返还标记
  for (const [requestId, briefId] of [
    ["request-A", "brief-A1"],
    ["request-B", "brief-B1"],
  ]) {
    assert.deepEqual(
      await compensateDirectDispatchQuota({
        requestId,
        userId: USER,
        briefIds: [briefId],
        videoDispatchAmount: 1,
        seedanceSegmentAmount: 2,
        periodKey: "2026-10",
        quotaWasMetered: true,
        reason: "all_jobs_rejected_definitely_not_created",
        responseStatus: 503,
      }),
      { compensated: true, replayed: false },
    );
    Object.assign(store.dispatchRequests.find((request) => request.id === requestId)!, {
      state: VideoDispatchRequestState.FAILED,
      completedAt: COMPLETED_AT,
      responseBody: { ok: false, code: "PROVIDER_ERROR" },
    });
  }
  assert.ok(brief(store, "brief-A1").quotaRefundedAt instanceof Date);
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 0);
  assert.equal(meterAmount(store, USER, "2026-10", "SEEDANCE_SEGMENT"), 0);

  // 窗口认领在这里只能判 ambiguous；补偿流水点名了 brief，重试必须按那笔请求补扣。
  const period = currentUsagePeriodKey();
  const before = {
    video: meterAmount(store, USER, period, "VIDEO_DISPATCH"),
    segments: meterAmount(store, USER, period, "SEEDANCE_SEGMENT"),
  };
  assert.deepEqual(await rechargeRefundedBriefForSession(CUSTOMER, "brief-A1"), {
    recharged: true,
    cleared: true,
  });
  assert.equal(brief(store, "brief-A1").quotaRefundedAt, null);
  assert.equal(meterAmount(store, USER, period, "VIDEO_DISPATCH"), before.video + 1);
  assert.equal(meterAmount(store, USER, period, "SEEDANCE_SEGMENT"), before.segments + 2);
  assert.deepEqual(
    briefLogs(store, "brief-A1")
      .filter((log) => Number(log.amount) > 0)
      .map((log) => [log.resource, log.amount, (log.metadata as Row).phase]),
    [
      ["VIDEO_DISPATCH", 1, "brief_retry_recharge"],
      ["SEEDANCE_SEGMENT", 2, "brief_retry_recharge"],
    ],
  );
  assert.ok(brief(store, "brief-B1").quotaRefundedAt instanceof Date, "另一条 brief 不受影响");
});

test("D1 single retry route: re-charge happens before any re-run and quota errors are returned as such", async () => {
  const route = await readFile("src/app/api/briefs/[id]/render-retry/route.ts", "utf8");
  const firstRecharge = route.indexOf("await rechargeIfRefunded()");
  assert.ok(firstRecharge > 0);
  assert.ok(firstRecharge < route.indexOf("await retryFailedVideoJob(job.id)"));
  assert.ok(
    route.indexOf("await rechargeIfRefunded();\n          await retryStitch") > 0,
    "stitch-only retries are re-charged too",
  );
  assert.match(route, /if \(job\.status === "FAILED"\) await rechargeIfRefunded\(\);\s*await retryFailedVideoJob\(body\.jobId\)/);
  assert.match(route, /quotaErrorResponse\(err\)/);
});

// ---------------------------------------------------------------------------
// 1.4 派发扣费后抛异常：零任务证据即时补偿
// ---------------------------------------------------------------------------

function zeroJobStore(): QuotaFakeStore {
  const store = emptyStore();
  store.dispatchRequests.push(
    dispatchRequest({
      state: VideoDispatchRequestState.PROCESSING,
      completedAt: null,
      responseBody: null,
    }),
  );
  store.storyboardRuns.push({
    id: "run-1",
    userId: USER,
    videoBriefId: null,
    dispatchReservationKey: "request-1",
  });
  store.meters.push(
    { userId: USER, periodKey: "2026-10", resource: "VIDEO_DISPATCH", amount: 1 },
    { userId: USER, periodKey: "2026-10", resource: "SEEDANCE_SEGMENT", amount: 2 },
  );
  return store;
}

const ZERO_JOB_INPUT = {
  requestId: "request-1",
  userId: USER,
  briefIds: [] as string[],
  videoDispatchAmount: 1,
  seedanceSegmentAmount: 2,
  periodKey: "2026-10",
  quotaWasMetered: true,
  reason: "dispatch_threw_before_any_job",
  responseStatus: 500,
  evidence: "zero_jobs" as const,
  storyboardRunId: "run-1",
};

test("1.4 zero-job compensation: brief transaction rolled back (reservation still held) refunds at once", async (t) => {
  const store = zeroJobStore();
  installQuotaFakeDb(t, store);

  assert.deepEqual(await compensateDirectDispatchQuota(ZERO_JOB_INPUT), {
    compensated: true,
    replayed: false,
  });
  assert.equal(store.dispatchRequests[0].quotaConsumedAt, null, "marker cleared");
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 0);
  assert.equal(meterAmount(store, USER, "2026-10", "SEEDANCE_SEGMENT"), 0);
  for (const log of store.usageLogs) {
    const metadata = log.metadata as Row;
    assert.equal(metadata.phase, "direct_dispatch_compensation");
    assert.equal(metadata.evidence, "zero_jobs");
    assert.equal(metadata.providerCallMade, false);
    assert.deepEqual(metadata.briefIds, []);
  }
  assert.deepEqual(await compensateDirectDispatchQuota(ZERO_JOB_INPUT), {
    compensated: false,
    replayed: true,
  });
  assert.equal(store.usageLogs.length, 2, "replay-safe");
});

test("1.4 zero-job compensation: an attached brief with no VideoJob is refunded and stamped", async (t) => {
  const store = zeroJobStore();
  store.storyboardRuns[0] = { ...store.storyboardRuns[0], videoBriefId: "brief-1", dispatchReservationKey: null };
  store.briefs.push(failedBrief({ status: VideoBriefStatus.SCENE_PROMPT_READY }));
  installQuotaFakeDb(t, store);

  assert.equal((await compensateDirectDispatchQuota(ZERO_JOB_INPUT)).compensated, true);
  assert.ok(brief(store).quotaRefundedAt instanceof Date, "the sweep reconciler will never refund it again");
  assert.deepEqual((store.usageLogs[0].metadata as Row).briefIds, ["brief-1"]);
});

test("1.4 zero-job compensation fails closed when any job exists or the reservation is not ours", async (t) => {
  const store = zeroJobStore();
  store.storyboardRuns[0] = { ...store.storyboardRuns[0], videoBriefId: "brief-1", dispatchReservationKey: null };
  store.briefs.push(failedBrief({ status: VideoBriefStatus.RENDERING }));
  store.videoJobs.push(segmentJob({ status: VideoJobStatus.RUNNING, finishedAt: null }));
  installQuotaFakeDb(t, store);

  await assert.rejects(
    () => compensateDirectDispatchQuota(ZERO_JOB_INPUT),
    DirectDispatchQuotaCompensationError,
  );
  store.videoJobs.length = 0;
  store.storyboardRuns[0] = { ...store.storyboardRuns[0], videoBriefId: null, dispatchReservationKey: "another-request" };
  await assert.rejects(
    () => compensateDirectDispatchQuota(ZERO_JOB_INPUT),
    DirectDispatchQuotaCompensationError,
  );
  assert.ok(store.dispatchRequests[0].quotaConsumedAt instanceof Date, "marker untouched");
  assert.equal(meterAmount(store, USER, "2026-10", "VIDEO_DISPATCH"), 1);
  assert.equal(store.usageLogs.length, 0);

  for (const bad of [
    { ...ZERO_JOB_INPUT, briefIds: ["brief-1"] },
    { ...ZERO_JOB_INPUT, storyboardRunId: "" },
    { ...ZERO_JOB_INPUT, videoDispatchAmount: 2 },
  ]) {
    await assert.rejects(
      () => compensateDirectDispatchQuota(bad),
      DirectDispatchQuotaCompensationError,
    );
  }
});

test("1.4 dispatch route: the catch branch tries zero-job compensation before the contact-support answer", async () => {
  const route = await readFile("src/app/api/video-generation/dispatch/route.ts", "utf8");
  const catchIndex = route.lastIndexOf('console.error("[/api/video-generation/dispatch]", err);');
  const zeroJob = route.indexOf('evidence: "zero_jobs"');
  const fallback = route.indexOf('"生成服务的接收状态尚未确认。为避免重复计费，请联系支持核对。"');
  assert.ok(catchIndex > 0 && zeroJob > catchIndex && fallback > zeroJob);
  assert.match(
    route.slice(zeroJob, fallback),
    /quotaMayBeConsumed = false;[\s\S]*return finalResponse\(/,
    "a compensated request releases the storyboard reservation through finalResponse",
  );
});

test("D1 batch retry routes pass the session for the re-charge and map quota errors", async () => {
  for (const file of [
    "src/app/api/batches/[id]/retry/route.ts",
    "src/app/api/batches/[id]/jobs/[jobId]/retry/route.ts",
  ]) {
    const route = await readFile(file, "utf8");
    assert.match(route, /session: guard\.session/, file);
    assert.match(route, /quotaErrorResponse\(error\)/, file);
  }
});
