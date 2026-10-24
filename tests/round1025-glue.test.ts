import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/// 1025 并行工作流合入后的跨流胶水：任何一处被改回去都会重新漏钱或卡死。

test("批次取消联动取消挂在任务上的故事板（只传真正被取消的任务）", async () => {
  const batch = await readFile("src/lib/services/batch-service.ts", "utf8");
  const cancel = batch.slice(batch.indexOf("export async function cancelPendingBatchJobs"));
  const body = cancel.slice(0, cancel.indexOf("\n}\n"));
  assert.match(body, /cancelStoryboardRunsForVideoJobs\(/);
  assert.match(body, /status: VideoJobStatus\.CANCELLED/);
  assert.match(body, /id: \{ in: pendingIds \}/);
});

test("批量故事板重出帧与推进只针对仍在排队 / 暂停的任务", async () => {
  const batch = await readFile("src/lib/services/batch-service.ts", "utf8");
  for (const name of ["async function retryRecoverableBatchFrames", "async function advanceBatchStoryboards"]) {
    const fn = batch.slice(batch.indexOf(name), batch.indexOf(name) + 1200);
    assert.match(fn, /status: \{ in: \[VideoJobStatus\.QUEUED, VideoJobStatus\.PAUSED\] \}/, name);
  }
});

test("账号停用后真取消其故事板，且放在停用事务之外", async () => {
  const disable = await readFile("src/lib/services/account-disable-service.ts", "utf8");
  const call = disable.indexOf("cancelActiveStoryboardRunsForUser(result.userId)");
  assert.ok(call > 0);
  assert.ok(call > disable.indexOf("forgetAccountStatus(result.userId)"));
});

test("故事板轮询跳过停用账号的新出帧，但已取消轮次仍收回已付费的帧", async () => {
  const storyboard = await readFile("src/lib/video-generation/storyboard-service.ts", "utf8");
  const poll = storyboard.slice(storyboard.indexOf("export async function pollPendingStoryboardRuns"));
  const where = poll.slice(0, poll.indexOf("orderBy"));
  assert.match(where, /status: StoryboardRunStatus\.GENERATING, owner: \{ disabledAt: null \}/);
  assert.match(where, /status: StoryboardRunStatus\.FAILED,\n\s+owner: \{ disabledAt: null \}/);
  const cancelledBranch = where.slice(where.indexOf("status: StoryboardRunStatus.CANCELLED"));
  assert.doesNotMatch(cancelledBranch, /disabledAt/);
});
