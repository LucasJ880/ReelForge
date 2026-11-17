import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPollVideosHandler } from "../src/app/api/cron/poll-videos/route";

/**
 * poll-videos 每分钟一轮：出片轮询 + 故事板轮询并排跑，清扫在尾部。
 * 2026-11-16 收尾：产品图任务与图文帖配图两个轮询删了（页面已删，生产库里没有在途任务）。
 */

type Handler = (req: Request) => Promise<Response>;

function handlerWith(overrides: Record<string, unknown>, calls: string[]): Handler {
  const factory = createPollVideosHandler as unknown as (deps: Record<string, unknown>) => Handler;
  return factory({
    machineAuthFailure: () => null,
    startSchedulerHeartbeat: () => ({
      finish: (status: string, details: Record<string, unknown>) => ({ status, details }),
    }),
    pollRunningJobs: async () => {
      calls.push("video");
      return { polled: 3 };
    },
    pollPendingStoryboardRuns: async () => {
      calls.push("storyboard");
      return 2;
    },
    sweepStuckTasks: async () => {
      calls.push("sweep");
      return { swept: 2 };
    },
    ...overrides,
  });
}

test("cron 只跑出片、故事板、清扫三件事；响应与心跳里没有已删的产品图 / 图文配图字段", async () => {
  const calls: string[] = [];
  const response = await handlerWith({}, calls)(new Request("http://localhost/api/cron/poll-videos"));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.sort(), ["storyboard", "sweep", "video"]);
  const body = await response.json();
  assert.equal(body.polled, 3);
  assert.equal(body.degraded, false);
  assert.equal(body.storyboardError, null);
  assert.deepEqual(body.sweep, { swept: 2 });
  for (const gone of ["imagePolled", "imageRecovered", "imageError", "contentPostPolled", "contentPostError"]) {
    assert.equal(gone in body, false, `${gone} 随轮询一起删了`);
  }
  assert.deepEqual(body.heartbeat, {
    status: "ok",
    details: { polled: 3, storyboardPolled: 2, sweepCompleted: true },
  });
});

test("故事板轮询出错不拖垮整轮：出片与清扫照常完成，整轮记 degraded", async () => {
  const calls: string[] = [];
  const response = await handlerWith(
    {
      pollPendingStoryboardRuns: async () => {
        calls.push("storyboard");
        throw new Error("storyboard down");
      },
    },
    calls,
  )(new Request("http://localhost/api/cron/poll-videos"));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.sort(), ["storyboard", "sweep", "video"]);
  const body = await response.json();
  assert.equal(body.polled, 3);
  assert.equal(body.degraded, true);
  assert.match(body.storyboardError, /storyboard down/);
  assert.equal(body.heartbeat.status, "degraded");
  assert.equal(body.heartbeat.details.storyboardPolled, 0);
});

test("出片轮询本身出错是 500，清扫照跑", async () => {
  const calls: string[] = [];
  const response = await handlerWith(
    {
      pollRunningJobs: async () => {
        throw new Error("video down");
      },
    },
    calls,
  )(new Request("http://localhost/api/cron/poll-videos"));
  assert.equal(response.status, 500);
  assert.ok(calls.includes("sweep"));
  const body = await response.json();
  assert.match(body.error, /video down/);
  assert.equal(body.heartbeat.status, "error");
});

test("守门：cron 不再引用已删的产品图 / 图文出图服务", () => {
  const source = readFileSync("src/app/api/cron/poll-videos/route.ts", "utf8");
  assert.doesNotMatch(source, /product-image-service|content-post-image-job-service/);
  assert.doesNotMatch(source, /pollPendingProductImageJobs|pollPendingContentPostRenders/);
});
