import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../src/lib/db";
import { retryAckUnknownSingleStoryboardFrames } from "../src/lib/video-generation/storyboard-service";

/**
 * 1025：单条故事板「提交确认未知、无任务号」的帧，文案承诺系统自动重投，单条路径却没人重投。
 * 锁住查询边界：只救单条、未确认派发、未停用、30 分钟内刚失败、只重投一次的帧。
 */
function patch(t: TestContext, target: Record<string, unknown>, key: string, fn: unknown) {
  const original = target[key];
  target[key] = fn;
  t.after(() => { target[key] = original; });
}

test("查询边界：单条 + 30 分钟内 + 无任务号 + 首次尝试 + 未派发未停用", async (t) => {
  let where: Record<string, unknown> | null = null;
  const anyDb = db as unknown as Record<string, Record<string, unknown>>;
  patch(t, anyDb.storyboardFrame, "findMany", async (args: { where: Record<string, unknown> }) => { where = args.where; return []; });
  const now = new Date("2026-10-24T21:20:00.000Z");
  assert.equal(await retryAckUnknownSingleStoryboardFrames(5, now), 0);
  assert.ok(where);
  const w = where as Record<string, unknown>;
  assert.equal(w.submissionState, "ACK_UNKNOWN");
  assert.equal(w.externalTaskId, null);
  assert.deepEqual(w.attempt, { lt: 2 });
  assert.deepEqual(w.completedAt, { gte: new Date("2026-10-24T20:50:00.000Z") });
  const run = w.storyboardRun as Record<string, unknown>;
  assert.equal(run.purpose, "single-video-storyboard");
  assert.equal(run.videoBriefId, null);
  assert.equal(run.dispatchReservationKey, null);
  assert.deepEqual(run.owner, { disabledAt: null });
});
