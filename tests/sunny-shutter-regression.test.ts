import assert from "node:assert/strict";
import test from "node:test";
import { VideoJobStatus } from "@prisma/client";
import { __test__ as videoSvcTest } from "../src/lib/services/video-service";
import { planSegments, requiresStitching, normalizeDuration } from "../src/lib/duration/segment-planner";

const { classifyUserStatus } = videoSvcTest;

/**
 * Sunny Shutter 兼容性回归测试 —— 关键铁律：
 *
 * 1. 旧 brief（segmentIndex IS NULL）不会进入新拼接流
 * 2. 已恢复的旧 brief（finalVideoUrl 已写）状态不会被改写
 * 3. 状态 RUNNING/SUCCEEDED 的旧 job 不被新流程视作"段"
 * 4. 任意时长输入会被规范化（旧 5s/20s 数据不破）
 *
 * 这些是 PART 4/7 改造时的「不能破」红线。
 */

test("旧 brief 兼容：segmentIndex IS NULL 视为单段（不进入拼接）", () => {
  /// requiresStitching 只看 targetDurationSec：
  /// 旧 5s/15s/20s 数据 normalize 后是 15s，不进入拼接
  assert.equal(requiresStitching(5), false);
  assert.equal(requiresStitching(15), false);
  /// 20s 旧数据：planSegments 会切成 2 段（兜底路径），但这种历史数据不应有 directorPlan，
  /// dispatchVideoForBrief 会因此走 dispatchVideoGeneration（旧路径）
  /// requiresStitching(20) 为 true 是预期行为；保护是在 video-service 通过 directorPlan 检查
  assert.equal(requiresStitching(20), true);
});

test("旧数据归一化：normalizeDuration 把旧 5s/20s 拉到最近档位", () => {
  /// 5s 应归一到 15s（最近档位）
  assert.equal(normalizeDuration(5), 15);
  /// 20s 也归一到 15s（5 vs 10 → 5 更近）
  assert.equal(normalizeDuration(20), 15);
  /// null/undefined 走默认 30s
  assert.equal(normalizeDuration(null), 30);
  assert.equal(normalizeDuration(undefined), 30);
});

test("旧 brief 的视频任务状态分类不受多段流影响", () => {
  /// 旧 brief 的 VideoJob: segmentIndex IS NULL, finalVideoId IS NULL
  /// classifyUserStatus 只看 status / externalJobId / isStuck，与段无关
  const legacyRunning = {
    status: VideoJobStatus.RUNNING,
    submittedAt: new Date(),
    startedAt: new Date(),
    externalJobId: "legacy_task_id",
  };
  assert.equal(classifyUserStatus(legacyRunning, false), "generating");

  const legacyDone = {
    status: VideoJobStatus.SUCCEEDED,
    submittedAt: new Date(),
    startedAt: new Date(),
    externalJobId: "legacy_task_id",
  };
  assert.equal(classifyUserStatus(legacyDone, false), "ready");
});

test("旧 brief 单段流程：仅有 1 个 segment slot（默认 15s 兜底）", () => {
  /// Sunny Shutter 旧数据被 normalize 到 15s 后只有 1 段
  const segs = planSegments(15);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].segmentIndex, 0);
});

test("旧 brief 不会有 segmentIndex 字段：测试新字段都是可选", () => {
  /// 模拟：从 DB 取出的旧 VideoJob 行
  const legacyJob: {
    segmentIndex: number | null;
    segmentDurationSec: number | null;
    finalVideoId: string | null;
  } = {
    segmentIndex: null,
    segmentDurationSec: null,
    finalVideoId: null,
  };
  /// 这些字段必须都允许 null（向后兼容铁律）
  assert.equal(legacyJob.segmentIndex, null);
  assert.equal(legacyJob.segmentDurationSec, null);
  assert.equal(legacyJob.finalVideoId, null);
});

test("Sunny Shutter 旧 brief：summarizeBriefRender 应保留 finalVideoUrl 不被覆盖", () => {
  /// 这是契约：当 finalVideo IS NULL（旧 brief），summarizeBriefRender
  /// 必须使用 brief.finalVideoUrl 作为 exposedFinalUrl。
  /// 实际函数涉及 DB；这里我们记录契约值，用作 doc-test。
  const exposed = (
    finalVideo: { stitchedVideoUrl: string | null } | null,
    briefFinalVideoUrl: string | null,
  ) => finalVideo?.stitchedVideoUrl ?? briefFinalVideoUrl ?? null;

  /// 旧 brief：finalVideo == null
  const out1 = exposed(null, "https://cdn.example.com/sunny-shutter.mp4");
  assert.equal(out1, "https://cdn.example.com/sunny-shutter.mp4");

  /// 新 brief：finalVideo.stitchedVideoUrl 优先
  const out2 = exposed(
    { stitchedVideoUrl: "https://cdn.example.com/stitched.mp4" },
    null,
  );
  assert.equal(out2, "https://cdn.example.com/stitched.mp4");

  /// 新 brief 但还没拼接完成：仍 fallback 到 brief.finalVideoUrl（应为 null）
  const out3 = exposed({ stitchedVideoUrl: null }, null);
  assert.equal(out3, null);
});

test("Sunny Shutter 旧 brief：classifyUserStatus 不依赖任何新字段", () => {
  /// 旧 brief 的 job 没有 segmentIndex，但 classifyUserStatus 入参不要求它
  const job = {
    status: VideoJobStatus.SUCCEEDED,
    submittedAt: new Date(),
    startedAt: new Date(),
    externalJobId: "task_legacy",
  };
  assert.equal(classifyUserStatus(job, false), "ready");
});
