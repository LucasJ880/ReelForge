import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPERIMENT_BATCH_KEY_PREFIX,
  isExperimentBatchKey,
  notExperimentBatchWhere,
  notExperimentVideoJobWhere,
} from "../src/lib/experiments/run-key";
import { platformBatchFailureWhere } from "../src/lib/services/exchange-readings";

/**
 * X-SCAF-0：实验批次（BatchJob.idempotencyKey 以 exp-2611- 开头）走生产批量管线写库，
 * 但不是商家的生成质量、也不是平台故障。平台读数必须把它们排除：
 *   platformBatchFailureWhere（exchange-readings；原来的调用方创始人日报 2026-11-16 已删）。
 *   （第二处「一次通过率」只有战绩页在用，随那一页 2026-11-16 删除。）
 * 不连数据库：用一个小 where 解释器在内存行上真正执行同一份条件。
 */

type Row = Record<string, unknown>;

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

/* ── 1. platformBatchFailureWhere 本身 ─────────────────────────────── */

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
