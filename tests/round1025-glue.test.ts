import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/// 1025 并行工作流合入后的跨流胶水：任何一处被改回去都会重新漏钱或卡死。

test("故事板轮询跳过停用账号的新出帧，但已取消轮次仍收回已付费的帧", async () => {
  const storyboard = await readFile("src/lib/video-generation/storyboard-service.ts", "utf8");
  const poll = storyboard.slice(storyboard.indexOf("export async function pollPendingStoryboardRuns"));
  const where = poll.slice(0, poll.indexOf("orderBy"));
  assert.match(where, /status: StoryboardRunStatus\.GENERATING, owner: \{ disabledAt: null \}/);
  assert.match(where, /status: StoryboardRunStatus\.FAILED,\n\s+owner: \{ disabledAt: null \}/);
  const cancelledBranch = where.slice(where.indexOf("status: StoryboardRunStatus.CANCELLED"));
  assert.doesNotMatch(cancelledBranch, /disabledAt/);
});
