import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, VideoJobStatus } from "@prisma/client";
import {
  __test__ as stitchTest,
  stitchFinalVideo,
  claimStitchTask,
  finishStitchTask,
} from "../src/lib/services/stitch-service";
import { db } from "../src/lib/db";

/**
 * Stitch Service —— 运行时分支与 BLOB 强约束的单元测试。
 *
 * 关键契约（不能破）：
 *   1. 生产环境 stitchFinalVideo 不调 ffmpeg —— 只写 ffmpegError="awaiting external stitcher"。
 *   2. 单段（segmentCount === 1）走 fast path：直接复用首段 URL，不走外部 runner。
 *   3. 缺 BLOB_READ_WRITE_TOKEN 时 persistStitchedFile 必须 throw（不再静默写 file://）。
 *   4. claimStitchTask CAS PENDING → STITCHING；并发时只有一条 runner 抢到。
 *   5. finishStitchTask 写 stitchedVideoUrl + status=READY。
 *
 * 测试策略：直接 monkey-patch db.finalVideo.{findUnique, findMany, update, updateMany}，
 * 避免真实数据库访问；用 `t.after` 在测试结束时恢复原方法。绝不会真实跑 ffmpeg / 上传 Blob
 * （一旦走到那条路径，测试会因为没有 BLOB token 或 fetch 失败而 fail）。
 *
 * 为什么不用 node:test 的 t.mock.method？
 *   Prisma 的 model accessor（db.finalVideo）使用 Proxy 暴露方法，t.mock.method
 *   在某些 Node 版本上会因为 own descriptor 缺失而抛 ERR_INVALID_ARG_VALUE。直接赋值
 *   + t.after 恢复的方式跨版本更稳。
 */

const { stitchRuntimeMode, persistStitchedFile, AWAITING_EXTERNAL_STITCHER } =
  stitchTest;

type FinalVideoDb = typeof db.finalVideo;

/// 把 db.finalVideo 上的方法替换成 mock，并在测试结束时恢复
function patchFinalVideo(
  t: TestContext,
  patches: Partial<Record<keyof FinalVideoDb, (...args: unknown[]) => unknown>>,
) {
  const originals: Record<string, unknown> = {};
  const target = db.finalVideo as unknown as Record<string, unknown>;
  for (const key of Object.keys(patches)) {
    originals[key] = target[key];
    target[key] = patches[key as keyof FinalVideoDb] as unknown;
  }
  t.after(() => {
    for (const key of Object.keys(originals)) {
      target[key] = originals[key];
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

/// ---------- Pure logic: stitchRuntimeMode ----------

test("stitchRuntimeMode：未设置 + NODE_ENV=production → external", (t) => {
  withEnv(t, { STITCH_RUNTIME: undefined, NODE_ENV: "production" });
  assert.equal(stitchRuntimeMode(), "external");
});

test("stitchRuntimeMode：未设置 + NODE_ENV=development → local", (t) => {
  withEnv(t, { STITCH_RUNTIME: undefined, NODE_ENV: "development" });
  assert.equal(stitchRuntimeMode(), "local");
});

test("stitchRuntimeMode：STITCH_RUNTIME=local 覆盖一切（即使 production）", (t) => {
  withEnv(t, { STITCH_RUNTIME: "local", NODE_ENV: "production" });
  assert.equal(stitchRuntimeMode(), "local");
});

test("stitchRuntimeMode：STITCH_RUNTIME=external 覆盖一切（即使 dev）", (t) => {
  withEnv(t, { STITCH_RUNTIME: "external", NODE_ENV: "development" });
  assert.equal(stitchRuntimeMode(), "external");
});

/// ---------- Storage 强约束 ----------
/// Phase 2A：错误信息从 "BLOB_READ_WRITE_TOKEN not configured" 改为
/// "Storage provider \"<id>\" not configured ..."，但语义不变：缺配置 → 直接 throw，
/// 绝不再静默写 file://（旧 bug 会让 DB 里存 file:///tmp/... 导致前端永远播不出）。

test("persistStitchedFile：storage provider 未配置 → throw（不再写 file://）", async (t) => {
  withEnv(t, {
    BLOB_READ_WRITE_TOKEN: undefined,
    /// 同时清掉 TOS env，确保不会因为 STORAGE_PROVIDER 默认推断到 TOS 而走另一分支
    VOLCENGINE_ACCESS_KEY_ID: undefined,
    VOLCENGINE_TOS_ENDPOINT: undefined,
  });
  /// 重置 provider/env cache，让我们的 env 改动生效（其它测试可能已经缓存了）
  const { __resetAppEnvForTests } = await import("../src/lib/config/env");
  const { __resetStorageProviderForTests } = await import("../src/lib/storage");
  __resetAppEnvForTests();
  __resetStorageProviderForTests();
  t.after(() => {
    __resetAppEnvForTests();
    __resetStorageProviderForTests();
  });
  await assert.rejects(
    () => persistStitchedFile("/tmp/fake.mp4", "final-videos/fake.mp4"),
    /Storage provider .* not configured/,
  );
});

/// ---------- 端到端（mock db）：stitchFinalVideo 不调 ffmpeg ----------

test("stitchFinalVideo 生产模式：不调 ffmpeg，只写 awaiting external stitcher", async (t) => {
  withEnv(t, { STITCH_RUNTIME: "external" });

  const finalVideoId = "fv_external_test";
  const fakeFv = {
    id: finalVideoId,
    status: FinalVideoStatus.PENDING,
    segmentCount: 2,
    stitchAttempts: 0,
    targetDurationSec: 30,
    thumbnailUrl: null,
    brief: null,
    segments: [
      {
        segmentIndex: 0,
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl: "https://cdn.example.com/seg0.mp4",
        outputThumbUrl: "https://cdn.example.com/seg0.jpg",
      },
      {
        segmentIndex: 1,
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl: "https://cdn.example.com/seg1.mp4",
        outputThumbUrl: null,
      },
    ],
  };

  const updateCalls: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const updateManyCalls: Array<{ where: unknown; data: Record<string, unknown> }> = [];

  patchFinalVideo(t, {
    findUnique: (async () => fakeFv) as never,
    update: (async (args: { where: unknown; data: Record<string, unknown> }) => {
      updateCalls.push(args);
      return { ...fakeFv, ...args.data };
    }) as never,
    updateMany: (async (args: { where: unknown; data: Record<string, unknown> }) => {
      updateManyCalls.push(args);
      return { count: 1 };
    }) as never,
  });

  const result = await stitchFinalVideo(finalVideoId);

  assert.equal(result.awaitingExternal, true, "应标记为 awaiting external");
  assert.equal(result.ok, false);
  assert.equal(result.status, FinalVideoStatus.PENDING, "状态保持 PENDING 等 runner 拉");
  assert.equal(result.error, AWAITING_EXTERNAL_STITCHER);

  /// 关键：必须经过 updateMany 写 ffmpegError，不能调 update 把 status 改成 STITCHING/READY/FAILED
  assert.equal(updateCalls.length, 0, "生产模式不应调 finalVideo.update（避免误改 status）");
  assert.equal(updateManyCalls.length, 1, "应调一次 updateMany 写 awaiting marker");
  assert.equal(
    updateManyCalls[0]?.data.ffmpegError,
    AWAITING_EXTERNAL_STITCHER,
    "ffmpegError 必须是 awaiting 标记",
  );
  assert.equal(updateManyCalls[0]?.data.status, undefined, "status 不应被改动");
});

test("stitchFinalVideo segmentCount=1：走 fast path 复用首段 URL，不进入外部 runner", async (t) => {
  withEnv(t, { STITCH_RUNTIME: "external" }); // 即便生产模式，单段也不走 external

  const singleSegmentUrl = "https://cdn.example.com/single.mp4";
  const fakeFv = {
    id: "fv_single",
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
        outputVideoUrl: singleSegmentUrl,
        outputThumbUrl: "https://cdn.example.com/single.jpg",
      },
    ],
  };

  const updateCalls: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const updateManyCalls: Array<{ where: unknown; data: Record<string, unknown> }> = [];

  patchFinalVideo(t, {
    findUnique: (async () => fakeFv) as never,
    update: (async (args: { where: unknown; data: Record<string, unknown> }) => {
      updateCalls.push(args);
      return { ...fakeFv, ...args.data };
    }) as never,
    updateMany: (async (args: { where: unknown; data: Record<string, unknown> }) => {
      updateManyCalls.push(args);
      return { count: 1 };
    }) as never,
  });

  const result = await stitchFinalVideo("fv_single");
  assert.equal(result.ok, true);
  assert.equal(result.status, FinalVideoStatus.READY);
  assert.equal(result.stitchedVideoUrl, singleSegmentUrl);
  assert.notEqual(result.awaitingExternal, true, "单段不应走外部 runner");

  /// 必须直接 update 写 READY + stitchedVideoUrl
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.data.status, FinalVideoStatus.READY);
  assert.equal(updateCalls[0]?.data.stitchedVideoUrl, singleSegmentUrl);
  assert.equal(updateManyCalls.length, 0, "单段路径不调 updateMany");
});

test("stitchFinalVideo ENABLE_VIDEO_STITCHING=false：演示模式复用首段，不走外部 runner", async (t) => {
  withEnv(t, {
    STITCH_RUNTIME: "external",
    ENABLE_VIDEO_STITCHING: "false",
  });

  const firstUrl = "https://cdn.example.com/demo-seg0.mp4";
  const fakeFv = {
    id: "fv_demo",
    status: FinalVideoStatus.PENDING,
    segmentCount: 2,
    stitchAttempts: 0,
    targetDurationSec: 30,
    thumbnailUrl: null,
    brief: null,
    segments: [
      {
        segmentIndex: 0,
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl: firstUrl,
        outputThumbUrl: "https://cdn.example.com/demo-seg0.jpg",
      },
      {
        segmentIndex: 1,
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl: "https://cdn.example.com/demo-seg1.mp4",
        outputThumbUrl: null,
      },
    ],
  };
  const updateCalls: Array<{ where: unknown; data: Record<string, unknown> }> = [];

  patchFinalVideo(t, {
    findUnique: (async () => fakeFv) as never,
    update: (async (args: { where: unknown; data: Record<string, unknown> }) => {
      updateCalls.push(args);
      return { ...fakeFv, ...args.data };
    }) as never,
    updateMany: (async () => ({ count: 1 })) as never,
  });

  const result = await stitchFinalVideo("fv_demo");
  assert.equal(result.ok, true);
  assert.equal(result.status, FinalVideoStatus.READY);
  assert.equal(result.stitchedVideoUrl, firstUrl, "演示模式应复用首段 URL");
  assert.equal(updateCalls[0]?.data.status, FinalVideoStatus.READY);
});

/// ---------- claimStitchTask ----------

test("claimStitchTask：CAS PENDING → STITCHING；并发时只有一条 runner 抢到", async (t) => {
  const fakeFvs = [
    {
      id: "fv_claim_1",
      status: FinalVideoStatus.PENDING,
      segmentCount: 2,
      stitchAttempts: 0,
      targetDurationSec: 30,
      brief: { aspectRatio: "9:16" },
      segments: [
        {
          segmentIndex: 0,
          status: VideoJobStatus.SUCCEEDED,
          outputVideoUrl: "https://cdn.example.com/c1-0.mp4",
          outputThumbUrl: null,
        },
        {
          segmentIndex: 1,
          status: VideoJobStatus.SUCCEEDED,
          outputVideoUrl: "https://cdn.example.com/c1-1.mp4",
          outputThumbUrl: null,
        },
      ],
    },
  ];

  let casCalls = 0;
  patchFinalVideo(t, {
    findMany: (async () => fakeFvs) as never,
    updateMany: (async () => {
      casCalls++;
      /// 第一次成功，第二次（模拟并发）失败
      return casCalls === 1 ? { count: 1 } : { count: 0 };
    }) as never,
  });

  /// 第一次 claim 拿到任务
  const task1 = await claimStitchTask();
  assert.ok(task1, "第一次应抢到任务");
  assert.equal(task1?.finalVideoId, "fv_claim_1");
  assert.equal(task1?.segmentUrls.length, 2);
  assert.equal(task1?.aspectRatio, "9:16");
  assert.equal(task1?.targetDurationSec, 30);

  /// 第二次（模拟并发：另一个 runner 已经 CAS 走了）
  const task2 = await claimStitchTask();
  assert.equal(task2, null, "并发抢失败时应返回 null（不重复返回同一任务）");
});

test("claimStitchTask：所有段未全部 SUCCEEDED 时跳过", async (t) => {
  const fakeFvs = [
    {
      id: "fv_partial",
      status: FinalVideoStatus.PENDING,
      segmentCount: 2,
      stitchAttempts: 0,
      targetDurationSec: 30,
      brief: { aspectRatio: "9:16" },
      segments: [
        {
          segmentIndex: 0,
          status: VideoJobStatus.SUCCEEDED,
          outputVideoUrl: "https://cdn.example.com/p-0.mp4",
          outputThumbUrl: null,
        },
        {
          segmentIndex: 1,
          status: VideoJobStatus.RUNNING,
          outputVideoUrl: null,
          outputThumbUrl: null,
        },
      ],
    },
  ];
  let updateManyCalls = 0;
  patchFinalVideo(t, {
    findMany: (async () => fakeFvs) as never,
    updateMany: (async () => {
      updateManyCalls++;
      return { count: 1 };
    }) as never,
  });

  const task = await claimStitchTask();
  assert.equal(task, null, "段未齐时不应抢任务");
  assert.equal(
    updateManyCalls,
    0,
    "不应触发 CAS（避免误把 PENDING 推到 STITCHING）",
  );
});

/// 回归（2026-07 孤儿任务修复）：单段 fv 也必须可以被外部 runner 领取。
/// 旧行为是 segmentCount<=1 直接跳过 —— 但生产环境下带 unified assemblyPlan 的
/// 单段 brief 会被 stitchFinalVideo 打上「awaiting external stitcher」占位（unified
/// 判定先于单段捷径），如果 runner 也跳过它，就没有任何 worker 认领，任务永久
/// 卡在「正在合成 85%」。
test("claimStitchTask：单段 fv 也能被外部 runner 领取（孤儿任务回归）", async (t) => {
  const fakeFvs = [
    {
      id: "fv_single_claimable",
      status: FinalVideoStatus.PENDING,
      segmentCount: 1,
      stitchAttempts: 0,
      targetDurationSec: 15,
      brief: { aspectRatio: "9:16" },
      segments: [
        {
          segmentIndex: 0,
          status: VideoJobStatus.SUCCEEDED,
          outputVideoUrl: "https://cdn.example.com/s.mp4",
          outputThumbUrl: null,
        },
      ],
    },
  ];
  let updateManyCalls = 0;
  patchFinalVideo(t, {
    findMany: (async () => fakeFvs) as never,
    updateMany: (async () => {
      updateManyCalls++;
      return { count: 1 };
    }) as never,
  });

  const task = await claimStitchTask();
  assert.ok(task, "单段任务必须能被领取，否则形成无人认领的死区");
  assert.equal(task?.finalVideoId, "fv_single_claimable");
  assert.equal(task?.segmentUrls.length, 1);
  assert.equal(updateManyCalls, 1, "应触发一次 CAS PENDING→STITCHING");
});

/// ---------- finishStitchTask ----------

test("finishStitchTask：写 stitchedVideoUrl + status=READY", async (t) => {
  const fakeFv = {
    id: "fv_done",
    status: FinalVideoStatus.STITCHING,
    segmentCount: 2,
    stitchAttempts: 0,
    targetDurationSec: 30,
    thumbnailUrl: null,
    brief: null,
  };
  const updateCalls: Array<{ where: unknown; data: Record<string, unknown> }> = [];

  patchFinalVideo(t, {
    findUnique: (async () => fakeFv) as never,
    update: (async (args: { where: unknown; data: Record<string, unknown> }) => {
      updateCalls.push(args);
      return { ...fakeFv, ...args.data };
    }) as never,
  });

  const result = await finishStitchTask({
    finalVideoId: "fv_done",
    stitchedVideoUrl: "https://cdn.example.com/final.mp4",
    thumbnailUrl: "https://cdn.example.com/final.jpg",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, FinalVideoStatus.READY);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.data.status, FinalVideoStatus.READY);
  assert.equal(
    updateCalls[0]?.data.stitchedVideoUrl,
    "https://cdn.example.com/final.mp4",
  );
  assert.equal(updateCalls[0]?.data.thumbnailUrl, "https://cdn.example.com/final.jpg");
  assert.equal(updateCalls[0]?.data.ffmpegError, null);
});

test("finishStitchTask：error 入参 → 写 ffmpegError + status=FAILED + attempts++", async (t) => {
  const fakeFv = {
    id: "fv_fail",
    status: FinalVideoStatus.STITCHING,
    segmentCount: 2,
    stitchAttempts: 1,
    targetDurationSec: 30,
    thumbnailUrl: null,
    brief: null,
  };
  const updateCalls: Array<{ where: unknown; data: Record<string, unknown> }> = [];

  patchFinalVideo(t, {
    findUnique: (async () => fakeFv) as never,
    update: (async (args: { where: unknown; data: Record<string, unknown> }) => {
      updateCalls.push(args);
      return { ...fakeFv, ...args.data };
    }) as never,
  });

  const result = await finishStitchTask({
    finalVideoId: "fv_fail",
    error: "ffmpeg crashed",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, FinalVideoStatus.FAILED);
  assert.equal(updateCalls[0]?.data.status, FinalVideoStatus.FAILED);
  assert.equal(updateCalls[0]?.data.ffmpegError, "ffmpeg crashed");
  assert.equal(updateCalls[0]?.data.stitchAttempts, 2);
});

test("finishStitchTask：finalVideo 不存在 → 返回 FAILED 不抛错", async (t) => {
  patchFinalVideo(t, {
    findUnique: (async () => null) as never,
  });

  const result = await finishStitchTask({
    finalVideoId: "fv_missing",
    stitchedVideoUrl: "https://cdn.example.com/x.mp4",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, FinalVideoStatus.FAILED);
  assert.match(result.error ?? "", /不存在/);
});
