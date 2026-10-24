import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { BatchJobStatus, ProviderSubmissionState, VideoJobStatus } from "@prisma/client";
import { db } from "../src/lib/db";
import { sweepStuckTasks, __test__ as sweepTest } from "../src/lib/services/sweep-service";

/**
 * 2.1 重试路径的清扫修复（round 1025 · A1b）。
 *
 * de8f698 只修了首次排队：排队豁免与绝对上限按 createdAt 计时。13 小时前建的
 * 批次点「重试全部」后，第 2、3 波行 createdAt 早已越过 12h 绝对上限，豁免失效、
 * 又吃 createdAt+60min 兜底，下一分钟就被扫成「生成超时」；已提交的第 1 波
 * 也因为 createdAt 越界被盲判失败，不再先问供应商。
 *
 * 这里不只比对查询对象的形状：用一个按 SQL 三值逻辑（NULL → unknown）求值的
 * 小型 where 解释器在内存行上真正执行清扫的查询与 CAS，NOT(unknown) 漏行这类
 * 只在真库上才会暴露的问题也能在单测里抓到。不触真实 DB，零计费。
 */

type Tri = boolean | null;
type Row = Record<string, unknown>;

const and = (values: Tri[]): Tri =>
  values.includes(false) ? false : values.includes(null) ? null : true;
const or = (values: Tri[]): Tri =>
  values.includes(true) ? true : values.includes(null) ? null : false;
const not = (value: Tri): Tri => (value === null ? null : !value);

function scalar(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function evalField(value: unknown, cond: unknown): Tri {
  const isNull = value === null || value === undefined;
  if (cond === null) return isNull;
  if (cond instanceof Date || typeof cond !== "object") {
    return isNull ? null : scalar(value) === scalar(cond);
  }
  const parts: Tri[] = [];
  for (const [op, operand] of Object.entries(cond as Record<string, unknown>)) {
    if (operand === undefined) continue;
    switch (op) {
      case "not":
        parts.push(
          operand === null
            ? !isNull
            : isNull
              ? null
              : scalar(value) !== scalar(operand),
        );
        break;
      case "in":
        parts.push(
          isNull ? null : (operand as unknown[]).some((o) => scalar(o) === scalar(value)),
        );
        break;
      case "lt":
        parts.push(isNull ? null : (scalar(value) as number) < (scalar(operand) as number));
        break;
      case "lte":
        parts.push(isNull ? null : (scalar(value) as number) <= (scalar(operand) as number));
        break;
      case "gt":
        parts.push(isNull ? null : (scalar(value) as number) > (scalar(operand) as number));
        break;
      case "gte":
        parts.push(isNull ? null : (scalar(value) as number) >= (scalar(operand) as number));
        break;
      default:
        throw new Error(`where 解释器不支持算子 ${op}`);
    }
  }
  return and(parts);
}

function evalWhere(row: Row, where: Record<string, unknown>): Tri {
  const parts: Tri[] = [];
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === "AND") {
      const list = Array.isArray(cond) ? cond : [cond];
      parts.push(and(list.map((c) => evalWhere(row, c as Record<string, unknown>))));
    } else if (key === "OR") {
      parts.push(or((cond as Array<Record<string, unknown>>).map((c) => evalWhere(row, c))));
    } else if (key === "NOT") {
      parts.push(
        Array.isArray(cond)
          ? and(cond.map((c) => not(evalWhere(row, c as Record<string, unknown>))))
          : not(evalWhere(row, cond as Record<string, unknown>)),
      );
    } else if (key === "batchJob") {
      /// Prisma 的 to-one 关系过滤生成 LEFT JOIN + 「j.id IS NOT NULL」：
      /// 没有批次的行整段为 false（不是 unknown）。
      const relation = row.batchJob as Row | null;
      const inner = (cond as { is?: Record<string, unknown> | null }).is;
      if (inner === null) parts.push(relation === null);
      else parts.push(relation ? evalWhere(relation, inner ?? {}) : false);
    } else {
      parts.push(evalField(row[key], cond));
    }
  }
  return and(parts);
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

function installInMemoryVideoJobs(t: TestContext, rows: Row[]) {
  const reconciled: string[] = [];
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findMany: async (args: { where: Record<string, unknown>; take?: number }) =>
      rows
        .filter((row) => evalWhere(row, args.where) === true)
        .slice(0, args.take ?? rows.length)
        .map((row) => ({ ...row })),
    updateMany: async (args: { where: Record<string, unknown>; data: Row }) => {
      let count = 0;
      for (const row of rows) {
        if (evalWhere(row, args.where) !== true) continue;
        Object.assign(row, args.data);
        count += 1;
      }
      return { count };
    },
    /// reconcileVideoJob 的第一步：返回 null 让它立即结束，只记录「先问了供应商」。
    findUnique: async (args: { where: { id: string } }) => {
      reconciled.push(args.where.id);
      return null;
    },
  });
  patch(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: async () => [],
  });
  patch(t, db.videoBrief as unknown as Record<string, unknown>, {
    findMany: async () => [],
  });
  return reconciled;
}

const NOW = new Date("2026-10-26T12:00:00.000Z");
const minutesAgo = (min: number, from = NOW) => new Date(from.getTime() - min * 60_000);

function batchRow(overrides: Row): Row {
  return {
    videoBriefId: null,
    batchJobId: "batch-13h",
    batchJob: { status: BatchJobStatus.RUNNING },
    status: VideoJobStatus.QUEUED,
    submissionState: ProviderSubmissionState.NOT_STARTED,
    externalJobId: null,
    timeoutAt: null,
    dispatchQuarantineDecision: null,
    createdAt: minutesAgo(13 * 60),
    ...overrides,
  };
}

test("2.1 回归：13 小时前的批次「重试全部」后，第 2、3 波 60 分钟内不被杀、已提交行先对账", async (t) => {
  const retriedAt = minutesAgo(50);
  const rows: Row[] = [
    /// 第 1 波：重试后已领取并提交，渲染 deadline 已过宽限 → 必须先问供应商
    batchRow({
      id: "wave1-submitted",
      status: VideoJobStatus.RUNNING,
      submissionState: ProviderSubmissionState.ACCEPTED,
      externalJobId: "shuyu-ext-wave1",
      timeoutAt: minutesAgo(15),
      availableAt: retriedAt,
    }),
    /// 第 2、3 波：重试后仍在排队等槽位
    batchRow({ id: "wave2-queued", availableAt: retriedAt }),
    batchRow({ id: "wave3-queued", availableAt: retriedAt }),
  ];
  const reconciled = installInMemoryVideoJobs(t, rows);

  for (const at of [NOW, new Date(NOW.getTime() + 30 * 60_000), new Date(NOW.getTime() + 59 * 60_000)]) {
    const result = await sweepStuckTasks(at);
    assert.deepEqual(result.timedOutJobs, [], `重试后的行在 ${at.toISOString()} 不得被判死`);
    assert.deepEqual(result.reconciledJobs, ["wave1-submitted"]);
  }

  assert.equal(rows[0].status, VideoJobStatus.RUNNING, "已提交的付费任务交给对账，不盲判失败");
  assert.equal(rows[1].status, VideoJobStatus.QUEUED);
  assert.equal(rows[2].status, VideoJobStatus.QUEUED);
  assert.deepEqual(
    [...new Set(reconciled)],
    ["wave1-submitted"],
    "已提交行判死前先问供应商真实状态",
  );
});

test("2.1：没有被重试过的排队行仍受绝对上限兜底（按这一轮起点计时，不是放行）", async (t) => {
  const rows: Row[] = [
    /// 建批次时就写了 availableAt，从来没有被重试刷新过
    batchRow({ id: "never-retried", availableAt: minutesAgo(13 * 60) }),
    /// 历史行没有 availableAt：回落到 createdAt，同样越过上限
    batchRow({ id: "legacy-null-available", availableAt: null }),
    /// 重试过、但重试本身也已超过 12 小时
    batchRow({
      id: "retried-long-ago",
      createdAt: minutesAgo(30 * 60),
      availableAt: minutesAgo(13 * 60),
    }),
  ];
  installInMemoryVideoJobs(t, rows);

  const result = await sweepStuckTasks(NOW);

  assert.deepEqual(
    [...result.timedOutJobs].sort(),
    ["legacy-null-available", "never-retried", "retried-long-ago"],
  );
  for (const row of rows) {
    assert.equal(row.status, VideoJobStatus.FAILED);
    assert.match(String(row.errorMessage), /absolute lifetime cap/);
  }
});

test("2.1：已提交但这一轮也越过绝对上限的任务无条件失败化，不再花一次供应商查询", async (t) => {
  const rows: Row[] = [
    batchRow({
      id: "submitted-ancient-round",
      status: VideoJobStatus.RUNNING,
      submissionState: ProviderSubmissionState.ACCEPTED,
      externalJobId: "shuyu-ext-old",
      timeoutAt: minutesAgo(12 * 60),
      availableAt: minutesAgo(13 * 60),
    }),
  ];
  const reconciled = installInMemoryVideoJobs(t, rows);

  const result = await sweepStuckTasks(NOW);

  assert.deepEqual(result.timedOutJobs, ["submitted-ancient-round"]);
  assert.deepEqual(reconciled, []);
  assert.match(String(rows[0].errorMessage), /absolute lifetime cap/);
});

test("2.1：单条任务不写 availableAt，按 createdAt 兜底照旧（NOT 豁免对它们确定为 true）", async (t) => {
  const rows: Row[] = [
    {
      id: "single-stale",
      videoBriefId: null,
      batchJobId: null,
      batchJob: null,
      status: VideoJobStatus.QUEUED,
      submissionState: ProviderSubmissionState.NOT_STARTED,
      externalJobId: null,
      timeoutAt: null,
      availableAt: null,
      dispatchQuarantineDecision: null,
      createdAt: minutesAgo(120),
    },
    {
      id: "single-fresh",
      videoBriefId: null,
      batchJobId: null,
      batchJob: null,
      status: VideoJobStatus.RUNNING,
      submissionState: ProviderSubmissionState.NOT_STARTED,
      externalJobId: null,
      timeoutAt: null,
      availableAt: null,
      dispatchQuarantineDecision: null,
      createdAt: minutesAgo(30),
    },
  ];
  installInMemoryVideoJobs(t, rows);

  const result = await sweepStuckTasks(NOW);

  assert.deepEqual(result.timedOutJobs, ["single-stale"]);
  assert.equal(rows[1].status, VideoJobStatus.RUNNING);
});

test("2.1：读取之后被重试刷新过的行，CAS 按 availableAt 落空，不按旧钟判死", async (t) => {
  const row = batchRow({ id: "raced-retry", availableAt: minutesAgo(13 * 60) });
  const rows: Row[] = [row];
  installInMemoryVideoJobs(t, rows);
  /// 模拟：清扫读到旧行之后、写入之前，用户点了重试（availableAt 刷新为当下）
  const videoJob = db.videoJob as unknown as Record<string, unknown>;
  const originalFindMany = videoJob.findMany as (args: unknown) => Promise<Row[]>;
  patch(t, videoJob, {
    findMany: async (args: unknown) => {
      const read = await originalFindMany(args);
      row.availableAt = NOW;
      return read;
    },
  });

  const result = await sweepStuckTasks(NOW);

  assert.deepEqual(result.timedOutJobs, []);
  assert.equal(row.status, VideoJobStatus.QUEUED);
});

test("2.1：排队豁免的每个分支都对 NULL 确定取值（套进 NOT 之后不会变成 unknown）", () => {
  const exemption = sweepTest.activeBatchQueueWhere(minutesAgo(720)) as Record<string, unknown>;
  const nullAvailable = batchRow({ id: "x", availableAt: null, createdAt: minutesAgo(60) });
  const oldNullAvailable = batchRow({ id: "y", availableAt: null, createdAt: minutesAgo(13 * 60) });
  const single = { ...nullAvailable, batchJobId: null, batchJob: null };
  assert.equal(evalWhere(nullAvailable, exemption), true);
  assert.equal(evalWhere(oldNullAvailable, exemption), false);
  assert.equal(evalWhere(single, exemption), false);
});
