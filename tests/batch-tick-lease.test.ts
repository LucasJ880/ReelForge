import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  BatchJobStatus,
  Prisma,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";
import { db } from "../src/lib/db";
import {
  processBatchTick,
  syncBatchCounts,
  __test__ as batchTest,
} from "../src/lib/services/batch-service";
import type { VideoProvider as VideoProviderAdapter } from "../src/lib/video-generation/providers/types";

/**
 * round 1025 · A1b
 *  2.2 批次 tick 租约（D3）：BatchJob.tickLeaseUntil/tickLeaseOwner CAS 抢占，
 *      抢不到跳过、结束（含抛错）必释放、续租落空不再派发；
 *      syncBatchCounts 带 updatedAt 条件写入，落空重读。
 *  2.8 停用账号的批次不再推进排队，但已提交的任务照常对账、计数照常同步。
 *  （2.3 参考图顺序见 batch-reference-order.test.ts）
 *
 * 全部 monkey-patch Prisma 与视频适配器，不触真实 DB、不调供应商、零计费。
 */

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

function withEnv(t: TestContext, values: Record<string, string | undefined>) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const fakeAdapter = {
  id: "fake",
  displayName: "fake",
  manualRetryBillingRisk: "none",
  isConfigured: () => true,
  isMockMode: () => true,
} as unknown as VideoProviderAdapter;

interface FakeBatch {
  id: string;
  userId: string;
  status: BatchJobStatus;
  requestedCount: number;
  quotaConsumedAt: Date | null;
  dispatchQuarantineDecision: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
  tickLeaseOwner: string | null;
  tickLeaseUntil: Date | null;
}

/**
 * 一个只够跑通 processBatchTick 的内存假库：租约 CAS 按真实语义执行，
 * 其余查询返回空（没有排队行、没有在跑的任务），记录每一步做了什么。
 */
function installFakeBatchDb(
  t: TestContext,
  options: {
    disabledAt?: Date | null;
    route?: string;
    lease?: { owner: string; until: Date } | null;
    onReconcileQuery?: () => void;
  } = {},
) {
  withEnv(t, { DISPATCH_BREAKER_ENABLED: "false" });
  batchTest.__setVideoProviderFactoryForTests(() => fakeAdapter);
  t.after(() => batchTest.__setVideoProviderFactoryForTests(null));

  const batch: FakeBatch = {
    id: "batch-lease",
    userId: "user-1",
    status: BatchJobStatus.RUNNING,
    requestedCount: 3,
    quotaConsumedAt: new Date(),
    dispatchQuarantineDecision: null,
    createdAt: new Date(),
    updatedAt: new Date(Date.now() - 1000),
    finishedAt: null,
    tickLeaseOwner: options.lease?.owner ?? null,
    tickLeaseUntil: options.lease?.until ?? null,
  };
  const log: string[] = [];
  let clock = batch.updatedAt.getTime();
  const touch = () => {
    clock += 1;
    batch.updatedAt = new Date(clock);
  };

  patch(t, db.batchJob as unknown as Record<string, unknown>, {
    findUnique: async (args: { include?: unknown }) => {
      log.push(args.include ? "read-batch+owner" : "read-batch");
      return args.include
        ? { ...batch, user: { disabledAt: options.disabledAt ?? null } }
        : { ...batch };
    },
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const { where, data } = args;
      if (where.OR) {
        /// 抢租约：未持有或已过期
        const now = ((where.OR as Array<Record<string, { lt?: Date }>>)[1].tickLeaseUntil.lt as Date);
        const free = batch.tickLeaseUntil === null || batch.tickLeaseUntil < now;
        if (!free) {
          log.push("lease-busy");
          return { count: 0 };
        }
        Object.assign(batch, data);
        touch();
        log.push("lease-acquired");
        return { count: 1 };
      }
      if ("tickLeaseOwner" in where) {
        if (batch.tickLeaseOwner !== where.tickLeaseOwner) {
          log.push(data.tickLeaseOwner === null ? "lease-release-missed" : "lease-renew-missed");
          return { count: 0 };
        }
        Object.assign(batch, data);
        touch();
        log.push(data.tickLeaseOwner === null ? "lease-released" : "lease-renewed");
        return { count: 1 };
      }
      /// 熔断恢复（PAUSED → RUNNING）：本场景没有暂停的批次
      return { count: 0 };
    },
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (args.where.updatedAt && (args.where.updatedAt as Date).getTime() !== batch.updatedAt.getTime()) {
        throw new Prisma.PrismaClientKnownRequestError("Record to update not found.", {
          code: "P2025",
          clientVersion: "test",
        });
      }
      Object.assign(batch, args.data);
      touch();
      log.push("sync-counts");
      return { ...batch };
    },
  });
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findFirst: async () => ({
      provider: VideoProvider.MOCK,
      videoRouteSnapshot: options.route ?? "mock",
      videoModelSnapshot: null,
      videoProviderAdapterSnapshot: null,
    }),
    findMany: async (args: { where: Record<string, unknown> }) => {
      const where = args.where;
      if (where.status === VideoJobStatus.RUNNING && where.externalJobId) {
        log.push("reconcile-running");
        options.onReconcileQuery?.();
      } else if (where.leaseExpiresAt) {
        log.push("recover-leases");
      } else if (where.timeoutAt) {
        log.push("expire-hard-deadline");
      } else if (where.status && typeof where.status === "object" && "in" in (where.status as object)) {
        log.push("prepare-storyboards");
      }
      return [];
    },
    updateMany: async () => ({ count: 0 }),
    groupBy: async () => [{ status: VideoJobStatus.QUEUED, _count: { _all: 3 } }],
  });
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findMany: async () => {
      log.push("storyboards");
      return [];
    },
  });
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async () => {
      log.push("claim");
      return [];
    },
  });
  return { batch, log };
}

test("2.2 租约：另一个 tick 持有未过期租约 → 本次跳过，零对账零派发", async (t) => {
  const { batch, log } = installFakeBatchDb(t, {
    lease: { owner: "other-tab", until: new Date(Date.now() + 60_000) },
  });

  const result = await processBatchTick(batch.id);

  assert.equal(result.id, batch.id);
  assert.deepEqual(log, ["read-batch+owner", "lease-busy"]);
  assert.equal(batch.tickLeaseOwner, "other-tab", "不得抢走或释放别人的租约");
});

test("2.2 租约：抢到 → 完整 tick → 结束时释放", async (t) => {
  const { batch, log } = installFakeBatchDb(t);

  const result = await processBatchTick(batch.id);

  assert.equal(log[1], "lease-acquired");
  assert.ok(log.includes("reconcile-running"));
  assert.ok(log.includes("claim"));
  assert.ok(log.indexOf("lease-renewed") < log.indexOf("claim"), "派发前确认租约仍在");
  assert.equal(log.at(-1), "lease-released");
  assert.equal(batch.tickLeaseOwner, null);
  assert.equal(batch.tickLeaseUntil, null);
  assert.equal(result.status, BatchJobStatus.RUNNING);
});

test("2.2 租约：已过期的租约（持有者被平台杀掉）可以被接手", async (t) => {
  const { batch, log } = installFakeBatchDb(t, {
    lease: { owner: "crashed-tick", until: new Date(Date.now() - 1) },
  });

  await processBatchTick(batch.id);

  assert.equal(log[1], "lease-acquired");
  assert.ok(log.includes("claim"));
  assert.equal(batch.tickLeaseOwner, null);
});

test("2.2 租约：tick 中途抛错也必须释放", async (t) => {
  const { batch, log } = installFakeBatchDb(t, {
    onReconcileQuery: () => {
      throw new Error("provider status query exploded");
    },
  });

  await assert.rejects(() => processBatchTick(batch.id), /exploded/);

  assert.equal(log.at(-1), "lease-released");
  assert.equal(batch.tickLeaseOwner, null);
  assert.ok(!log.includes("claim"));
});

test("2.2 多标签页：同一批次并发两个 tick，只有一个做对账与派发", async (t) => {
  const { batch, log } = installFakeBatchDb(t);

  await Promise.all([processBatchTick(batch.id), processBatchTick(batch.id)]);

  assert.equal(log.filter((entry) => entry === "lease-acquired").length, 1);
  assert.equal(log.filter((entry) => entry === "lease-busy").length, 1);
  assert.equal(log.filter((entry) => entry === "claim").length, 1);
  assert.equal(log.filter((entry) => entry === "reconcile-running").length, 1);
  assert.equal(batch.tickLeaseOwner, null);
});

test("2.2 续租落空（慢 tick 已被别的 tick 接手）→ 不再领取提交", async (t) => {
  const { batch, log } = installFakeBatchDb(t, {
    onReconcileQuery: () => {
      /// 对账期间租约过期并被另一个 tick 抢走
      batch.tickLeaseOwner = "newer-tick";
    },
  });
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message?: unknown) => warnings.push(String(message));
  t.after(() => {
    console.warn = warn;
  });

  await processBatchTick(batch.id);

  assert.ok(warnings.some((message) => message.includes("batch_tick_lease_lost")));

  assert.ok(log.includes("lease-renew-missed"));
  assert.ok(!log.includes("claim"), "丢了租约的 tick 不得再占供应商槽位");
  assert.equal(batch.tickLeaseOwner, "newer-tick", "不得释放别人的租约");
});

test("2.8 停用账号：不建故事板、不领取提交，但已提交任务照常对账、计数照常同步", async (t) => {
  const { batch, log } = installFakeBatchDb(t, {
    disabledAt: new Date("2026-10-25T08:00:00.000Z"),
    route: "buddy",
  });
  const warn = console.warn;
  console.warn = () => undefined;
  t.after(() => {
    console.warn = warn;
  });

  await processBatchTick(batch.id);

  assert.ok(!log.includes("storyboards"), "停用账号不推进故事板（会产生出图费用）");
  assert.ok(!log.includes("prepare-storyboards"));
  assert.ok(!log.includes("claim"), "停用账号的排队任务不再派发");
  assert.ok(log.includes("reconcile-running"), "已提交的付费任务照常收回素材");
  assert.ok(log.includes("sync-counts"));
  assert.equal(log.at(-1), "lease-released");
});

test("2.2 syncBatchCounts：写入带 updatedAt 条件；被并发写者抢先时重读再写", async (t) => {
  let reads = 0;
  const updates: Array<Record<string, unknown>> = [];
  const versions = [new Date("2026-10-25T00:00:00.000Z"), new Date("2026-10-25T00:00:01.000Z")];
  patch(t, db.batchJob as unknown as Record<string, unknown>, {
    findUnique: async () => ({
      id: "batch-sync",
      requestedCount: 2,
      finishedAt: null,
      updatedAt: versions[Math.min(reads++, versions.length - 1)],
    }),
    update: async (args: { where: Record<string, unknown> }) => {
      updates.push(args.where);
      if (updates.length === 1) {
        throw new Prisma.PrismaClientKnownRequestError("Record to update not found.", {
          code: "P2025",
          clientVersion: "test",
        });
      }
      return { id: "batch-sync", status: BatchJobStatus.COMPLETED };
    },
  });
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    groupBy: async () => [{ status: VideoJobStatus.SUCCEEDED, _count: { _all: 2 } }],
  });

  const result = await syncBatchCounts("batch-sync");

  assert.equal(result.status, BatchJobStatus.COMPLETED);
  assert.deepEqual(updates, [
    { id: "batch-sync", updatedAt: versions[0] },
    { id: "batch-sync", updatedAt: versions[1] },
  ]);
});

test("2.2 syncBatchCounts：持续被抢先时不抛错，返回最新行交给下一次 tick 收敛", async (t) => {
  let updates = 0;
  patch(t, db.batchJob as unknown as Record<string, unknown>, {
    findUnique: async () => ({
      id: "batch-contended",
      requestedCount: 1,
      finishedAt: null,
      status: BatchJobStatus.RUNNING,
      updatedAt: new Date(),
    }),
    update: async () => {
      updates += 1;
      throw new Prisma.PrismaClientKnownRequestError("Record to update not found.", {
        code: "P2025",
        clientVersion: "test",
      });
    },
  });
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    groupBy: async () => [],
  });
  const warn = console.warn;
  console.warn = () => undefined;
  t.after(() => {
    console.warn = warn;
  });

  const result = await syncBatchCounts("batch-contended");

  assert.equal(result.id, "batch-contended");
  assert.equal(updates, 3);
});

test("2.2 syncBatchCounts：非 CAS 落空的数据库错误照常抛出", async (t) => {
  patch(t, db.batchJob as unknown as Record<string, unknown>, {
    findUnique: async () => ({
      id: "batch-broken",
      requestedCount: 1,
      finishedAt: null,
      updatedAt: new Date(),
    }),
    update: async () => {
      throw new Error("connection reset");
    },
  });
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    groupBy: async () => [],
  });

  await assert.rejects(() => syncBatchCounts("batch-broken"), /connection reset/);
});

test("2.2 syncBatchCounts：先读批次行、再数任务（落库成功即保证计数不比上一个写者旧）", async (t) => {
  const order: string[] = [];
  patch(t, db.batchJob as unknown as Record<string, unknown>, {
    findUnique: async () => {
      order.push("batch");
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { id: "batch-order", requestedCount: 1, finishedAt: null, updatedAt: new Date() };
    },
    update: async () => ({ id: "batch-order" }),
  });
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    groupBy: async () => {
      order.push("counts");
      return [];
    },
  });

  await syncBatchCounts("batch-order");
  assert.deepEqual(order, ["batch", "counts"]);
});
