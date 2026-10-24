import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { VideoJobStatus } from "@prisma/client";
import { db } from "../src/lib/db";
import { CRON_BATCH_TICK_LIMIT, selectCronBatchIds } from "../src/lib/services/batch-service";

/**
 * runtime LENS-5：有人盯着的批次不能被 cron 饿死。
 *
 * 详情页每 15s 一次 processBatchTick（租约抢放、计数同步）都会刷新 BatchJob.updatedAt；
 * cron 只按 updatedAt 升序取 20 个时，活跃批次超过 20 个后这个批次永远排不进去，
 * 而「供应商已完成」的段在用户面 tick 里只 defer、等 cron 质检——一直停在「生成中」。
 * 内存桩，不连数据库。
 */

type Batch = { id: string; updatedAt: Date };
type Job = { batchJobId: string; status: VideoJobStatus; externalJobId: string | null; lastCheckedAt: Date | null; createdAt: Date };

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const secondsAgo = (s: number) => new Date(NOW - s * 1000);

function install(t: TestContext, batches: Batch[], jobs: Job[]) {
  const calls: { job?: Record<string, unknown>; batch?: Record<string, unknown> } = {};
  const jobModel = db.videoJob as unknown as Record<string, unknown>;
  const batchModel = db.batchJob as unknown as Record<string, unknown>;
  const originals = { job: jobModel.findMany, batch: batchModel.findMany };
  jobModel.findMany = async (args: Record<string, unknown>) => {
    calls.job = args;
    return jobs
      .filter((job) => job.status === VideoJobStatus.RUNNING && job.externalJobId)
      .sort(
        (a, b) =>
          (a.lastCheckedAt?.getTime() ?? -Infinity) - (b.lastCheckedAt?.getTime() ?? -Infinity) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      )
      .slice(0, args.take as number)
      .map((job) => ({ batchJobId: job.batchJobId }));
  };
  batchModel.findMany = async (args: Record<string, unknown>) => {
    calls.batch = args;
    return [...batches]
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, args.take as number)
      .map((batch) => ({ id: batch.id }));
  };
  t.after(() => {
    jobModel.findMany = originals.job;
    batchModel.findMany = originals.batch;
  });
  return calls;
}

test("runtime LENS-5：活跃批次超过 20 个时，正被盯着（updatedAt 最新）但有段等着质检的批次仍被 cron 选中", async (t) => {
  /// 24 个没人看的批次：updatedAt 是 cron 上次推进的时刻
  const idle: Batch[] = Array.from({ length: 24 }, (_, i) => ({ id: `idle-${i}`, updatedAt: secondsAgo(600 - i) }));
  /// 被盯着的批次：15s 一次 tick，updatedAt 永远最新
  const watched: Batch = { id: "watched", updatedAt: secondsAgo(3) };
  const jobs: Job[] = [
    /// 它的一段供应商早已完成：用户面 tick 只 defer，不写 lastCheckedAt
    { batchJobId: "watched", status: VideoJobStatus.RUNNING, externalJobId: "ext-done", lastCheckedAt: secondsAgo(900), createdAt: secondsAgo(1800) },
    /// 别的批次里还在渲染的段：每次 tick 都刷新 lastCheckedAt
    ...idle.slice(0, 6).map((batch, i) => ({
      batchJobId: batch.id,
      status: VideoJobStatus.RUNNING,
      externalJobId: `ext-${i}`,
      lastCheckedAt: secondsAgo(60 + i),
      createdAt: secondsAgo(1200),
    })),
  ];
  const calls = install(t, [...idle, watched], jobs);

  const ids = await selectCronBatchIds();

  assert.equal(ids[0], "watched", "等着质检的批次排在最前，先拿到本次调用的质检预算");
  assert.ok(ids.length <= CRON_BATCH_TICK_LIMIT, "总数不变，函数时长不变长");
  assert.equal(new Set(ids).size, ids.length, "去重");
  assert.ok(ids.includes("idle-0"), "仍按 updatedAt 升序补满");

  /// 选段口径：已提交、仍在跑、按最久没被查过排序（从未查过的最前）
  const where = calls.job!.where as Record<string, unknown>;
  assert.equal(where.status, VideoJobStatus.RUNNING);
  assert.deepEqual(where.externalJobId, { not: null });
  assert.deepEqual((calls.job!.orderBy as unknown[])[0], { lastCheckedAt: { sort: "asc", nulls: "first" } });
  /// 两条查询筛的是同一组活跃批次
  assert.deepEqual((where.batchJob as { is: unknown }).is, calls.batch!.where);
});

test("runtime LENS-5：没有在跑的段时，选法退回此前的 updatedAt 升序前 20", async (t) => {
  const batches: Batch[] = Array.from({ length: 25 }, (_, i) => ({ id: `b-${i}`, updatedAt: secondsAgo(1000 - i) }));
  install(t, batches, []);

  const ids = await selectCronBatchIds();

  assert.deepEqual(ids, batches.slice(0, 20).map((batch) => batch.id));
});

test("runtime LENS-5：cron 路由用 selectCronBatchIds 选批次，并仍在质检预算上下文里跑", () => {
  const route = readFileSync("src/app/api/cron/process-batches/route.ts", "utf8");
  assert.match(route, /selectCronBatchIds\(\)/);
  assert.match(route, /runWithFrameQaBudget\(/);
  assert.doesNotMatch(route, /orderBy: \{ updatedAt: "asc" \}/, "选法不再只看 updatedAt");
});
