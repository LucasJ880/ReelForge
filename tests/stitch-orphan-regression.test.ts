import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, VideoJobStatus } from "@prisma/client";
import {
  isEphemeralSignedUrl,
  stitchFinalVideo,
  __test__ as stitchTest,
} from "../src/lib/services/stitch-service";
import { db } from "../src/lib/db";

/**
 * 回归测试 —— 2026-07「正在合成最终视频 85% 永久卡死」孤儿任务 bug。
 *
 * 根因：生产环境（external runtime）下，带 unified assemblyPlan 的单段 brief
 * 被 stitchFinalVideo 打上「awaiting external stitcher」占位（unified 判定先于
 * 单段捷径），而外部 runner 的 claimStitchTask 又跳过 segmentCount<=1 → 死区。
 *
 * 附带修复：临时签名 URL（X-Tos-Expires 等，24h 失效）不允许直接被当作
 * stitchedVideoUrl 复用 —— 必须走真实 stitch 转存持久存储。
 *
 * 测试全部 monkey-patch Prisma model 方法，不触真实 DB / ffmpeg / Blob，
 * 且要求在 AIVORA_DRY_RUN=1 下运行（不会有任何计费调用）。
 */

const { AWAITING_EXTERNAL_STITCHER } = stitchTest;

function patchModel(
  t: TestContext,
  model: Record<string, unknown>,
  patches: Record<string, (...args: never[]) => unknown>,
) {
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = model[key];
    model[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) {
      model[key] = originals[key];
    }
  });
}

function withEnv(
  t: TestContext,
  next: Partial<Record<string, string | undefined>>,
) {
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(next)) {
    originals[key] = process.env[key];
    const v = next[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
  t.after(() => {
    for (const key of Object.keys(originals)) {
      const v = originals[key];
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
    }
  });
}

/// ---------- isEphemeralSignedUrl ----------

test("isEphemeralSignedUrl：识别火山 TOS 预签名 URL", () => {
  assert.equal(
    isEphemeralSignedUrl(
      "https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/doubao-seedance-2-0/x.mp4?X-Tos-Algorithm=TOS4-HMAC-SHA256&X-Tos-Expires=86400&X-Tos-Signature=abc",
    ),
    true,
  );
});

test("isEphemeralSignedUrl：识别 S3 预签名 URL", () => {
  assert.equal(
    isEphemeralSignedUrl(
      "https://bucket.s3.amazonaws.com/x.mp4?X-Amz-Expires=3600&X-Amz-Signature=abc",
    ),
    true,
  );
});

test("isEphemeralSignedUrl：普通公网 / Blob URL 不误判", () => {
  assert.equal(
    isEphemeralSignedUrl("https://abc.public.blob.vercel-storage.com/final.mp4"),
    false,
  );
  assert.equal(isEphemeralSignedUrl("https://cdn.example.com/v.mp4"), false);
  assert.equal(isEphemeralSignedUrl("not a url"), false);
});

/// ---------- 死区回归：unified 单段 + external ----------

test("stitchFinalVideo：unified 单段 + external → awaitingExternal 占位（可被 runner 领取，不再死区）", async (t) => {
  withEnv(t, { STITCH_RUNTIME: "external" });

  const fakeFv = {
    id: "fv_unified_single",
    status: FinalVideoStatus.PENDING,
    segmentCount: 1,
    stitchAttempts: 0,
    targetDurationSec: 15,
    thumbnailUrl: null,
    brief: { id: "brief_unified_single" },
    segments: [
      {
        segmentIndex: 0,
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl:
          "https://ark.tos-cn-beijing.volces.com/seg.mp4?X-Tos-Expires=86400&X-Tos-Signature=s",
        outputThumbUrl: null,
      },
    ],
  };

  const updateManyCalls: Array<{ data: Record<string, unknown> }> = [];
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findUnique: (async () => fakeFv) as never,
    updateMany: (async (args: { data: Record<string, unknown> }) => {
      updateManyCalls.push(args);
      return { count: 1 };
    }) as never,
  });
  /// briefHasUnifiedAssembly 会查 videoBrief.videoGenerationPlan
  patchModel(t, db.videoBrief as unknown as Record<string, unknown>, {
    findUnique: (async () => ({
      videoGenerationPlan: {
        assemblyPlan: {
          clips: [
            {
              sourceType: "ai_generated_clip",
              segmentOrder: 0,
              fromSec: 0,
              toSec: 15,
            },
          ],
        },
      },
    })) as never,
  });

  const result = await stitchFinalVideo("fv_unified_single");
  assert.equal(result.awaitingExternal, true, "生产环境 unified 单段应等待外部 runner");
  assert.equal(result.status, FinalVideoStatus.PENDING);
  assert.equal(
    updateManyCalls[0]?.data.ffmpegError,
    AWAITING_EXTERNAL_STITCHER,
  );
  /// 死区闭环由 stitch-service-runtime.test.ts 的
  /// 「claimStitchTask：单段 fv 也能被外部 runner 领取」保证：
  /// external 占位后 runner 必须能领取该任务。
});

/// ---------- 临时签名 URL 不允许直通 ----------

test("stitchFinalVideo：legacy 单段 + 临时签名 URL + external → 不走 fast path（防 24h 后成片 403）", async (t) => {
  withEnv(t, { STITCH_RUNTIME: "external" });

  const ephemeralUrl =
    "https://ark.tos-cn-beijing.volces.com/seg.mp4?X-Tos-Expires=86400&X-Tos-Signature=s";
  const fakeFv = {
    id: "fv_legacy_ephemeral",
    status: FinalVideoStatus.PENDING,
    segmentCount: 1,
    stitchAttempts: 0,
    targetDurationSec: 15,
    thumbnailUrl: null,
    brief: null, // legacy：无 unified plan
    segments: [
      {
        segmentIndex: 0,
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl: ephemeralUrl,
        outputThumbUrl: null,
      },
    ],
  };

  const updateCalls: Array<{ data: Record<string, unknown> }> = [];
  const updateManyCalls: Array<{ data: Record<string, unknown> }> = [];
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findUnique: (async () => fakeFv) as never,
    update: (async (args: { data: Record<string, unknown> }) => {
      updateCalls.push(args);
      return { ...fakeFv, ...args.data };
    }) as never,
    updateMany: (async (args: { data: Record<string, unknown> }) => {
      updateManyCalls.push(args);
      return { count: 1 };
    }) as never,
  });

  const result = await stitchFinalVideo("fv_legacy_ephemeral");
  assert.notEqual(
    result.stitchedVideoUrl,
    ephemeralUrl,
    "绝不允许把 24h 过期的签名 URL 直接写成 stitchedVideoUrl",
  );
  assert.equal(result.awaitingExternal, true, "应转交外部 runner 转存持久存储");
  assert.equal(
    updateCalls.filter((c) => c.data.status === FinalVideoStatus.READY).length,
    0,
    "不应有任何 READY 写入",
  );
  assert.equal(updateManyCalls.length, 1);
});

test("stitchFinalVideo：legacy 单段 + 持久 URL → fast path 仍然直通（行为不回退）", async (t) => {
  withEnv(t, { STITCH_RUNTIME: "external" });

  const persistentUrl = "https://abc.public.blob.vercel-storage.com/seg.mp4";
  const fakeFv = {
    id: "fv_legacy_persistent",
    status: FinalVideoStatus.PENDING,
    segmentCount: 1,
    stitchAttempts: 0,
    targetDurationSec: 15,
    thumbnailUrl: null,
    brief: null,
    segments: [
      {
        segmentIndex: 0,
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl: persistentUrl,
        outputThumbUrl: null,
      },
    ],
  };

  const updateCalls: Array<{ data: Record<string, unknown> }> = [];
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findUnique: (async () => fakeFv) as never,
    update: (async (args: { data: Record<string, unknown> }) => {
      updateCalls.push(args);
      return { ...fakeFv, ...args.data };
    }) as never,
    updateMany: (async () => ({ count: 1 })) as never,
  });

  const result = await stitchFinalVideo("fv_legacy_persistent");
  assert.equal(result.ok, true);
  assert.equal(result.status, FinalVideoStatus.READY);
  assert.equal(result.stitchedVideoUrl, persistentUrl);
  assert.equal(updateCalls[0]?.data.status, FinalVideoStatus.READY);
});
