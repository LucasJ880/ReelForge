import assert from "node:assert/strict";
import test from "node:test";
import { FinalVideoStatus, VideoBriefStatus, VideoJobStatus } from "@prisma/client";
import {
  deriveBusinessStatus,
  summarizeRunningJobs,
} from "../src/lib/video-generation/business-status";

/**
 * INV-5 —— 进度真实性升级（2026-07 卡死事故的「单段恒 20%」问题）。
 *
 * - provider 真实 progress 优先
 * - 拿不到真实值时按运行时长估算，且估算随时间/轮询推进（非恒定值）
 * - 段内估算封顶，不到 100%（真实完成信号才能推满）
 * - 新字段缺失时保持旧公式（不破坏既有 progress-truthfulness 断言）
 * - INV-4：未知 briefStatus → failed，不显示「生成中」
 */

const MIN = 60_000;
const NOW = new Date("2026-07-13T02:00:00Z");

const singleRunning = {
  briefStatus: VideoBriefStatus.RENDERING,
  finalVideoStatus: FinalVideoStatus.PENDING,
  segmentsSucceeded: 0,
  segmentsTotal: 1,
  jobStatuses: [VideoJobStatus.RUNNING],
};

test("INV-5：provider 真实 progress 优先于估算", () => {
  const real = deriveBusinessStatus({
    ...singleRunning,
    runningProviderProgress: 60,
    runningElapsedMs: 1 * MIN,
  });
  const estimatedOnly = deriveBusinessStatus({
    ...singleRunning,
    runningProviderProgress: null,
    runningElapsedMs: 1 * MIN,
  });
  assert.equal(real.status, "generating");
  /// 真实 60% > 1 分钟的估算值 → 真实值生效
  assert.ok(real.progressHint > estimatedOnly.progressHint);
  assert.equal(real.progressHint, 0.2 + 0.6 * 0.6);
});

test("INV-5：单段视频进度不再恒 20% —— 估算随运行时长推进", () => {
  const at0 = deriveBusinessStatus({ ...singleRunning, runningElapsedMs: 0 });
  const at2 = deriveBusinessStatus({ ...singleRunning, runningElapsedMs: 2 * MIN });
  const at4 = deriveBusinessStatus({ ...singleRunning, runningElapsedMs: 4 * MIN });
  assert.equal(at0.progressHint, 0.2, "起点 20%");
  assert.ok(at2.progressHint > at0.progressHint, "2 分钟 > 0 分钟");
  assert.ok(at4.progressHint > at2.progressHint, "4 分钟 > 2 分钟（每次轮询都在推进）");
});

test("INV-5：段内估算封顶（永远到不了段完成值，真实信号才推满）", () => {
  const longRunning = deriveBusinessStatus({
    ...singleRunning,
    runningElapsedMs: 120 * MIN,
  });
  const done = deriveBusinessStatus({
    ...singleRunning,
    segmentsSucceeded: 1,
    jobStatuses: [VideoJobStatus.SUCCEEDED],
  });
  assert.ok(longRunning.progressHint < 0.8, "估算封顶必须低于段完成值 0.8");
  assert.ok(done.status === "assembling" || done.progressHint >= 0.8);
});

test("INV-5：多段流进度单调 —— 段完成信号永远高于前一段的任何估算", () => {
  const seg0LongEstimate = deriveBusinessStatus({
    ...singleRunning,
    segmentsTotal: 2,
    runningElapsedMs: 120 * MIN,
  });
  const seg1JustStarted = deriveBusinessStatus({
    ...singleRunning,
    segmentsTotal: 2,
    segmentsSucceeded: 1,
    runningElapsedMs: 0,
  });
  assert.ok(
    seg1JustStarted.progressHint > seg0LongEstimate.progressHint,
    "段推进不允许进度回退（无状态回退）",
  );
});

test("INV-5：新字段缺失时保持旧的段数插值公式（向后兼容）", () => {
  const legacy = deriveBusinessStatus({
    briefStatus: null,
    finalVideoStatus: FinalVideoStatus.PENDING,
    segmentsSucceeded: 2,
    segmentsTotal: 4,
    jobStatuses: [VideoJobStatus.RUNNING],
  });
  assert.equal(legacy.progressHint, 0.2 + 0.6 * 0.5);
});

test("INV-4：未知 briefStatus → failed（绝不 fallback 成生成中）", () => {
  const r = deriveBusinessStatus({
    briefStatus: "SOME_FUTURE_STATUS" as unknown as VideoBriefStatus,
  });
  assert.equal(r.status, "failed");
  assert.ok(r.cta, "未知状态必须给用户重试入口");
});

test("INV-4：briefStatus 为空（订单尚未创建 brief）仍是 planning，不误报失败", () => {
  const r = deriveBusinessStatus({});
  assert.equal(r.status, "planning");
});

/// ---------- summarizeRunningJobs 页面辅助 ----------

test("summarizeRunningJobs：取在飞段的最大真实进度 + 最早提交时长", () => {
  const out = summarizeRunningJobs(
    [
      {
        status: VideoJobStatus.RUNNING,
        lastProgress: 30,
        submittedAt: new Date(NOW.getTime() - 5 * MIN),
      },
      {
        status: VideoJobStatus.RUNNING,
        lastProgress: 55,
        submittedAt: new Date(NOW.getTime() - 3 * MIN),
      },
      {
        status: VideoJobStatus.SUCCEEDED,
        lastProgress: 100,
        submittedAt: new Date(NOW.getTime() - 30 * MIN),
      },
    ],
    NOW,
  );
  assert.equal(out.runningProviderProgress, 55, "只统计在飞段，取最大");
  assert.equal(out.runningElapsedMs, 5 * MIN, "取最早在飞段的运行时长");
});

test("summarizeRunningJobs：无在飞段时两个信号都为 null", () => {
  const out = summarizeRunningJobs(
    [{ status: VideoJobStatus.SUCCEEDED, lastProgress: 100, submittedAt: NOW }],
    NOW,
  );
  assert.equal(out.runningProviderProgress, null);
  assert.equal(out.runningElapsedMs, null);
});

test("summarizeRunningJobs：provider 未上报 progress（null/0）→ 真实进度信号为 null", () => {
  const out = summarizeRunningJobs(
    [
      {
        status: VideoJobStatus.RUNNING,
        lastProgress: null,
        submittedAt: new Date(NOW.getTime() - 2 * MIN),
      },
    ],
    NOW,
  );
  assert.equal(out.runningProviderProgress, null);
  assert.equal(out.runningElapsedMs, 2 * MIN);
});
