import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../src/lib/db";
import { MIN_SAMPLE, videoFirstPassRate } from "../src/lib/services/first-pass-rate-service";

/**
 * P01-F0 · 一次通过率口径（计划 §3 链 M）：
 *   - 成片后点名重做的候选行（replacesJobId 非空）不进样本——它不是首次生成；
 *   - 被重做替换的旧行（supersededAt 非空）留在样本里但不算通过；
 *   - 帧质检按上限放行的 WOULD_BLOCK 不算通过，而未质检（null）的照常算；
 *   - 口径必须先于 P05-C（段重做）上线，否则重做会把北极星拉偏。
 * 只打桩记录 where，不连数据库。
 */

type Calls = Record<string, unknown[]>;

function stubCount(t: TestContext, calls: Calls, impl: (args: unknown) => number) {
  const target = (db as unknown as { videoJob: Record<string, unknown> }).videoJob;
  const original = target.count;
  target.count = async (args: unknown) => {
    (calls["videoJob.count"] ??= []).push(args);
    return impl(args);
  };
  t.after(() => {
    target.count = original;
  });
}

type Where = Record<string, unknown> & { AND?: unknown[] };

function whereOf(call: unknown): Where {
  return (call as { where: Where }).where;
}

test("样本排除重做候选行；通过数排除被替换旧行与 WOULD_BLOCK，但放行未质检（null）", async (t) => {
  const calls: Calls = {};
  stubCount(t, calls, (args) => (whereOf(args).supersededAt === null ? 6 : MIN_SAMPLE));

  const rate = await videoFirstPassRate({});

  const [sampleCall, passedCall] = calls["videoJob.count"];
  const sample = whereOf(sampleCall);
  const passed = whereOf(passedCall);

  assert.equal(sample.replacesJobId, null, "样本：候选行（replacesJobId 非空）不进样本");
  assert.ok(!("supersededAt" in sample), "样本：被替换的旧行仍在样本里");
  assert.deepEqual(sample.status, { in: ["SUCCEEDED", "FAILED"] });

  assert.equal(passed.replacesJobId, null);
  assert.equal(passed.supersededAt, null, "通过：被替换的旧行不算通过");
  assert.equal(passed.status, "SUCCEEDED");
  assert.equal(passed.retryCount, 0);
  assert.deepEqual(passed.submitAttempts, { lte: 1 });

  /// notExperimentVideoJobWhere() 自己也是一个 OR（batchJobId null / batchJob 前缀），要按内容找
  const wouldBlockClause = (passed.AND ?? []).find((clause) => {
    const or = (clause as { OR?: unknown[] } | null)?.OR;
    return Array.isArray(or) && or.some((item) => typeof item === "object" && item !== null && "frameQaStatus" in item);
  }) as { OR: unknown[] } | undefined;
  assert.ok(wouldBlockClause, "通过：必须带 WOULD_BLOCK 的排除子句");
  assert.deepEqual(wouldBlockClause.OR, [
    { frameQaStatus: null },
    { frameQaStatus: { not: "WOULD_BLOCK" } },
  ]);

  assert.deepEqual(rate, { sample: MIN_SAMPLE, passed: 6, rate: 0.6 });
});

test("实验批次排除子句在样本与通过两边都保留", async (t) => {
  const calls: Calls = {};
  stubCount(t, calls, () => 0);
  await videoFirstPassRate({ userId: "operator" });
  for (const call of calls["videoJob.count"]) {
    const where = whereOf(call);
    const text = JSON.stringify(where.AND ?? []);
    assert.match(text, /exp-2611-/u, "每条 count 都要带实验批次排除");
    assert.deepEqual(where.batchJob, { is: { userId: "operator" } });
  }
});
