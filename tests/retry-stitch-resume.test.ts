import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, VideoJobStatus } from "@prisma/client";
import { retryStitch } from "../src/lib/services/stitch-service";
import { db } from "../src/lib/db";

/**
 * 第三阶段审计项 2/3 —— 「重试 = 续跑」回归测试。
 *
 * 合成失败后用户点重试（render-retry all=true → retryStitch）必须：
 *  - 重置 stitchAttempts（否则预算耗尽的任务重试后永远不会被 runner 领取，回到死区）
 *  - 复用已付费段走 stitchFinalVideo（零生成计费；external 下转为可领取的占位）
 *
 * monkey-patch Prisma，不触真实 DB / ffmpeg，AIVORA_DRY_RUN=1 下零计费。
 */

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

test("retryStitch：重置尝试预算并转为外部 runner 可领取的续跑任务", async (t) => {
  const prevRuntime = process.env.STITCH_RUNTIME;
  process.env.STITCH_RUNTIME = "external";
  t.after(() => {
    if (prevRuntime === undefined) delete process.env.STITCH_RUNTIME;
    else process.env.STITCH_RUNTIME = prevRuntime;
  });

  /// 预算已耗尽的失败合成（sweep 失败化后的形态）
  const fakeFvFailed = {
    id: "fv_retry",
    status: FinalVideoStatus.FAILED,
    segmentCount: 2,
    stitchAttempts: 3,
    stitchAttemptToken: "stale-attempt",
    targetDurationSec: 15,
    thumbnailUrl: null,
    brief: { id: "brief_retry" },
    segments: [
      {
        segmentIndex: 0,
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl: "https://abc.public.blob.vercel-storage.com/seg0.mp4",
        outputThumbUrl: null,
      },
      {
        segmentIndex: 1,
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl: "https://abc.public.blob.vercel-storage.com/seg1.mp4",
        outputThumbUrl: null,
      },
    ],
  };

  const updateManys: Array<{
    where?: Record<string, unknown>;
    data: Record<string, unknown>;
  }> = [];
  let currentStatus: FinalVideoStatus = fakeFvFailed.status;
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findUnique: (async () => ({
      ...fakeFvFailed,
      status: currentStatus,
    })) as never,
    updateMany: (async (args: {
      where?: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      updateManys.push(args);
      if (args.data.status) {
        currentStatus = args.data.status as FinalVideoStatus;
      }
      return { count: 1 };
    }) as never,
  });
  /// briefHasUnifiedAssembly 会查 videoBrief.videoGenerationPlan —— legacy 多段 brief 返回 null
  patchModel(t, db.videoBrief as unknown as Record<string, unknown>, {
    findUnique: (async () => ({ videoGenerationPlan: null })) as never,
  });

  const result = await retryStitch("fv_retry");

  /// 1. 预算重置（否则 claim 的 attempts < MAX 过滤会永远跳过它）
  const reset = updateManys.find(
    (u) => u.data.status === FinalVideoStatus.PENDING,
  );
  assert.ok(reset, "应先重置为 PENDING");
  assert.equal(reset.data.stitchAttempts, 0, "用户主动重试应重置尝试预算");
  assert.equal(reset.data.ffmpegError, null);
  assert.equal(reset.data.stitchAttemptToken, null, "主动重试必须撤销旧 runner 所有权");
  assert.deepEqual(reset.where, {
    id: "fv_retry",
    status: FinalVideoStatus.FAILED,
    stitchAttemptToken: "stale-attempt",
  });

  /// 2. external 下转为等待外部 runner 领取（续跑占位，零生成计费）
  assert.equal(result.awaitingExternal, true);
  assert.equal(updateManys.length, 2);
});
