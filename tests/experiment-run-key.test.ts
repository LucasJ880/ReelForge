import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../src/lib/db";
import {
  EXPERIMENT_BATCH_KEY_PREFIX,
  isExperimentBatchKey,
  notExperimentBatchWhere,
  notExperimentVideoJobWhere,
} from "../src/lib/experiments/run-key";
import { platformBatchFailureWhere } from "../src/lib/services/exchange-readings";
import { videoFirstPassRate } from "../src/lib/services/first-pass-rate-service";
import { loadFounderDigestData } from "../src/lib/services/founder-digest-service";

/**
 * X-SCAF-0：实验批次（BatchJob.idempotencyKey 以 exp-2611- 开头）走生产批量管线写库，
 * 但不是商家的生成质量、也不是平台故障。三处平台读数必须把它们排除：
 *   1. 创始人汇总的失败视频（founder-digest-service → platformBatchFailureWhere）
 *   2. platformBatchFailureWhere 本身（exchange-readings）
 *   3. 一次通过率（first-pass-rate-service）
 * Prisma 一律打桩，不连数据库；另用一个小 where 解释器在内存行上真正执行同一份条件。
 */

type Calls = Record<string, unknown[]>;
type Row = Record<string, unknown>;

/** 把 db.<model>.<method> 换成桩，记录每次的入参；测试结束还原。 */
function stub(t: TestContext, calls: Calls, model: string, method: string, impl: (args: unknown) => unknown) {
  const target = (db as unknown as Record<string, Record<string, unknown>>)[model];
  const original = target[method];
  target[method] = async (args: unknown) => {
    (calls[`${model}.${method}`] ??= []).push(args);
    return impl(args);
  };
  t.after(() => {
    target[method] = original;
  });
}

/* ── 小 where 解释器：只认这几处读数用到的算子 ───────────────────────── */

function scalar(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function matchField(value: unknown, cond: unknown): boolean {
  const isNull = value === null || value === undefined;
  if (cond === null) return isNull;
  if (cond instanceof Date || typeof cond !== "object") return !isNull && scalar(value) === scalar(cond);
  return Object.entries(cond as Row).every(([op, operand]) => {
    if (operand === undefined) return true;
    switch (op) {
      case "in":
        return !isNull && (operand as unknown[]).includes(value);
      case "startsWith":
        return typeof value === "string" && value.startsWith(operand as string);
      case "not":
        if (operand === null) return !isNull;
        if (typeof operand === "object") return !isNull && !matchField(value, operand);
        return !isNull && scalar(value) !== scalar(operand);
      case "gte":
        return !isNull && (scalar(value) as number) >= (scalar(operand) as number);
      case "lte":
        return !isNull && (scalar(value) as number) <= (scalar(operand) as number);
      case "lt":
        return !isNull && (scalar(value) as number) < (scalar(operand) as number);
      default:
        throw new Error(`解释器不支持算子 ${op}`);
    }
  });
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "OR") return (cond as Row[]).some((c) => matches(row, c));
    if (key === "AND") return (Array.isArray(cond) ? cond : [cond]).every((c) => matches(row, c as Row));
    if (key === "NOT") {
      return Array.isArray(cond) ? cond.every((c) => !matches(row, c as Row)) : !matches(row, cond as Row);
    }
    if (key === "batchJob") {
      /// 一对一关系：Prisma 的 is / 简写都要求关系存在；没有批次的行不匹配
      const related = row.batchJob as Row | null | undefined;
      const inner = (cond as { is?: Row }).is ?? (cond as Row);
      return !!related && matches(related, inner);
    }
    return matchField(row[key], cond);
  });
}

const NOW = new Date("2026-11-02T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const range = { gte: new Date(NOW.getTime() - 24 * HOUR), lt: NOW };

const experimentBatch = { id: "batch-exp", userId: "operator", idempotencyKey: `${EXPERIMENT_BATCH_KEY_PREFIX}bakeoff-shuyu-1080p-01` };
const merchantBatch = { id: "batch-shop", userId: "merchant", idempotencyKey: "batch-sunny-20261101-01" };

function failedJob(batch: typeof merchantBatch | null, overrides: Row = {}): Row {
  return {
    status: "FAILED",
    batchJobId: batch?.id ?? null,
    batchJob: batch,
    finishedAt: new Date(NOW.getTime() - 2 * HOUR),
    updatedAt: new Date(NOW.getTime() - HOUR),
    createdAt: new Date(NOW.getTime() - 3 * HOUR),
    retryCount: 0,
    submitAttempts: 1,
    ...overrides,
  };
}

/* ── 运行键本身 ─────────────────────────────────────────────────────── */

test("运行键：前缀固定为 exp-2611-，判定只看前缀", () => {
  assert.equal(EXPERIMENT_BATCH_KEY_PREFIX, "exp-2611-");
  assert.equal(isExperimentBatchKey("exp-2611-bakeoff-01"), true);
  assert.equal(isExperimentBatchKey("exp-2611-"), true);
  assert.equal(isExperimentBatchKey("batch-exp-2611-01"), false, "前缀必须在开头");
  assert.equal(isExperimentBatchKey("EXP-2611-01"), false, "幂等键大小写敏感，不放宽");
  assert.equal(isExperimentBatchKey(null), false);
  assert.equal(isExperimentBatchKey(undefined), false);
});

test("where 片段：BatchJob 维度排除前缀；VideoJob 维度保留无批次的单条任务", () => {
  assert.deepEqual(notExperimentBatchWhere(), { idempotencyKey: { not: { startsWith: "exp-2611-" } } });
  const where = notExperimentVideoJobWhere() as Row;
  assert.equal(matches(failedJob(merchantBatch), where), true);
  assert.equal(matches(failedJob(experimentBatch), where), false);
  assert.equal(matches(failedJob(null), where), true, "单条任务（batchJobId 为空）不受影响");
});

/* ── 2. platformBatchFailureWhere 本身 ─────────────────────────────── */

test("platformBatchFailureWhere：实验批次的失败不算平台失败，商家批次照旧", () => {
  const where = platformBatchFailureWhere(range) as Row;
  assert.deepEqual((where as { batchJob: unknown }).batchJob, { idempotencyKey: { not: { startsWith: "exp-2611-" } } });
  assert.equal(matches(failedJob(merchantBatch), where), true);
  assert.equal(matches(failedJob(experimentBatch), where), false);
  /// 原有判据不动：只算 FAILED、必须有批次、按失败那一刻落窗
  assert.equal(matches(failedJob(merchantBatch, { status: "SUCCEEDED" }), where), false);
  assert.equal(matches(failedJob(null), where), false);
  assert.equal(matches(failedJob(merchantBatch, { finishedAt: new Date(NOW.getTime() - 48 * HOUR) }), where), false);
});

/* ── 1. 创始人汇总：失败视频列表、计数、「需要处理」候选三处都走同一份 where ── */

test("创始人汇总：失败视频的 findMany / count 与「需要处理」候选账号的 where 都带前缀排除", async (t) => {
  const calls: Calls = {};
  const empty = () => [];
  stub(t, calls, "pilotApplication", "findMany", empty);
  stub(t, calls, "pilotApplication", "count", () => 0);
  stub(t, calls, "lead", "findMany", empty);
  stub(t, calls, "lead", "count", () => 0);
  stub(t, calls, "videoJob", "findMany", empty);
  stub(t, calls, "videoJob", "count", () => 0);
  stub(t, calls, "videoBrief", "findMany", empty);
  stub(t, calls, "videoBrief", "count", () => 0);
  stub(t, calls, "batchJob", "findMany", empty);
  stub(t, calls, "deliveryOrder", "findMany", empty);
  stub(t, calls, "adminUser", "findMany", empty);
  stub(t, calls, "adminUser", "count", () => 0);
  stub(t, calls, "workspace", "findMany", empty);

  await loadFounderDigestData(NOW);

  const jobList = (calls["videoJob.findMany"]![0] as { where: Row }).where;
  const jobCount = (calls["videoJob.count"]![0] as { where: Row }).where;
  for (const where of [jobList, jobCount]) {
    assert.equal(matches(failedJob(merchantBatch), where), true);
    assert.equal(matches(failedJob(experimentBatch), where), false, "实验批次的失败不进创始人汇总");
  }
  /// 「需要处理」候选账号：BatchJob.videoJobs some(platformBatchFailureWhere)
  const owners = (calls["batchJob.findMany"]![0] as { where: { videoJobs: { some: Row } } }).where;
  assert.equal(matches(failedJob(experimentBatch), owners.videoJobs.some), false);
  assert.equal(matches(failedJob(merchantBatch), owners.videoJobs.some), true);
  /// 全是只读方法
  assert.ok(Object.keys(calls).every((name) => /\.(findMany|count)$/.test(name)));
});

/* ── 3. 一次通过率：只加运行键排除，样本判据不动 ────────────────────── */

test("一次通过率：实验批次不进样本也不进通过数；单条任务与商家批次照旧；判据其余不变", async (t) => {
  const calls: Calls = {};
  const rows: Row[] = [
    failedJob(merchantBatch, { status: "SUCCEEDED" }),
    failedJob(merchantBatch, { status: "SUCCEEDED", retryCount: 1 }),
    failedJob(merchantBatch),
    failedJob(null, { status: "SUCCEEDED" }),
    failedJob(merchantBatch, { status: "CANCELLED" }),
    ...Array.from({ length: 20 }, () => failedJob(experimentBatch, { status: "SUCCEEDED" })),
    ...Array.from({ length: 20 }, () => failedJob(experimentBatch)),
  ];
  stub(t, calls, "videoJob", "count", (args) => rows.filter((row) => matches(row, (args as { where: Row }).where)).length);

  const platform = await videoFirstPassRate({});
  assert.equal(platform.sample, 4, "成片 3 + 失败 1；取消不计；40 条实验任务一条不进");
  assert.equal(platform.passed, 2, "一次通过 = 无重试的成片（含单条）");

  const sampleWhere = (calls["videoJob.count"]![0] as { where: Row }).where;
  assert.deepEqual(sampleWhere.status, { in: ["SUCCEEDED", "FAILED"] }, "样本判据不动：成片 + 失败，取消不计");
  assert.equal("batchJob" in sampleWhere, false, "不传 userId 时不加归属过滤，单条任务仍在样本里");
  const passedWhere = (calls["videoJob.count"]![1] as { where: Row }).where;
  assert.equal(passedWhere.status, "SUCCEEDED");
  assert.equal(passedWhere.retryCount, 0);
  assert.deepEqual(passedWhere.submitAttempts, { lte: 1 });

  /// 按账号看也一样排除（实验若挂在某个账号下，不污染它的通过率）
  const operatorRows = rows.filter((row) => (row.batchJob as Row | null)?.userId === "operator");
  stub(t, calls, "videoJob", "count", (args) => operatorRows.filter((row) => matches(row, (args as { where: Row }).where)).length);
  const operator = await videoFirstPassRate({ userId: "operator" });
  assert.equal(operator.sample, 0);
});
