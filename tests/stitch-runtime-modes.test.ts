/**
 * C3：生产只有一个合成器 —— 运行模式判定与「inprocess 绝不内联合成」。
 *
 *   - 判定唯一来源 src/lib/media/stitch-runtime.ts；stitch-service / stitch-dispatch-service
 *     不再各自复制一份。
 *   - inprocess（生产默认）：用户请求 / poll-videos 走到 stitchFinalVideo 时只把 FinalVideo
 *     留在 PENDING（就绪），不写库、不认领、不跑 ffmpeg —— 合成只在 stitch-dispatch 函数里。
 *   - external（回滚）/ local（开发）的分支顺序与改造前逐条一致（decideStitchPath）。
 *
 * monkey-patch Prisma model 方法，不连真实数据库、不跑 ffmpeg、不调任何供应商。
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, VideoJobStatus } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  describeStitchRuntime,
  resolveStitchRuntimeMode,
} from "../src/lib/media/stitch-runtime";
import {
  decideStitchPath,
  retryStitch,
  stitchFinalVideo,
  __test__ as stitchTest,
} from "../src/lib/services/stitch-service";
import { __test__ as dispatchTest } from "../src/lib/services/stitch-dispatch-service";

function patchModel(
  t: TestContext,
  model: Record<string, unknown>,
  patches: Record<string, unknown>,
) {
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = model[key];
    model[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) model[key] = originals[key];
  });
}

function withEnv(t: TestContext, next: Record<string, string | undefined>) {
  const env = process.env as Record<string, string | undefined>;
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(next)) {
    originals[key] = env[key];
    if (next[key] === undefined) delete env[key];
    else env[key] = next[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) {
      if (originals[key] === undefined) delete env[key];
      else env[key] = originals[key];
    }
  });
}

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

test("resolveStitchRuntimeMode：生产默认 inprocess，开发默认 local，显式值覆盖一切", () => {
  assert.equal(resolveStitchRuntimeMode({ NODE_ENV: "production" }), "inprocess");
  assert.equal(resolveStitchRuntimeMode({ NODE_ENV: "development" }), "local");
  assert.equal(resolveStitchRuntimeMode({}), "local");
  assert.equal(resolveStitchRuntimeMode({ NODE_ENV: "production", STITCH_RUNTIME: "external" }), "external");
  assert.equal(resolveStitchRuntimeMode({ NODE_ENV: "production", STITCH_RUNTIME: "local" }), "local");
  assert.equal(resolveStitchRuntimeMode({ NODE_ENV: "development", STITCH_RUNTIME: "inprocess" }), "inprocess");
  assert.equal(resolveStitchRuntimeMode({ STITCH_RUNTIME: " In-Process " }), "inprocess");
  assert.equal(resolveStitchRuntimeMode({ STITCH_RUNTIME: "in_process" }), "inprocess");
});

test("resolveStitchRuntimeMode：写错的值不会意外切到 external，按 NODE_ENV 回落并在说明里标出", () => {
  assert.equal(resolveStitchRuntimeMode({ NODE_ENV: "production", STITCH_RUNTIME: "extrenal" }), "inprocess");
  const described = describeStitchRuntime({ NODE_ENV: "production", STITCH_RUNTIME: "extrenal" });
  assert.equal(described.mode, "inprocess");
  assert.match(described.reason, /unrecognised STITCH_RUNTIME=extrenal/);
  assert.match(describeStitchRuntime({ STITCH_RUNTIME: "external" }).reason, /explicit/);
});

test("stitch-service 与 stitch-dispatch-service 共用同一判定（不再各自复制）", (t) => {
  withEnv(t, { STITCH_RUNTIME: undefined, NODE_ENV: "production" });
  assert.equal(stitchTest.stitchRuntimeMode(), "inprocess");
  assert.equal(dispatchTest.stitchRuntimeMode({ NODE_ENV: "production" }), "inprocess");
  assert.equal(dispatchTest.stitchRuntimeMode({ STITCH_RUNTIME: "external" }), "external");
  assert.equal(dispatchTest.stitchRuntimeMode({ NODE_ENV: "test" }), "local");
});

// ---------------------------------------------------------------------------
// decideStitchPath：external / local 与改造前逐条一致；inprocess 一律不内联
// ---------------------------------------------------------------------------

const base = {
  isBroll: false,
  isUnified: false,
  segmentCount: 2,
  firstSegmentUrl: "https://cdn.example.com/seg0.mp4",
  demo: false,
};

test("decideStitchPath：inprocess 下 b-roll / unified / legacy 多段 / legacy 单段全部留 PENDING 等合成函数", () => {
  assert.equal(decideStitchPath({ ...base, mode: "inprocess", isBroll: true }), "await_inprocess");
  assert.equal(decideStitchPath({ ...base, mode: "inprocess", isUnified: true }), "await_inprocess");
  assert.equal(decideStitchPath({ ...base, mode: "inprocess" }), "await_inprocess");
  assert.equal(
    decideStitchPath({ ...base, mode: "inprocess", segmentCount: 1 }),
    "await_inprocess",
    "生产单段也走合成器：语音安全裁尾 + 成片缩略图 + 转存持久存储",
  );
  assert.equal(
    decideStitchPath({ ...base, mode: "inprocess", demo: true }),
    "reuse_first_segment_demo",
    "演示开关 ENABLE_VIDEO_STITCHING=false 仍然只复用首段",
  );
  assert.equal(
    decideStitchPath({ ...base, mode: "inprocess", isBroll: true, demo: true }),
    "await_external",
    "b-roll 在演示模式下保持旧的占位语义（绝不把图库原片当成片）",
  );
});

test("decideStitchPath：external（回滚）与改造前完全一致", () => {
  assert.equal(decideStitchPath({ ...base, mode: "external", isBroll: true }), "await_external");
  assert.equal(decideStitchPath({ ...base, mode: "external", isUnified: true, segmentCount: 1 }), "await_external");
  assert.equal(decideStitchPath({ ...base, mode: "external", segmentCount: 1 }), "reuse_single_segment");
  assert.equal(
    decideStitchPath({
      ...base,
      mode: "external",
      segmentCount: 1,
      firstSegmentUrl: "https://ark.tos.example.com/s.mp4?X-Tos-Expires=86400&X-Tos-Signature=x",
    }),
    "await_external",
  );
  assert.equal(decideStitchPath({ ...base, mode: "external", demo: true }), "reuse_first_segment_demo");
  assert.equal(decideStitchPath({ ...base, mode: "external" }), "await_external");
});

test("decideStitchPath：local（开发）在请求里内联认领 + 合成，单段捷径保持", () => {
  assert.equal(decideStitchPath({ ...base, mode: "local", isBroll: true }), "compose_inline");
  assert.equal(decideStitchPath({ ...base, mode: "local", isUnified: true }), "compose_inline");
  assert.equal(decideStitchPath({ ...base, mode: "local" }), "compose_inline");
  assert.equal(decideStitchPath({ ...base, mode: "local", segmentCount: 1 }), "reuse_single_segment");
  assert.equal(decideStitchPath({ ...base, mode: "local", isBroll: true, demo: true }), "await_external");
});

// ---------------------------------------------------------------------------
// stitchFinalVideo（reconcile / poll-videos / 重试入口）在 inprocess 下零写入
// ---------------------------------------------------------------------------

function readySegments(count: number, extra: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, index) => ({
    segmentIndex: index,
    status: VideoJobStatus.SUCCEEDED,
    outputVideoUrl: `https://cdn.example.com/seg-${index}.mp4`,
    outputThumbUrl: `https://cdn.example.com/seg-${index}.jpg`,
    assignedAssets: null,
    ...extra,
  }));
}

function installNoWriteGuards(t: TestContext, fv: Record<string, unknown>, plan: unknown = null) {
  const writes: string[] = [];
  const forbid = (name: string) => async () => {
    writes.push(name);
    throw new Error(`${name} must not be called in inprocess mode`);
  };
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findUnique: async () => fv,
    update: forbid("finalVideo.update"),
    updateMany: forbid("finalVideo.updateMany"),
  });
  patchModel(t, db.videoBrief as unknown as Record<string, unknown>, {
    findUnique: async () => ({ videoGenerationPlan: plan }),
    update: forbid("videoBrief.update"),
  });
  return writes;
}

const cases: Array<{ name: string; fv: Record<string, unknown>; plan?: unknown }> = [
  {
    name: "legacy 多段",
    fv: { id: "fv_inproc_multi", status: FinalVideoStatus.PENDING, segmentCount: 2, stitchAttempts: 0, brief: null, segments: readySegments(2) },
  },
  {
    name: "legacy 单段（持久 URL，external 下会走捷径）",
    fv: { id: "fv_inproc_single", status: FinalVideoStatus.PENDING, segmentCount: 1, stitchAttempts: 0, brief: null, segments: readySegments(1) },
  },
  {
    name: "unified assembly 单段",
    fv: { id: "fv_inproc_unified", status: FinalVideoStatus.PENDING, segmentCount: 1, stitchAttempts: 0, brief: { id: "brief_u" }, segments: readySegments(1) },
    plan: { assemblyPlan: { clips: [{ sourceType: "ai_generated_clip", segmentOrder: 0, fromSec: 0, toSec: 15 }] } },
  },
  {
    name: "b-roll",
    fv: {
      id: "broll_inproc",
      status: FinalVideoStatus.PENDING,
      segmentCount: 2,
      stitchAttempts: 0,
      brief: { id: "brief_b" },
      segments: readySegments(2, {
        assignedAssets: { broll: { ttsAudioUrl: "https://cdn.example.com/tts.mp3" } },
      }),
    },
  },
];

for (const scenario of cases) {
  test(`stitchFinalVideo inprocess：${scenario.name} → 只留 PENDING，零写入、不内联合成`, async (t) => {
    withEnv(t, { STITCH_RUNTIME: undefined, NODE_ENV: "production", ENABLE_VIDEO_STITCHING: undefined });
    const writes = installNoWriteGuards(t, scenario.fv, scenario.plan ?? null);
    const result = await stitchFinalVideo(scenario.fv.id as string);
    assert.equal(result.awaitingInprocess, true);
    assert.equal(result.awaitingExternal, undefined);
    assert.equal(result.ok, false);
    assert.equal(result.status, FinalVideoStatus.PENDING);
    assert.deepEqual(writes, [], "inprocess 下 reconcile 路径不得写库 / 认领");
  });
}

test("retryStitch inprocess：重置为 PENDING 后不在请求里合成，交给 stitch-dispatch 函数", async (t) => {
  withEnv(t, { STITCH_RUNTIME: "inprocess" });
  let status: FinalVideoStatus = FinalVideoStatus.FAILED;
  const updateManys: Array<Record<string, unknown>> = [];
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findUnique: async () => ({
      id: "fv_retry_inproc",
      status,
      segmentCount: 2,
      stitchAttempts: 3,
      stitchAttemptToken: "old",
      brief: null,
      segments: readySegments(2),
    }),
    updateMany: async (args: { data: Record<string, unknown> }) => {
      updateManys.push(args.data);
      if (args.data.status) status = args.data.status as FinalVideoStatus;
      return { count: 1 };
    },
    update: async () => {
      throw new Error("must not write READY inline");
    },
  });
  const result = await retryStitch("fv_retry_inproc");
  assert.equal(result.awaitingInprocess, true);
  assert.equal(updateManys.length, 1, "只有重置那一次写入");
  assert.equal(updateManys[0]?.status, FinalVideoStatus.PENDING);
  assert.equal(updateManys[0]?.stitchAttempts, 0);
});

test("b-roll 交付入口只在 local 模式内联推进（inprocess / external 都不在用户请求里合成）", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/lib/services/broll-assembly-service.ts", "utf8");
  assert.match(source, /if \(resolveStitchRuntimeMode\(\) === "local"\) \{/);
  assert.doesNotMatch(source, /process\.env\.NODE_ENV !== "production"/);
});
