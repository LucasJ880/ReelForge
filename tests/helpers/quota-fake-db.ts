import type { TestContext } from "node:test";
import { db } from "../../src/lib/db";

/**
 * 按条返还（1025 · D1）单测用的内存版 Prisma：只实现账务路径用到的查询形状，
 * `$transaction` 抛错时整体回滚（快照还原），用来证明「扣不到额度就不重排」这类原子性。
 * 不连任何数据库。
 */

export type Row = Record<string, unknown>;

export interface QuotaFakeStore {
  videoJobs: Row[];
  batchJobs: Row[];
  usageLogs: Row[];
  meters: Row[];
  briefs: Row[];
  dispatchRequests: Row[];
  storyboardRuns: Row[];
  workspaces: Row[];
}

export function emptyStore(): QuotaFakeStore {
  return {
    videoJobs: [],
    batchJobs: [],
    usageLogs: [],
    meters: [],
    briefs: [],
    dispatchRequests: [],
    storyboardRuns: [],
    workspaces: [],
  };
}

function num(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

function matchValue(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null || value === undefined;
  if (condition instanceof Date) {
    return value instanceof Date && value.getTime() === condition.getTime();
  }
  if (typeof condition === "object" && !Array.isArray(condition)) {
    const c = condition as Row;
    if ("in" in c) return (c.in as unknown[]).includes(value);
    if ("not" in c) {
      return c.not === null ? value !== null && value !== undefined : value !== c.not;
    }
    if (value === null || value === undefined) return false;
    if ("gte" in c && !(num(value) >= num(c.gte))) return false;
    if ("gt" in c && !(num(value) > num(c.gt))) return false;
    if ("lte" in c && !(num(value) <= num(c.lte))) return false;
    if ("lt" in c && !(num(value) < num(c.lt))) return false;
    return true;
  }
  return value === condition;
}

type RelationMatcher = (row: Row, condition: Row) => boolean;

function matches(
  row: Row,
  where: Row | undefined,
  relations: Record<string, RelationMatcher> = {},
): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (key === "AND") {
      if (!(condition as Row[]).every((c) => matches(row, c, relations))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(condition as Row[]).some((c) => matches(row, c, relations))) return false;
      continue;
    }
    if (relations[key]) {
      if (!relations[key](row, condition as Row)) return false;
      continue;
    }
    if (
      key === "metadata" &&
      condition &&
      typeof condition === "object" &&
      "path" in (condition as Row)
    ) {
      const { path, equals, array_contains: arrayContains } = condition as {
        path: string[];
        equals?: unknown;
        array_contains?: unknown;
      };
      let value: unknown = row.metadata;
      for (const segment of path) value = (value as Row | null | undefined)?.[segment];
      if (arrayContains !== undefined) {
        const needles = Array.isArray(arrayContains) ? arrayContains : [arrayContains];
        const haystack: unknown[] = Array.isArray(value) ? value : [];
        if (!needles.every((needle) => haystack.includes(needle))) return false;
        continue;
      }
      if (value !== equals) return false;
      continue;
    }
    if (!matchValue(row[key], condition)) return false;
  }
  return true;
}

function applyData(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value)) {
      const op = value as Row;
      if ("increment" in op) {
        row[key] = Number(row[key] ?? 0) + Number(op.increment);
        continue;
      }
      if ("decrement" in op) {
        row[key] = Number(row[key] ?? 0) - Number(op.decrement);
        continue;
      }
    }
    row[key] = value;
  }
}

let idSeq = 0;

export function createQuotaFakeDb(store: QuotaFakeStore) {
  const jobRelations: Record<string, RelationMatcher> = {};
  const briefRelations: Record<string, RelationMatcher> = {
    contentAngle: (row, condition) => {
      const owner = (((condition.round as Row).deliveryOrder as Row).createdById);
      return row.ownerId === owner;
    },
    videoJobs: (row, condition) => {
      const own = store.videoJobs.filter((job) => job.videoBriefId === row.id);
      if (condition.some && !own.some((job) => matches(job, condition.some as Row))) return false;
      if (condition.none && own.some((job) => matches(job, condition.none as Row))) return false;
      return true;
    },
    finalVideo: (row, condition) =>
      !!row.finalVideo && matches(row.finalVideo as Row, condition.is as Row),
  };
  const batchRelations: Record<string, RelationMatcher> = {
    videoJobs: (row, condition) =>
      store.videoJobs.some(
        (job) => job.batchJobId === row.id && matches(job, condition.some as Row, jobRelations),
      ),
  };

  const hydrateJob = (job: Row): Row => {
    const batch = store.batchJobs.find((b) => b.id === job.batchJobId);
    return { ...job, batchJob: batch ? { userId: batch.userId } : null };
  };
  const hydrateBrief = (brief: Row): Row => ({
    ...brief,
    contentAngle: { round: { deliveryOrder: { createdById: brief.ownerId ?? null } } },
    videoJobs: store.videoJobs
      .filter((job) => job.videoBriefId === brief.id)
      .map((job) => ({ ...job })),
    finalVideo: brief.finalVideo ?? null,
  });

  const models = {
    videoJob: {
      findUnique: async ({ where }: { where: Row }) => {
        const job = store.videoJobs.find((row) => matches(row, where));
        return job ? hydrateJob(job) : null;
      },
      findFirst: async ({ where }: { where: Row }) => {
        const job = store.videoJobs.find((row) => matches(row, where, jobRelations));
        return job ? hydrateJob(job) : null;
      },
      findMany: async ({ where }: { where?: Row } = {}) =>
        store.videoJobs.filter((row) => matches(row, where, jobRelations)).map(hydrateJob),
      count: async ({ where }: { where?: Row } = {}) =>
        store.videoJobs.filter((row) => matches(row, where, jobRelations)).length,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = store.videoJobs.filter((row) => matches(row, where, jobRelations));
        for (const row of rows) applyData(row, data);
        return { count: rows.length };
      },
      groupBy: async ({ where }: { where: Row }) => {
        const counts = new Map<string, number>();
        for (const row of store.videoJobs.filter((r) => matches(r, where))) {
          counts.set(String(row.status), (counts.get(String(row.status)) ?? 0) + 1);
        }
        return [...counts].map(([status, count]) => ({ status, _count: { _all: count } }));
      },
    },
    batchJob: {
      findUnique: async ({ where }: { where: Row }) =>
        store.batchJobs.find((row) => matches(row, where)) ?? null,
      findFirst: async ({ where }: { where: Row }) =>
        store.batchJobs.find((row) => matches(row, where)) ?? null,
      findMany: async ({
        where,
        select,
      }: {
        where?: Row;
        select?: { videoJobs?: { where?: Row } };
      }) =>
        store.batchJobs
          .filter((row) => matches(row, where, batchRelations))
          .map((row) => ({
            ...row,
            videoJobs: select?.videoJobs
              ? store.videoJobs.filter(
                  (job) =>
                    job.batchJobId === row.id &&
                    matches(job, select.videoJobs?.where, jobRelations),
                )
              : undefined,
          })),
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = store.batchJobs.find((r) => matches(r, where));
        if (!row) throw new Error("batch not found");
        applyData(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = store.batchJobs.filter((row) => matches(row, where));
        for (const row of rows) applyData(row, data);
        return { count: rows.length };
      },
    },
    usageLog: {
      findMany: async ({ where }: { where?: Row } = {}) =>
        store.usageLogs.filter((row) => matches(row, where)).map((row) => ({ ...row })),
      create: async ({ data }: { data: Row }) => {
        const row = { id: `log-${++idSeq}`, createdAt: new Date(), ...data };
        store.usageLogs.push(row);
        return row;
      },
    },
    userUsagePeriod: {
      findUnique: async ({ where }: { where: { userId_periodKey_resource: Row } }) =>
        store.meters.find((row) => matches(row, where.userId_periodKey_resource)) ?? null,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = store.meters.filter((row) => matches(row, where));
        for (const row of rows) applyData(row, data);
        return { count: rows.length };
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId_periodKey_resource: Row };
        create: Row;
        update: Row;
      }) => {
        const row = store.meters.find((r) => matches(r, where.userId_periodKey_resource));
        if (row) {
          applyData(row, update);
          return { ...row };
        }
        const created = { ...create };
        store.meters.push(created);
        return created;
      },
    },
    videoBrief: {
      findUnique: async ({ where }: { where: Row }) => {
        const brief = store.briefs.find((row) => matches(row, where));
        return brief ? hydrateBrief(brief) : null;
      },
      findMany: async ({ where }: { where?: Row } = {}) =>
        store.briefs.filter((row) => matches(row, where, briefRelations)).map(hydrateBrief),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = store.briefs.filter((row) => matches(row, where, briefRelations));
        for (const row of rows) applyData(row, data);
        return { count: rows.length };
      },
    },
    videoDispatchRequest: {
      findMany: async ({ where }: { where?: Row } = {}) =>
        store.dispatchRequests
          .filter((row) => matches(row, where))
          .sort((a, b) => num(b.createdAt) - num(a.createdAt))
          .map((row) => ({ ...row })),
      findFirst: async ({ where }: { where: Row }) =>
        store.dispatchRequests.find((row) => matches(row, where)) ?? null,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = store.dispatchRequests.filter((row) => matches(row, where));
        for (const row of rows) applyData(row, data);
        return { count: rows.length };
      },
    },
    storyboardRun: {
      findFirst: async ({ where }: { where: Row }) =>
        store.storyboardRuns.find((row) => matches(row, where)) ?? null,
    },
    workspace: {
      findUnique: async ({ where }: { where: Row }) =>
        store.workspaces.find((row) => matches(row, where)) ?? null,
    },
  };
  return models;
}

export interface QuotaFakeHandle {
  store: QuotaFakeStore;
  isolationLevels: unknown[];
  transactions: number;
}

/**
 * 把 db 的相关模型与 $transaction 换成内存实现；测试结束自动还原。
 */
export function installQuotaFakeDb(
  t: TestContext,
  store: QuotaFakeStore = emptyStore(),
): QuotaFakeHandle {
  const models = createQuotaFakeDb(store);
  const handle: QuotaFakeHandle = { store, isolationLevels: [], transactions: 0 };
  const target = db as unknown as Record<string, Record<string, unknown> | unknown>;
  const originals: Array<() => void> = [];

  for (const [modelName, methods] of Object.entries(models)) {
    const model = target[modelName] as Record<string, unknown>;
    for (const [method, fn] of Object.entries(methods)) {
      const original = model[method];
      model[method] = fn;
      originals.push(() => {
        model[method] = original;
      });
    }
  }
  const originalTransaction = target.$transaction;
  target.$transaction = async (
    operation: (tx: typeof models) => Promise<unknown>,
    options?: { isolationLevel?: unknown },
  ) => {
    handle.transactions += 1;
    handle.isolationLevels.push(options?.isolationLevel);
    const snapshot = structuredClone(store);
    try {
      return await operation(models);
    } catch (error) {
      Object.assign(store, snapshot);
      throw error;
    }
  };
  originals.push(() => {
    target.$transaction = originalTransaction;
  });
  t.after(() => {
    for (const restore of originals.reverse()) restore();
  });
  return handle;
}

export function meterAmount(
  store: QuotaFakeStore,
  userId: string,
  periodKey: string,
  resource: string,
): number {
  const row = store.meters.find(
    (m) => m.userId === userId && m.periodKey === periodKey && m.resource === resource,
  );
  return Number(row?.amount ?? 0);
}
