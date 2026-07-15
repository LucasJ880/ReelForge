import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import {
  Prisma,
  ProviderSubmissionState,
  VideoDispatchRequestState,
  VideoJobStatus,
} from "@prisma/client";
import { db } from "../src/lib/db";
import {
  compensateDirectDispatchQuota,
  DirectDispatchQuotaCompensationError,
} from "../src/lib/services/quota-service";

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

function safeJob(id: string, videoBriefId: string) {
  return {
    id,
    videoBriefId,
    status: VideoJobStatus.FAILED,
    submissionState: ProviderSubmissionState.REJECTED,
    submissionErrorClass: "definitely_not_created:provider_response",
    externalJobId: null,
  };
}

test("direct dispatch compensation atomically refunds both meters and is replay-safe", async (t) => {
  const request = {
    state: VideoDispatchRequestState.PROCESSING,
    quotaConsumedAt: new Date("2026-07-14T10:00:00.000Z") as Date | null,
  };
  const meters = new Map([
    ["VIDEO_DISPATCH", 9],
    ["SEEDANCE_SEGMENT", 17],
  ]);
  const logs: Array<{
    resource: string;
    amount: number;
    metadata: Record<string, unknown>;
  }> = [];
  const isolationLevels: unknown[] = [];
  let markerCasCalls = 0;
  const jobs = [
    safeJob("job-1", "brief-1"),
    safeJob("job-2", "brief-1"),
    safeJob("job-3", "brief-2"),
    safeJob("job-4", "brief-2"),
  ];
  const tx = {
    videoDispatchRequest: {
      findFirst: async () => ({ ...request }),
      updateMany: async () => {
        markerCasCalls += 1;
        if (!request.quotaConsumedAt) return { count: 0 };
        request.quotaConsumedAt = null;
        return { count: 1 };
      },
    },
    videoBrief: {
      findMany: async () => [{ id: "brief-1" }, { id: "brief-2" }],
    },
    videoJob: {
      findMany: async () => jobs,
    },
    userUsagePeriod: {
      updateMany: async (args: {
        where: { resource: string; amount: { gte: number } };
        data: { amount: { decrement: number } };
      }) => {
        const resource = args.where.resource;
        const current = meters.get(resource) ?? 0;
        if (current < args.where.amount.gte) return { count: 0 };
        meters.set(resource, current - args.data.amount.decrement);
        return { count: 1 };
      },
    },
    usageLog: {
      create: async (args: {
        data: {
          resource: string;
          amount: number;
          metadata: Record<string, unknown>;
        };
      }) => {
        logs.push(args.data);
        return args.data;
      },
    },
  };
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async (
      operation: (client: typeof tx) => Promise<unknown>,
      options?: { isolationLevel?: unknown },
    ) => {
      isolationLevels.push(options?.isolationLevel);
      return operation(tx);
    },
  });

  const input = {
    requestId: "dispatch-request-1",
    userId: "customer-1",
    briefIds: ["brief-1", "brief-2"],
    videoDispatchAmount: 2,
    seedanceSegmentAmount: 4,
    periodKey: "2026-07",
    quotaWasMetered: true,
    reason: "all_jobs_rejected_definitely_not_created",
    responseStatus: 503,
  };
  const first = await compensateDirectDispatchQuota(input);
  const replay = await compensateDirectDispatchQuota(input);

  assert.deepEqual(first, { compensated: true, replayed: false });
  assert.deepEqual(replay, { compensated: false, replayed: true });
  assert.equal(request.quotaConsumedAt, null);
  assert.equal(markerCasCalls, 1, "the marker CAS is the replay fence");
  assert.deepEqual(Object.fromEntries(meters), {
    VIDEO_DISPATCH: 7,
    SEEDANCE_SEGMENT: 13,
  });
  assert.deepEqual(
    logs.map(({ resource, amount }) => ({ resource, amount })),
    [
      { resource: "VIDEO_DISPATCH", amount: -2 },
      { resource: "SEEDANCE_SEGMENT", amount: -4 },
    ],
  );
  for (const log of logs) {
    assert.deepEqual(log.metadata, {
      requestId: "dispatch-request-1",
      reason: "all_jobs_rejected_definitely_not_created",
      providerCallMade: true,
      providerRequestSent: true,
      providerAccepted: false,
      providerJobCreated: false,
      failureStages: ["provider_response"],
      customerResponseClass: "5xx",
      customerResponseStatus: 503,
      phase: "direct_dispatch_compensation",
    });
  }
  assert.ok(
    isolationLevels.every(
      (level) => level === Prisma.TransactionIsolationLevel.Serializable,
    ),
  );
});

test("quota-exempt direct dispatch clears the marker without inventing meter activity", async (t) => {
  const request = {
    state: VideoDispatchRequestState.PROCESSING,
    quotaConsumedAt: new Date("2026-07-14T10:00:00.000Z") as Date | null,
  };
  let meterCalls = 0;
  let logCalls = 0;
  const tx = {
    videoDispatchRequest: {
      findFirst: async () => ({ ...request }),
      updateMany: async () => {
        request.quotaConsumedAt = null;
        return { count: 1 };
      },
    },
    videoBrief: { findMany: async () => [{ id: "brief-exempt" }] },
    videoJob: {
      findMany: async () => [safeJob("job-exempt", "brief-exempt")],
    },
    userUsagePeriod: {
      updateMany: async () => {
        meterCalls += 1;
        return { count: 0 };
      },
    },
    usageLog: {
      create: async () => {
        logCalls += 1;
      },
    },
  };
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  });

  const result = await compensateDirectDispatchQuota({
    requestId: "dispatch-exempt",
    userId: "operator-1",
    briefIds: ["brief-exempt"],
    videoDispatchAmount: 1,
    seedanceSegmentAmount: 1,
    periodKey: "2026-07",
    quotaWasMetered: false,
    reason: "all_jobs_rejected_definitely_not_created",
    responseStatus: 503,
  });

  assert.deepEqual(result, { compensated: true, replayed: false });
  assert.equal(request.quotaConsumedAt, null);
  assert.equal(meterCalls, 0);
  assert.equal(logCalls, 0);
});

test("ambiguous or externally-created jobs fail closed before marker or ledger mutation", async (t) => {
  const marker = new Date("2026-07-14T10:00:00.000Z");
  let markerCasCalls = 0;
  let meterCalls = 0;
  let logCalls = 0;
  let job: {
    id: string;
    videoBriefId: string;
    status: VideoJobStatus;
    submissionState: ProviderSubmissionState;
    submissionErrorClass: string | null;
    externalJobId: string | null;
  } = {
    ...safeJob("job-unsafe", "brief-unsafe"),
    externalJobId: "provider-job-may-be-billable",
  };
  const tx = {
    videoDispatchRequest: {
      findFirst: async () => ({
        state: VideoDispatchRequestState.PROCESSING,
        quotaConsumedAt: marker,
      }),
      updateMany: async () => {
        markerCasCalls += 1;
        return { count: 1 };
      },
    },
    videoBrief: { findMany: async () => [{ id: "brief-unsafe" }] },
    videoJob: {
      findMany: async () => [job],
    },
    userUsagePeriod: {
      updateMany: async () => {
        meterCalls += 1;
        return { count: 1 };
      },
    },
    usageLog: {
      create: async () => {
        logCalls += 1;
      },
    },
  };
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  });

  const input = {
    requestId: "dispatch-unsafe",
    userId: "customer-unsafe",
    briefIds: ["brief-unsafe"],
    videoDispatchAmount: 1,
    seedanceSegmentAmount: 1,
    periodKey: "2026-07",
    quotaWasMetered: true,
    reason: "all_jobs_rejected_definitely_not_created",
    responseStatus: 503,
  };
  await assert.rejects(
    () => compensateDirectDispatchQuota(input),
    DirectDispatchQuotaCompensationError,
  );
  job = {
    ...safeJob("job-unsafe", "brief-unsafe"),
    submissionState: ProviderSubmissionState.ACK_UNKNOWN,
    externalJobId: null,
  };
  await assert.rejects(
    () => compensateDirectDispatchQuota(input),
    DirectDispatchQuotaCompensationError,
  );
  job = {
    ...safeJob("job-unsafe", "brief-unsafe"),
    submissionErrorClass: "acknowledgement_unknown:provider_response",
    externalJobId: null,
  };
  await assert.rejects(
    () => compensateDirectDispatchQuota(input),
    DirectDispatchQuotaCompensationError,
  );
  assert.equal(markerCasCalls, 0);
  assert.equal(meterCalls, 0);
  assert.equal(logCalls, 0);
});

test("dispatch route compensates only after strict evidence and before provider error", async () => {
  const route = await readFile(
    "src/app/api/video-generation/dispatch/route.ts",
    "utf8",
  );
  const evidenceIndex = route.indexOf(
    "const safelyRejectedBeforeCreation",
  );
  const compensationIndex = route.indexOf(
    "await compensateDirectDispatchQuota",
  );
  const refundedResponseIndex = route.indexOf(
    'message: quotaReceipt.consumed',
  );

  assert.ok(evidenceIndex >= 0);
  assert.ok(compensationIndex > evidenceIndex);
  assert.ok(refundedResponseIndex > compensationIndex);
  assert.match(route, /job\.submissionState === "REJECTED"/);
  assert.match(route, /job\.externalJobId == null/);
  assert.match(route, /definitely_not_created/);
});
