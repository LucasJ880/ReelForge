import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/// 强制 mock 模式 + 0 延迟；必须在 import seedance 之前 set，因为模块顶层会读 env
process.env.VIDEO_ENGINE_MOCK = "true";
process.env.VIDEO_ENGINE_MOCK_LATENCY_MS = "0";
delete process.env.BLOB_READ_WRITE_TOKEN; /// 强制 file:// fallback，避免依赖远端

/// 检测 ffmpeg 是否可用；不可用时跳过 ffmpeg 渲染相关断言
async function ffmpegPresent(): Promise<boolean> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile("ffmpeg", ["-version"], (err) => resolve(!err));
  });
}

test("seedance mock: submitSeedanceJob 透传 mockHints + getSeedanceStatus 完成时返回真 MP4 URL（非 Big Buck Bunny）", async (t) => {
  const hasFfmpeg = await ffmpegPresent();
  if (!hasFfmpeg) {
    t.skip("ffmpeg 不可用，跳过 mock seedance 集成测试（CI 上需要 apt install ffmpeg）");
    return;
  }
  const { submitSeedanceJob, getSeedanceStatus } = await import(
    "../src/lib/providers/seedance"
  );

  const submission = await submitSeedanceJob({
    prompt: "Hook: morning trail run with hydration bottle",
    duration: 4,
    ratio: "9:16",
    mockHints: {
      briefId: "test-brief",
      segmentIndex: 0,
      segmentCount: 3,
      durationSec: 4,
      aspectRatio: "9:16",
      purpose: "hook",
    },
  });

  assert.ok(submission.jobId.startsWith("mock_"), "mock jobId 应以 mock_ 前缀");

  const result = await getSeedanceStatus(submission.jobId);
  assert.equal(result.status, "completed");
  assert.ok(result.videoUrl, "completed 时应有 videoUrl");

  /// Phase 2 强约束：绝不再返回远程 sample-videos.com / Big Buck Bunny
  assert.ok(
    !/sample-videos\.com|big_buck_bunny/i.test(result.videoUrl ?? ""),
    `Phase 2 必须摆脱远程 sample URL，但拿到了：${result.videoUrl}`,
  );

  /// 没有 BLOB token 时应是 file:// URL，且文件应实际存在
  assert.ok(
    result.videoUrl?.startsWith("file://"),
    `无 Blob token 时应返回 file://，实际：${result.videoUrl}`,
  );
  const localPath = fileURLToPath(result.videoUrl!);
  assert.ok(existsSync(localPath), `mock clip 文件应实际存在：${localPath}`);
});

test("seedance mock: 不同 segmentIndex 产生不同 cache key → 不同文件", async (t) => {
  const hasFfmpeg = await ffmpegPresent();
  if (!hasFfmpeg) {
    t.skip("ffmpeg 不可用，跳过");
    return;
  }
  const { submitSeedanceJob, getSeedanceStatus } = await import(
    "../src/lib/providers/seedance"
  );
  const r0 = await submitSeedanceJob({
    prompt: "seg 0",
    duration: 4,
    ratio: "9:16",
    mockHints: {
      briefId: "test-brief-distinct",
      segmentIndex: 0,
      segmentCount: 2,
      durationSec: 4,
      aspectRatio: "9:16",
    },
  });
  const r1 = await submitSeedanceJob({
    prompt: "seg 1",
    duration: 4,
    ratio: "9:16",
    mockHints: {
      briefId: "test-brief-distinct",
      segmentIndex: 1,
      segmentCount: 2,
      durationSec: 4,
      aspectRatio: "9:16",
    },
  });
  const s0 = await getSeedanceStatus(r0.jobId);
  const s1 = await getSeedanceStatus(r1.jobId);
  assert.equal(s0.status, "completed");
  assert.equal(s1.status, "completed");
  assert.notEqual(
    s0.videoUrl,
    s1.videoUrl,
    "不同段索引必须落到不同 mock clip 文件",
  );
});

test("seedance mock: 缺失 mockHints 也不会 fall back to Bunny URL", async (t) => {
  const hasFfmpeg = await ffmpegPresent();
  if (!hasFfmpeg) {
    t.skip("ffmpeg 不可用，跳过");
    return;
  }
  const { submitSeedanceJob, getSeedanceStatus } = await import(
    "../src/lib/providers/seedance"
  );
  /// 旧调用方没填 mockHints —— 应该用 fallbackHints 兜底而不是远程 sample URL
  const sub = await submitSeedanceJob({
    prompt: "no hints submission",
    duration: 5,
    ratio: "9:16",
  });
  const r = await getSeedanceStatus(sub.jobId);
  assert.equal(r.status, "completed");
  assert.ok(
    !/sample-videos\.com|big_buck_bunny/i.test(r.videoUrl ?? ""),
    `缺少 mockHints 时也不能 fall back 到远程：${r.videoUrl}`,
  );
});
