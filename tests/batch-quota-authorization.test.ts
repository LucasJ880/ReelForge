import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { BatchJobStatus, VideoProvider } from "@prisma/client";
import type { Session } from "next-auth";
import { db } from "../src/lib/db";
import {
  BatchDispatchNotAuthorizedError,
  processBatchTick,
} from "../src/lib/services/batch-service";
import {
  authorizeBatchQuotaForSession,
  QuotaExceededError,
} from "../src/lib/services/quota-service";

const SESSION: Session = {
  user: {
    id: "quota-user",
    email: "quota@example.test",
    role: "OPERATOR",
    userType: "PERSONAL",
  },
  expires: "2099-01-01T00:00:00.000Z",
};

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

function enforceQuota(t: TestContext) {
  const previous = process.env.QUOTA_ENFORCE;
  process.env.QUOTA_ENFORCE = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.QUOTA_ENFORCE;
    else process.env.QUOTA_ENFORCE = previous;
  });
}

test("Phase 2 quota guard: an unauthorized expanded batch reaches zero provider work", async (t) => {
  let videoReads = 0;
  patch(t, db.batchJob as unknown as Record<string, unknown>, {
    findUnique: async () => ({
      id: "batch-unpaid",
      status: BatchJobStatus.EXPANDING,
      quotaConsumedAt: null,
    }),
  });
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findFirst: async () => {
      videoReads += 1;
      return { provider: VideoProvider.MOCK };
    },
  });

  await assert.rejects(
    () => processBatchTick("batch-unpaid"),
    BatchDispatchNotAuthorizedError,
  );
  // The provider type read is harmless; no claim/reconcile/submit path runs.
  assert.equal(videoReads, 1);
});

test("Phase 2 quota guard: replay authorizes and meters a batch exactly once", async (t) => {
  enforceQuota(t);
  const batch = {
    id: "batch-once",
    userId: SESSION.user.id,
    requestedCount: 12,
    status: BatchJobStatus.EXPANDING as BatchJobStatus,
    quotaConsumedAt: null as Date | null,
  };
  const meters = new Map<string, number>();
  const logs: Array<{ resource: string; amount: number }> = [];
  patch(t, db.workspace as unknown as Record<string, unknown>, {
    findUnique: async () => ({ planId: "studio" }),
  });
  const tx = {
    batchJob: {
      findFirst: async () => ({ ...batch }),
      updateMany: async () => {
        if (batch.quotaConsumedAt) return { count: 0 };
        batch.status = BatchJobStatus.RUNNING;
        batch.quotaConsumedAt = new Date();
        return { count: 1 };
      },
    },
    userUsagePeriod: {
      findUnique: async (args: {
        where: { userId_periodKey_resource: { resource: string } };
      }) => {
        const resource = args.where.userId_periodKey_resource.resource;
        const amount = meters.get(resource);
        return amount === undefined ? null : { amount };
      },
      upsert: async (args: {
        create: { resource: string; amount: number };
      }) => {
        const { resource, amount } = args.create;
        meters.set(resource, (meters.get(resource) ?? 0) + amount);
        return { amount: meters.get(resource) };
      },
    },
    usageLog: {
      create: async (args: {
        data: { resource: string; amount: number };
      }) => {
        logs.push(args.data);
        return args.data;
      },
    },
  };
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  });

  const first = await authorizeBatchQuotaForSession(SESSION, batch.id);
  const replay = await authorizeBatchQuotaForSession(SESSION, batch.id);

  assert.deepEqual(first, { authorized: true, replayed: false });
  assert.deepEqual(replay, { authorized: true, replayed: true });
  assert.equal(batch.status, BatchJobStatus.RUNNING);
  assert.ok(batch.quotaConsumedAt);
  assert.deepEqual(Object.fromEntries(meters), {
    VIDEO_DISPATCH: 12,
    SEEDANCE_SEGMENT: 12,
  });
  assert.equal(logs.length, 2, "replay must not create another usage ledger entry");
});

test("Phase 2 quota guard: exhausted quota leaves the batch non-dispatchable", async (t) => {
  enforceQuota(t);
  let activationCalls = 0;
  let logCalls = 0;
  patch(t, db.workspace as unknown as Record<string, unknown>, {
    findUnique: async () => ({ planId: "starter" }),
  });
  const tx = {
    batchJob: {
      findFirst: async () => ({
        id: "batch-over-limit",
        userId: SESSION.user.id,
        requestedCount: 2,
        status: BatchJobStatus.EXPANDING,
        quotaConsumedAt: null,
      }),
      updateMany: async () => {
        activationCalls += 1;
        return { count: 1 };
      },
    },
    userUsagePeriod: {
      findUnique: async () => ({ amount: 30 }),
      upsert: async () => {
        throw new Error("must not meter over-limit batch");
      },
    },
    usageLog: {
      create: async () => {
        logCalls += 1;
      },
    },
  };
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  });

  await assert.rejects(
    () => authorizeBatchQuotaForSession(SESSION, "batch-over-limit"),
    QuotaExceededError,
  );
  assert.equal(activationCalls, 0);
  assert.equal(logCalls, 0);
});
