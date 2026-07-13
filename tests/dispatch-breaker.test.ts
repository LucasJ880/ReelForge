import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { VideoJobStatus } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  BREAKER_USER_MESSAGE,
  evaluateDispatchBreaker,
} from "../src/lib/services/dispatch-breaker";
import { WATCHDOG_STALLED_PREFIX, WATCHDOG_TIMEOUT_PREFIX } from "../src/lib/services/video-watchdog";

/**
 * AC-7 —— dispatch 入口熔断测试。
 *
 * 连续僵死任务触发熔断（open，拒绝）；无在飞任务时半开放行 1 个探测；
 * 探测成功（窗口内出现成功样本）→ 僵死率回落 → closed 恢复。
 * DB monkey-patch，零真实查询。
 */

const NOW = new Date("2026-07-13T02:00:00Z");

type SampleJob = { status: VideoJobStatus; errorMessage: string | null };

function stalledJob(): SampleJob {
  return {
    status: VideoJobStatus.FAILED,
    errorMessage: `${WATCHDOG_STALLED_PREFIX} provider 僵死`,
  };
}
function timedOutJob(): SampleJob {
  return {
    status: VideoJobStatus.FAILED,
    errorMessage: `${WATCHDOG_TIMEOUT_PREFIX} 超过 deadline`,
  };
}
function succeededJob(): SampleJob {
  return { status: VideoJobStatus.SUCCEEDED, errorMessage: null };
}
function inflightJob(): SampleJob {
  return { status: VideoJobStatus.RUNNING, errorMessage: null };
}
function normalFailedJob(): SampleJob {
  return {
    status: VideoJobStatus.FAILED,
    errorMessage: "画面质检未通过",
  };
}

function installSample(t: TestContext, jobs: SampleJob[]) {
  const model = db.videoJob as unknown as Record<string, unknown>;
  const original = model.findMany;
  model.findMany = async () => jobs;
  t.after(() => {
    model.findMany = original;
  });
}

test("AC-7 熔断：窗口内 3 条僵死 + 有在飞任务 → open，dispatch 被拒", async (t) => {
  installSample(t, [stalledJob(), stalledJob(), timedOutJob(), inflightJob()]);
  const d = await evaluateDispatchBreaker(NOW);
  assert.equal(d.state, "open");
  assert.equal(d.allowed, false);
  assert.equal(d.sample.stalled, 3);
  assert.equal(d.sample.inflight, 1);
});

test("AC-7 熔断：open 但无任何在飞任务 → half_open_probe，恰好放行探测", async (t) => {
  installSample(t, [stalledJob(), stalledJob(), stalledJob()]);
  const d = await evaluateDispatchBreaker(NOW);
  assert.equal(d.state, "half_open_probe");
  assert.equal(d.allowed, true);
});

test("AC-7 熔断：探测任务成功后僵死率回落 → closed 恢复", async (t) => {
  /// 3 僵死 + 1 成功（探测）→ stallRate 3/4 = 0.75 < 0.8 → closed
  installSample(t, [stalledJob(), stalledJob(), stalledJob(), succeededJob()]);
  const d = await evaluateDispatchBreaker(NOW);
  assert.equal(d.state, "closed");
  assert.equal(d.allowed, true);
});

test("AC-7 熔断：样本不足（< 3 终态）不触发，避免冷启动误拒", async (t) => {
  installSample(t, [stalledJob(), stalledJob()]);
  const d = await evaluateDispatchBreaker(NOW);
  assert.equal(d.state, "closed");
  assert.equal(d.allowed, true);
});

test("AC-7 熔断：普通失败（非僵死/超时）不计入僵死率", async (t) => {
  installSample(t, [
    normalFailedJob(),
    normalFailedJob(),
    normalFailedJob(),
    normalFailedJob(),
  ]);
  const d = await evaluateDispatchBreaker(NOW);
  assert.equal(d.state, "closed");
  assert.equal(d.sample.stalled, 0);
});

test("AC-7 熔断：sweep 时代旧超时前缀同样计入僵死样本", async (t) => {
  installSample(t, [
    { status: VideoJobStatus.FAILED, errorMessage: "sweep: job timed out (timeoutAt + 10min grace)" },
    stalledJob(),
    stalledJob(),
    inflightJob(),
  ]);
  const d = await evaluateDispatchBreaker(NOW);
  assert.equal(d.state, "open");
  assert.equal(d.sample.stalled, 3);
});

test("AC-7 熔断：DISPATCH_BREAKER_ENABLED=false 显式关闭", async (t) => {
  installSample(t, [stalledJob(), stalledJob(), stalledJob(), inflightJob()]);
  process.env.DISPATCH_BREAKER_ENABLED = "false";
  t.after(() => {
    delete process.env.DISPATCH_BREAKER_ENABLED;
  });
  const d = await evaluateDispatchBreaker(NOW);
  assert.equal(d.allowed, true);
});

test("AC-7 熔断：拒绝文案是用户可见的人话（不含内部术语）", async () => {
  const { containsBannedPersonalTerm } = await import(
    "../src/lib/video-generation/personal-status"
  );
  assert.equal(containsBannedPersonalTerm(BREAKER_USER_MESSAGE), false);
});
