import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, VideoBriefStatus, VideoJobStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import { __test__ as authTest } from "../src/lib/auth";
import {
  finishStitchTask,
  restitchReadyFinalVideo,
  rollbackRestitch,
} from "../src/lib/services/stitch-service";
import { __test__ as sweepTest, type SweepResult } from "../src/lib/services/sweep-service";
import { cancelUnifiedOrderForUser } from "../src/lib/services/single-video-cancel-service";
import { syncBriefStatus } from "../src/lib/services/video-service";
import {
  restitchDefaultsFor,
  toUnifiedLibraryRow,
} from "../src/lib/services/unified-library-service";
import {
  parseRestitchPatch,
  RestitchRejectedError,
} from "../src/lib/video-generation/restitch-patch";
import { POST as renderRetry } from "../src/app/api/briefs/[id]/render-retry/route";
import type { PostProductionPlan } from "../src/types/video-generation";

/**
 * P05-B（链 T）只重拼：READY 成片换字幕样式 / BGM。
 *
 *   READY ──restitch──▶ PENDING ──claim──▶ STITCHING ──finish ok──▶ READY（新片）
 *     ▲                   │                   │
 *     │   等合成超时(sweep) │   合成失败 / STITCHING 超时达上限(sweep) / 取消
 *     └───────────────────┴───────────────────┘   rollbackRestitch → READY（旧片）
 *
 * 零生成计费；只放行 captions / bgm；三条回滚边全部回到 READY + 旧 URL，不碰 brief；
 * 已交付 brief 不打回 QA_PENDING / RENDERING。全部 monkey-patch Prisma，不连库、不跑 ffmpeg。
 */

const require = createRequire(import.meta.url);
const nextAuthRuntime = require("next-auth/next") as Record<string, unknown>;

function patchModel(t: TestContext, model: object, patches: Record<string, unknown>) {
  const record = model as Record<string, unknown>;
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = record[key];
    record[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) record[key] = originals[key];
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

/// 任何付费生成入口被碰到就炸：只重拼必须零生成计费
function forbidGeneration(t: TestContext) {
  const boom = (what: string) => async () => {
    throw new Error(`只重拼不得触发生成：${what}`);
  };
  patchModel(t, db.videoJob, { create: boom("videoJob.create"), update: boom("videoJob.update"), updateMany: boom("videoJob.updateMany") });
}

const OLD_URL = "https://abc.public.blob.vercel-storage.com/final-videos/fv-1/old.mp4";
const NEW_URL = "https://abc.public.blob.vercel-storage.com/final-videos/fv-1/new.mp4";
const NOW = new Date("2026-10-26T12:00:00.000Z");

const BASE_PLAN: PostProductionPlan = {
  audio: {
    voiceover: { enabled: true, voiceId: "warm-confident", language: "zh", script: "这款百叶窗一拧即开。" },
    bgm: { trackId: "none", volume: 0 },
  },
  captions: { enabled: true, style: "plain", language: "zh", position: "bottom", exportSrt: true },
};

function readyFinalVideo(overrides: Record<string, unknown> = {}) {
  return {
    id: "fv-1",
    status: FinalVideoStatus.READY,
    segmentCount: 2,
    targetDurationSec: 15,
    stitchAttempts: 1,
    stitchAttemptToken: null,
    stitchedVideoUrl: OLD_URL,
    previousStitchedVideoUrl: null,
    thumbnailUrl: "https://abc.public.blob.vercel-storage.com/thumb.jpg",
    subtitleFileUrl: null,
    ffmpegError: null,
    postProduction: BASE_PLAN,
    brief: { id: "brief-1" },
    segments: [
      { segmentIndex: 0, status: VideoJobStatus.SUCCEEDED, outputVideoUrl: "https://abc.public.blob.vercel-storage.com/seg0.mp4", outputThumbUrl: null, assignedAssets: null },
      { segmentIndex: 1, status: VideoJobStatus.SUCCEEDED, outputVideoUrl: "https://abc.public.blob.vercel-storage.com/seg1.mp4", outputThumbUrl: null, assignedAssets: null },
    ],
    ...overrides,
  };
}

type UpdateManyCall = { where: Record<string, unknown>; data: Record<string, unknown> };

// ---------------------------------------------------------------------------
// 1. 入口：只放行 captions / bgm；CAS READY → PENDING；零生成计费
// ---------------------------------------------------------------------------

test("parseRestitchPatch：只放行 captions / bgm，带口播一律 INVALID_STATE，其它不合法 VALIDATION_FAILED", () => {
  const ok = parseRestitchPatch({ bgm: { trackId: "wholesome", volume: 0.2 } });
  assert.deepEqual(ok, { bgm: { trackId: "wholesome", volume: 0.2 } });

  for (const bad of [
    { voiceover: { enabled: false } },
    { audio: { voiceover: { script: "改稿" } } },
    { captions: BASE_PLAN.captions, script: "改稿" },
  ]) {
    assert.throws(() => parseRestitchPatch(bad), (err: unknown) =>
      err instanceof RestitchRejectedError && err.code === "INVALID_STATE");
  }
  for (const bad of [{}, null, "x", { unknown: 1 }, { bgm: { trackId: "wholesome", volume: 0.9 } }, { captions: { enabled: true } }]) {
    assert.throws(() => parseRestitchPatch(bad), (err: unknown) =>
      err instanceof RestitchRejectedError && err.code === "VALIDATION_FAILED");
  }
});

test("restitchReadyFinalVideo：CAS READY→PENDING，写旧 URL / attempts 0 / startedAt / 合并后快照；口播原样；零生成计费", async (t) => {
  withEnv(t, { STITCH_RUNTIME: "external", ENABLE_VIDEO_STITCHING: undefined });
  forbidGeneration(t);
  let status: FinalVideoStatus = FinalVideoStatus.READY;
  const calls: UpdateManyCall[] = [];
  patchModel(t, db.finalVideo, {
    findUnique: async () => readyFinalVideo({ status }),
    updateMany: async (args: UpdateManyCall) => {
      calls.push(args);
      if (typeof args.data.status === "string") status = args.data.status as FinalVideoStatus;
      return { count: 1 };
    },
  });
  /// legacy 多段 brief：没有 unified assemblyPlan → external 下写占位
  patchModel(t, db.videoBrief, { findUnique: async () => ({ videoGenerationPlan: null }) });

  const result = await restitchReadyFinalVideo(
    "fv-1",
    { captions: { ...BASE_PLAN.captions, style: "word_by_word", position: "top" }, bgm: { trackId: "wholesome", volume: 0.2 } },
    { now: NOW },
  );

  const reset = calls[0];
  assert.deepEqual(reset.where, {
    id: "fv-1",
    status: FinalVideoStatus.READY,
    stitchedVideoUrl: OLD_URL,
    stitchAttemptToken: null,
  });
  assert.equal(reset.data.status, FinalVideoStatus.PENDING);
  assert.equal(reset.data.previousStitchedVideoUrl, OLD_URL, "旧片 URL 是回滚依据");
  assert.equal(reset.data.stitchAttempts, 0, "照抄 retryStitch：重置尝试预算");
  assert.equal(reset.data.stitchAttemptToken, null);
  assert.equal((reset.data.startedAt as Date).toISOString(), NOW.toISOString(), "排队超时从重新排队时刻起算");
  assert.equal(reset.data.finishedAt, null);
  const merged = reset.data.postProduction as PostProductionPlan;
  assert.deepEqual(merged.audio.voiceover, BASE_PLAN.audio.voiceover, "口播不许动");
  assert.deepEqual(merged.audio.bgm, { trackId: "wholesome", volume: 0.2 });
  assert.equal(merged.captions.style, "word_by_word");
  assert.equal(merged.captions.position, "top");
  /// external：转为可领取的占位，零生成计费
  assert.equal(result.awaitingExternal, true);
  assert.equal(calls.length, 2);
});

test("restitchReadyFinalVideo：非 READY / 无快照 / 设置没变 一律拒绝，不写库", async (t) => {
  withEnv(t, { STITCH_RUNTIME: "external" });
  const calls: UpdateManyCall[] = [];
  let row: Record<string, unknown> = readyFinalVideo({ status: FinalVideoStatus.PENDING, previousStitchedVideoUrl: OLD_URL });
  patchModel(t, db.finalVideo, {
    findUnique: async () => row,
    updateMany: async (args: UpdateManyCall) => { calls.push(args); return { count: 1 }; },
  });
  patchModel(t, db.videoBrief, { findUnique: async () => ({ videoGenerationPlan: null }) });
  const patch = { bgm: { trackId: "wholesome" as const, volume: 0.2 } };

  await assert.rejects(restitchReadyFinalVideo("fv-1", patch), (err: unknown) =>
    err instanceof RestitchRejectedError && err.code === "INVALID_STATE" && /正在按新设置重拼/.test(err.message));

  row = readyFinalVideo({ postProduction: null });
  await assert.rejects(restitchReadyFinalVideo("fv-1", patch), (err: unknown) =>
    err instanceof RestitchRejectedError && err.code === "INVALID_STATE" && /后期设置快照/.test(err.message));

  row = readyFinalVideo();
  await assert.rejects(
    restitchReadyFinalVideo("fv-1", { captions: BASE_PLAN.captions, bgm: BASE_PLAN.audio.bgm }),
    (err: unknown) => err instanceof RestitchRejectedError && err.code === "VALIDATION_FAILED" && /一致/.test(err.message),
  );
  assert.equal(calls.length, 0);
});

test("单段复用拒绝：会走 reuse_single_segment 的行（legacy 单段 + 持久 URL）不能只重拼", async (t) => {
  withEnv(t, { STITCH_RUNTIME: "external", ENABLE_VIDEO_STITCHING: undefined });
  const calls: UpdateManyCall[] = [];
  patchModel(t, db.finalVideo, {
    findUnique: async () => readyFinalVideo({
      segmentCount: 1,
      stitchedVideoUrl: "https://abc.public.blob.vercel-storage.com/seg0.mp4",
      segments: [{ segmentIndex: 0, status: VideoJobStatus.SUCCEEDED, outputVideoUrl: "https://abc.public.blob.vercel-storage.com/seg0.mp4", outputThumbUrl: null, assignedAssets: null }],
    }),
    updateMany: async (args: UpdateManyCall) => { calls.push(args); return { count: 1 }; },
  });
  patchModel(t, db.videoBrief, { findUnique: async () => ({ videoGenerationPlan: null }) });
  await assert.rejects(
    restitchReadyFinalVideo("fv-1", { bgm: { trackId: "wholesome", volume: 0.2 } }),
    (err: unknown) => err instanceof RestitchRejectedError && err.code === "INVALID_STATE" && /复用了单段原片/.test(err.message),
  );
  assert.equal(calls.length, 0, "拒绝时不写任何东西");
});

// ---------------------------------------------------------------------------
// 2. 三条回滚边：合成失败 / 清扫两条超时 / 取消 → READY + 旧 URL，不碰 brief
// ---------------------------------------------------------------------------

type MutableRow = {
  id: string;
  status: FinalVideoStatus;
  stitchAttempts: number;
  stitchAttemptToken: string | null;
  stitchedVideoUrl: string | null;
  previousStitchedVideoUrl: string | null;
  ffmpegError: string | null;
  thumbnailUrl: string | null;
  subtitleFileUrl: string | null;
  finishedAt: Date | null;
};

/// 带 CAS 语义的 FinalVideo 内存行：where 里的 status / token / previousStitchedVideoUrl 不匹配就 count 0
function stateMachine(t: TestContext, state: MutableRow, extra: Record<string, unknown> = {}) {
  const matches = (where: Record<string, unknown>) => {
    if (where.id && where.id !== state.id) return false;
    const status = where.status as FinalVideoStatus | { in: FinalVideoStatus[] } | undefined;
    if (typeof status === "string" && status !== state.status) return false;
    if (status && typeof status === "object" && !status.in.includes(state.status)) return false;
    if ("stitchAttemptToken" in where && where.stitchAttemptToken !== state.stitchAttemptToken) return false;
    if ("previousStitchedVideoUrl" in where && where.previousStitchedVideoUrl !== state.previousStitchedVideoUrl) return false;
    if ("stitchedVideoUrl" in where && where.stitchedVideoUrl !== state.stitchedVideoUrl) return false;
    return true;
  };
  patchModel(t, db.finalVideo, {
    findUnique: async () => ({ ...state, ...extra }),
    updateMany: async (args: UpdateManyCall) => {
      if (!matches(args.where)) return { count: 0 };
      for (const [key, value] of Object.entries(args.data)) {
        if (key === "stitchAttempts" && value && typeof value === "object" && "increment" in value) {
          state.stitchAttempts += (value as { increment: number }).increment;
        } else if (key in state) {
          (state as unknown as Record<string, unknown>)[key] = value;
        }
      }
      return { count: 1 };
    },
  });
}

function restitchingRow(status: FinalVideoStatus, token: string | null): MutableRow {
  return {
    id: "fv-1",
    status,
    stitchAttempts: 0,
    stitchAttemptToken: token,
    stitchedVideoUrl: OLD_URL,
    previousStitchedVideoUrl: OLD_URL,
    ffmpegError: null,
    thumbnailUrl: null,
    subtitleFileUrl: null,
    finishedAt: null,
  };
}

function forbidBriefWrites(t: TestContext) {
  patchModel(t, db.videoBrief, {
    update: async () => { throw new Error("回滚不得改 brief 状态"); },
    updateMany: async () => { throw new Error("回滚不得改 brief 状态"); },
  });
}

test("回滚边 ①：finishStitchTask 失败 → 回滚到 READY + 旧 URL，不落 FAILED，不碰 brief", async (t) => {
  const state = restitchingRow(FinalVideoStatus.STITCHING, "attempt-1");
  stateMachine(t, state, { brief: { id: "brief-1" } });
  forbidBriefWrites(t);

  /// 旧 token 的失败回调先被挡住（CAS 不动任何字段）
  const stale = await finishStitchTask({ finalVideoId: "fv-1", attemptToken: "stale", error: "late" });
  assert.equal(stale.conflict, true);
  assert.equal(state.status, FinalVideoStatus.STITCHING);

  const result = await finishStitchTask({ finalVideoId: "fv-1", attemptToken: "attempt-1", error: "ffmpeg exit 1" });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.equal(result.status, FinalVideoStatus.READY);
  assert.equal(result.stitchedVideoUrl, OLD_URL);
  assert.equal(state.status, FinalVideoStatus.READY);
  assert.equal(state.stitchedVideoUrl, OLD_URL);
  assert.equal(state.previousStitchedVideoUrl, null, "回滚后清掉回滚依据");
  assert.equal(state.stitchAttemptToken, null);
  assert.match(state.ffmpegError ?? "", /restitch failed: ffmpeg exit 1/);
});

test("成功：finishStitchTask 写新 URL 并清空 previousStitchedVideoUrl；已发布 brief 不打回 QA_PENDING、清空旧品牌封装", async (t) => {
  const state = restitchingRow(FinalVideoStatus.STITCHING, "attempt-2");
  stateMachine(t, state, { brief: { id: "brief-1" } });
  const briefUpdates: Array<{ data: Record<string, unknown> }> = [];
  patchModel(t, db.videoBrief, {
    findUnique: async () => ({
      finalVideoId: "fv-1",
      status: VideoBriefStatus.PUBLISHED,
      brandedVideoUrl: "https://abc.public.blob.vercel-storage.com/branded-old.mp4",
      finalVideo: { stitchedVideoUrl: state.stitchedVideoUrl, thumbnailUrl: state.thumbnailUrl },
    }),
    update: async (args: { data: Record<string, unknown> }) => { briefUpdates.push(args); return {}; },
  });
  patchModel(t, db.qAReview, {
    findFirst: async () => { throw new Error("已交付 brief 不该建 QA 桩"); },
    create: async () => { throw new Error("已交付 brief 不该建 QA 桩"); },
  });
  t.mock.method(console, "warn", () => undefined);

  const result = await finishStitchTask({ finalVideoId: "fv-1", attemptToken: "attempt-2", stitchedVideoUrl: NEW_URL });
  assert.equal(result.ok, true);
  assert.equal(state.status, FinalVideoStatus.READY);
  assert.equal(state.stitchedVideoUrl, NEW_URL);
  assert.equal(state.previousStitchedVideoUrl, null, "成功后不再需要回滚依据");
  assert.equal(briefUpdates.length, 1);
  assert.equal("status" in briefUpdates[0].data, false, "已发布 brief 状态不动");
  assert.equal(briefUpdates[0].data.finalVideoUrl, NEW_URL);
  assert.equal(briefUpdates[0].data.brandedVideoUrl, null, "旧封装作废，需要重新品牌封装");
});

test("成功：未交付（QA_PENDING）brief 仍走 QA_PENDING + QA 桩（原行为不变）", async (t) => {
  const state = restitchingRow(FinalVideoStatus.STITCHING, "attempt-3");
  stateMachine(t, state, { brief: { id: "brief-1" } });
  const briefUpdates: Array<{ data: Record<string, unknown> }> = [];
  let stubChecked = false;
  patchModel(t, db.videoBrief, {
    findUnique: async () => ({
      finalVideoId: "fv-1",
      status: VideoBriefStatus.QA_PENDING,
      brandedVideoUrl: null,
      finalVideo: { stitchedVideoUrl: state.stitchedVideoUrl, thumbnailUrl: null },
    }),
    update: async (args: { data: Record<string, unknown> }) => { briefUpdates.push(args); return {}; },
  });
  patchModel(t, db.qAReview, {
    findFirst: async () => { stubChecked = true; return { id: "qa-1" }; },
    update: async () => ({}),
    create: async () => { throw new Error("已有 PENDING 桩不该再建"); },
  });
  await finishStitchTask({ finalVideoId: "fv-1", attemptToken: "attempt-3", stitchedVideoUrl: NEW_URL });
  assert.equal(briefUpdates[0]?.data.status, VideoBriefStatus.QA_PENDING);
  assert.equal("brandedVideoUrl" in (briefUpdates[0]?.data ?? {}), false, "没封装过就不碰 brandedVideoUrl");
  assert.equal(stubChecked, true);
});

function emptySweepResult(): SweepResult {
  return {
    timedOutJobs: [], reconciledJobs: [], requeuedStitching: [], failedStitching: [],
    failedAwaitingStitch: [], rolledBackRestitch: [], failedOrphanFinalVideos: [], failedJoblessBriefs: [],
  };
}

test("回滚边 ②：清扫 STITCHING 超时达上限 → 回滚而不是 FAILED；普通行照旧 FAILED + brief RENDER_FAILED", async (t) => {
  withEnv(t, { SWEEP_STITCH_TIMEOUT_MIN: "30" });
  const stale = new Date(NOW.getTime() - 60 * 60_000);
  const restitch = { ...restitchingRow(FinalVideoStatus.STITCHING, "tok-a"), stitchAttempts: 2, startedAt: stale, updatedAt: stale, brief: { id: "brief-a" } };
  const plain = { ...restitchingRow(FinalVideoStatus.STITCHING, "tok-b"), id: "fv-2", previousStitchedVideoUrl: null, stitchAttempts: 2, startedAt: stale, updatedAt: stale, brief: { id: "brief-b" } };
  const updates: UpdateManyCall[] = [];
  patchModel(t, db.finalVideo, {
    findMany: async () => [restitch, plain],
    findUnique: async (args: { where: { id: string } }) => (args.where.id === "fv-1" ? { previousStitchedVideoUrl: OLD_URL } : { previousStitchedVideoUrl: null }),
    updateMany: async (args: UpdateManyCall) => { updates.push(args); return { count: 1 }; },
  });
  const briefUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  patchModel(t, db.videoBrief, { update: async (args: { where: { id: string }; data: Record<string, unknown> }) => { briefUpdates.push(args); return {}; } });
  t.mock.method(console, "warn", () => undefined);

  const result = emptySweepResult();
  await sweepTest.sweepStuckStitching(NOW, result);

  assert.deepEqual(result.rolledBackRestitch, ["fv-1"]);
  assert.deepEqual(result.failedStitching, ["fv-2"]);
  const rollback = updates.find((u) => u.where.id === "fv-1");
  assert.ok(rollback);
  assert.deepEqual(rollback.where, { id: "fv-1", previousStitchedVideoUrl: OLD_URL, status: { in: [FinalVideoStatus.STITCHING] }, stitchAttemptToken: "tok-a" });
  assert.equal(rollback.data.status, FinalVideoStatus.READY);
  assert.equal(rollback.data.stitchedVideoUrl, OLD_URL);
  assert.equal(rollback.data.previousStitchedVideoUrl, null);
  assert.match(String(rollback.data.ffmpegError), /sweep/);
  /// 只有普通行的 brief 被打成 RENDER_FAILED
  assert.deepEqual(briefUpdates.map((u) => u.where.id), ["brief-b"]);
  assert.equal(briefUpdates[0].data.status, VideoBriefStatus.RENDER_FAILED);
});

test("回滚边 ③：清扫等合成超时 → 回滚而不是 FAILED，不碰 brief", async (t) => {
  withEnv(t, { SWEEP_AWAIT_STITCH_TIMEOUT_MIN: "45" });
  const stale = new Date(NOW.getTime() - 2 * 60 * 60_000);
  const row = {
    ...restitchingRow(FinalVideoStatus.PENDING, null),
    segmentCount: 2,
    startedAt: stale,
    createdAt: stale,
    brief: { id: "brief-1" },
    segments: [
      { status: VideoJobStatus.SUCCEEDED, finishedAt: stale },
      { status: VideoJobStatus.SUCCEEDED, finishedAt: stale },
    ],
  };
  const updates: UpdateManyCall[] = [];
  patchModel(t, db.finalVideo, {
    findMany: async () => [row],
    findUnique: async () => ({ previousStitchedVideoUrl: OLD_URL }),
    updateMany: async (args: UpdateManyCall) => { updates.push(args); return { count: 1 }; },
  });
  forbidBriefWrites(t);
  t.mock.method(console, "warn", () => undefined);

  const result = emptySweepResult();
  await sweepTest.sweepAwaitingStitchTimeout(NOW, result);
  assert.deepEqual(result.rolledBackRestitch, ["fv-1"]);
  assert.deepEqual(result.failedAwaitingStitch, []);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].where, { id: "fv-1", previousStitchedVideoUrl: OLD_URL, status: { in: [FinalVideoStatus.PENDING] } });
  assert.equal(updates[0].data.status, FinalVideoStatus.READY);
  assert.equal(updates[0].data.stitchedVideoUrl, OLD_URL);
});

test("回滚边 ④：重拼中取消 = 回滚到旧片，不取消订单、不返还、不改 brief", async (t) => {
  const anyDb = db as unknown as Record<string, Record<string, unknown>>;
  patchModel(t, anyDb.deliveryOrder, {
    findFirst: async () => ({
      id: "order-1",
      rounds: [{ angles: [{ videoBrief: {
        id: "brief-1",
        finalVideoId: "fv-1",
        videoJobs: [{ id: "job-0", status: VideoJobStatus.SUCCEEDED }, { id: "job-1", status: VideoJobStatus.SUCCEEDED }],
        finalVideo: { status: FinalVideoStatus.STITCHING, previousStitchedVideoUrl: OLD_URL },
      } }] }],
    }),
    update: async () => { throw new Error("重拼中取消不得取消订单"); },
  });
  patchModel(t, db as unknown as object, { $transaction: async () => { throw new Error("没有可取消的任务，不该开事务"); } });
  const updates: UpdateManyCall[] = [];
  patchModel(t, db.finalVideo, {
    findUnique: async () => ({ previousStitchedVideoUrl: OLD_URL }),
    updateMany: async (args: UpdateManyCall) => { updates.push(args); return { count: 1 }; },
  });
  forbidBriefWrites(t);
  t.mock.method(console, "warn", () => undefined);
  const refunds: string[] = [];

  const result = await cancelUnifiedOrderForUser("user-1", "order-1", NOW, {
    refund: async (briefId) => { refunds.push(briefId); return "refunded"; },
  });
  assert.deepEqual(result, { ok: true, cancelledJobs: 0, refundedBriefs: 0, restitchRolledBack: 1 });
  assert.deepEqual(refunds, [], "成片一直都在，没有额度可返还");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].where.status, { in: [FinalVideoStatus.PENDING, FinalVideoStatus.STITCHING] });
  assert.equal(updates[0].data.status, FinalVideoStatus.READY);
  assert.equal(updates[0].data.stitchedVideoUrl, OLD_URL);
  assert.match(String(updates[0].data.ffmpegError), /已取消本次换字幕/);
});

test("rollbackRestitch：没有旧 URL 的行不是重拼，什么都不做", async (t) => {
  let touched = false;
  patchModel(t, db.finalVideo, {
    findUnique: async () => ({ previousStitchedVideoUrl: null }),
    updateMany: async () => { touched = true; return { count: 1 }; },
  });
  assert.deepEqual(await rollbackRestitch("fv-x", "why"), { rolledBack: false, stitchedVideoUrl: null });
  assert.equal(touched, false);
});

// ---------------------------------------------------------------------------
// 3. onAllSegmentsSucceeded：已交付 brief / 只重拼在途 不改成 RENDERING
// ---------------------------------------------------------------------------

test("onAllSegmentsSucceeded（经 syncBriefStatus）：已交付 brief 与只重拼在途不打回 RENDERING；普通待拼接仍 RENDERING", async (t) => {
  let brief: Record<string, unknown> = {
    id: "brief-1", finalVideoId: "fv-1", status: VideoBriefStatus.PUBLISHED, errorMessage: null,
    finalVideo: { previousStitchedVideoUrl: null },
  };
  const briefUpdates: Array<{ data: Record<string, unknown> }> = [];
  patchModel(t, db.videoBrief, {
    findUnique: async () => brief,
    update: async (args: { data: Record<string, unknown> }) => { briefUpdates.push(args); return {}; },
  });
  patchModel(t, db.videoJob, {
    findMany: async () => [
      { id: "job-0", status: VideoJobStatus.SUCCEEDED, submissionErrorClass: null },
      { id: "job-1", status: VideoJobStatus.SUCCEEDED, submissionErrorClass: null },
    ],
  });
  patchModel(t, db.finalVideo, { updateMany: async () => ({ count: 1 }) });

  await syncBriefStatus("brief-1");
  assert.equal(briefUpdates.length, 0, "PUBLISHED 不改成 RENDERING");

  brief = { ...brief, status: VideoBriefStatus.QA_PENDING, finalVideo: { previousStitchedVideoUrl: OLD_URL } };
  await syncBriefStatus("brief-1");
  assert.equal(briefUpdates.length, 0, "只重拼在途：brief 不动，失败会回滚、成功走 markBriefReady");

  brief = { ...brief, status: VideoBriefStatus.RENDER_QUEUED, finalVideo: { previousStitchedVideoUrl: null } };
  await syncBriefStatus("brief-1");
  assert.equal(briefUpdates.length, 1);
  assert.equal(briefUpdates[0].data.status, VideoBriefStatus.RENDERING, "首次拼接：原行为不变");
});

// ---------------------------------------------------------------------------
// 4. 路由 / 限流 / 成品库契约 / 详情页接线
// ---------------------------------------------------------------------------

const SESSION = {
  user: { id: "customer-1", email: "owner@shop.test", role: "CUSTOMER", userType: "PERSONAL" },
  expires: "2099-01-01T00:00:00.000Z",
};

function signInOwner(t: TestContext, finalVideoId: string | null) {
  authTest.resetAccountStatusCache();
  t.after(() => authTest.resetAccountStatusCache());
  patchModel(t, nextAuthRuntime, { getServerSession: async () => structuredClone(SESSION) });
  patchModel(t, db.adminUser, {
    findUnique: async () => ({ role: "CUSTOMER", userType: "PERSONAL", disabledAt: null, email: SESSION.user.email }),
  });
  patchModel(t, db.videoBrief, {
    findUnique: async () => ({
      id: "brief-1",
      persona: "PERSONAL",
      finalVideoId,
      contentAngle: { round: { deliveryOrder: { createdById: "customer-1" } } },
    }),
  });
}

function restitchRequest(body: unknown) {
  return renderRetry(
    new NextRequest("http://localhost/api/briefs/brief-1/render-retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "brief-1" }) },
  );
}

test("render-retry { restitch }：带口播 → 409 INVALID_STATE；空补丁 → 400 VALIDATION_FAILED；没成片 → 409", async (t) => {
  withEnv(t, { QUOTA_ENFORCE: "false" });
  signInOwner(t, "fv-1");
  forbidGeneration(t);

  const voiceover = await restitchRequest({ restitch: { voiceover: { enabled: false } } });
  assert.equal(voiceover.status, 409);
  assert.equal(((await voiceover.json()) as { code: string }).code, "INVALID_STATE");

  const empty = await restitchRequest({ restitch: {} });
  assert.equal(empty.status, 400);
  assert.equal(((await empty.json()) as { code: string }).code, "VALIDATION_FAILED");

  signInOwner(t, null);
  const noFinal = await restitchRequest({ restitch: { bgm: { trackId: "none", volume: 0 } } });
  assert.equal(noFinal.status, 409);
  assert.equal(((await noFinal.json()) as { code: string }).code, "INVALID_STATE");
});

test("接线：路由先限流（action restitch，不补扣额度）再重拼；quota-service 认识 restitch；详情页按 canRestitch 渲染表单", async () => {
  const route = await readFile("src/app/api/briefs/[id]/render-retry/route.ts", "utf8");
  const branch = route
    .slice(route.indexOf("if (body.restitch !== undefined) {"), route.indexOf("} else if (body.all === true) {"))
    .replace(/^\s*\/\/\/.*$/gm, "");
  assert.ok(branch.length > 0, "restitch 分支排在 all / jobId 之前");
  assert.match(branch, /assertAuthenticatedActionRateLimit\(\{\s*action: "restitch"/);
  assert.ok(branch.indexOf("assertAuthenticatedActionRateLimit") < branch.indexOf("restitchReadyFinalVideo("), "限流先于重拼");
  assert.doesNotMatch(branch, /rechargeIfRefunded/, "只重拼零生成计费，不补扣额度");

  const quota = await readFile("src/lib/services/quota-service.ts", "utf8");
  assert.match(quota, /restitch: \{\s*envKey: "RESTITCH_RATE_LIMIT_PER_HOUR"/);

  const page = await readFile("src/app/(platform)/app/library/[id]/page.tsx", "utf8");
  assert.match(page, /item\.canRestitch && item\.restitchDefaults \? \(\s*<RestitchForm/);
  const form = await readFile("src/components/library/restitch-form.tsx", "utf8");
  assert.match(form, /restitch: \{/);
  assert.doesNotMatch(form, /voiceover|voiceId/i, "表单不碰口播");
  assert.match(form, /tabular-nums/);
  assert.doesNotMatch(form, /#[0-9a-fA-F]{3,8}\b|backdrop-filter/, "颜色只来自 tokens");
});

test("成品库契约：canRestitch = READY + 有后期快照 + 不是直接复用某段原片；样片恒 false", () => {
  const base = {
    id: "order-1",
    title: "Blinds demo",
    createdAt: new Date("2026-10-26T10:00:00.000Z"),
    updatedAt: new Date("2026-10-26T11:00:00.000Z"),
    rounds: [{ angles: [{ videoBrief: {
      id: "brief-1", status: "QA_PENDING", durationSec: 15, aspectRatio: "9:16",
      finalVideoUrl: null, finalThumbnailUrl: null, brandedVideoUrl: null, takedownAt: null,
      createdAt: new Date("2026-10-26T10:01:00.000Z"), storyboardRun: null,
      finalVideo: { status: "READY", stitchedVideoUrl: OLD_URL, thumbnailUrl: null, subtitleFileUrl: null, segmentCount: 2, startedAt: null, finishedAt: null, postProduction: BASE_PLAN },
      videoJobs: [
        { status: "SUCCEEDED", lastProgress: 100, submittedAt: null, finishedAt: null, createdAt: null, outputVideoUrl: "https://abc.public.blob.vercel-storage.com/seg0.mp4" },
        { status: "SUCCEEDED", lastProgress: 100, submittedAt: null, finishedAt: null, createdAt: null, outputVideoUrl: "https://abc.public.blob.vercel-storage.com/seg1.mp4" },
      ],
    } }] }],
  };
  type Input = Parameters<typeof toUnifiedLibraryRow>[0];
  const fv = base.rounds[0].angles[0].videoBrief.finalVideo;
  const withFinal = (patch: Record<string, unknown>) => {
    const next = structuredClone(base) as unknown as { rounds: Array<{ angles: Array<{ videoBrief: { finalVideo: unknown } }> }> };
    next.rounds[0].angles[0].videoBrief.finalVideo = { ...fv, ...patch };
    return next as unknown as Input;
  };

  assert.equal(toUnifiedLibraryRow(base as unknown as Input)?.canRestitch, true);
  assert.equal(toUnifiedLibraryRow(base as unknown as Input, true)?.canRestitch, false, "样片只读");
  assert.equal(toUnifiedLibraryRow(withFinal({ status: "PENDING" }))?.canRestitch, false, "重拼中 / 待合成不能再改");
  assert.equal(toUnifiedLibraryRow(withFinal({ postProduction: null }))?.canRestitch, false, "没有后期快照");
  assert.equal(
    toUnifiedLibraryRow(withFinal({ stitchedVideoUrl: "https://abc.public.blob.vercel-storage.com/seg0.mp4" }))?.canRestitch,
    false,
    "成片 URL 就是某段原片 = 单段复用，没过合成器",
  );
  assert.deepEqual(restitchDefaultsFor(BASE_PLAN), { captions: BASE_PLAN.captions, bgm: BASE_PLAN.audio.bgm });
  assert.equal(restitchDefaultsFor({ broken: true }), null);
});
