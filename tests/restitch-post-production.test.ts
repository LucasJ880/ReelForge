import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, Prisma, VideoBriefStatus, VideoJobStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import { __test__ as authTest } from "../src/lib/auth";
import {
  claimStitchTask,
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
import { bgmAttributionFor } from "../src/lib/video-generation/bgm-attribution";
import type { PostProductionPlan } from "../src/types/video-generation";

/**
 * P05-B（链 T）只重拼：READY 成片换字幕样式 / BGM。
 *
 *   READY ──restitch──▶ PENDING ──claim──▶ STITCHING ──finish ok──▶ READY（新片）
 *     ▲                   │                   │
 *     │   等合成超时(sweep) │   合成失败 / STITCHING 超时达上限(sweep) / 取消
 *     └───────────────────┴───────────────────┘   rollbackRestitch → READY（旧片）
 *
 * 零生成计费；只放行 captions / bgm；三条回滚边全部回到 READY + 旧 URL + 旧后期快照（配乐署名随之复原），
 * 不碰 brief；已交付 brief 不打回 QA_PENDING / RENDERING；归档 / 弃用的不能重拼也不被改状态。
 * 全部 monkey-patch Prisma，不连库、不跑 ffmpeg。
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

/// 重拼写进去的新设置（配乐开了）；回滚后必须回到 BASE_PLAN（配乐关、无署名）
const MERGED_PLAN: PostProductionPlan = {
  audio: { voiceover: BASE_PLAN.audio.voiceover, bgm: { trackId: "wholesome", volume: 0.2 } },
  captions: { ...BASE_PLAN.captions, style: "word_by_word" },
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
    previousPostProduction: null,
    brief: { id: "brief-1", status: VideoBriefStatus.QA_PENDING },
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
  assert.deepEqual(reset.data.previousPostProduction, BASE_PLAN, "旧快照是回滚依据之二（#16 blocker 1）");
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

test("只重拼带上各段台词（P04-C）：external 认领载荷有 voiceoverChunks，进程内合成器自己从库读 directorPlan", async (t) => {
  withEnv(t, { STITCH_RUNTIME: "external", ENABLE_VIDEO_STITCHING: undefined });
  const directorPlan = {
    segmentPlan: [
      { segmentIndex: 1, voiceoverChunk: "第二段台词" },
      { segmentIndex: 0, voiceoverChunk: "第一段台词" },
    ],
  };
  let status: FinalVideoStatus = FinalVideoStatus.READY;
  let findManyInclude: Record<string, unknown> | undefined;
  patchModel(t, db.finalVideo, {
    findUnique: async () => readyFinalVideo({ status }),
    updateMany: async (args: UpdateManyCall) => {
      if (typeof args.data.status === "string") status = args.data.status as FinalVideoStatus;
      return { count: 1 };
    },
    /// 认领查询：带 directorPlan 的 brief（候选行形状），只在 PENDING 时有候选
    findMany: async (args: { include?: Record<string, unknown> }) => {
      findManyInclude = args.include;
      if (status !== FinalVideoStatus.PENDING) return [];
      return [readyFinalVideo({ status, brief: { aspectRatio: "9:16", directorPlan } })];
    },
  });
  patchModel(t, db.videoBrief, { findUnique: async () => ({ videoGenerationPlan: null }) });

  await restitchReadyFinalVideo("fv-1", { bgm: { trackId: "wholesome", volume: 0.2 } }, { now: NOW });
  assert.equal(status, FinalVideoStatus.PENDING);
  const claimed = await claimStitchTask();
  assert.ok(claimed, "重拼后的行可被认领");
  assert.deepEqual(claimed.voiceoverChunks, ["第一段台词", "第二段台词"], "runner 载荷带各段台词，字幕不退回均分");
  assert.deepEqual((findManyInclude?.brief as { select?: unknown })?.select, { aspectRatio: true, directorPlan: true });
  /// 进程内 / local：composeFinalVideoForStitch 自己 select brief.directorPlan（#10），重拼路径同样经过它
  const composer = await readFile("src/lib/services/stitch-composer.ts", "utf8");
  assert.match(composer, /directorPlan: true,/);
  assert.match(composer, /readDirectorPlanVoiceoverChunks\(fv\.brief\?\.directorPlan\)/);
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

test("段原片是临时签名地址 / brief 已归档：拒绝，不写库（#16 item 2 / 6）", async (t) => {
  withEnv(t, { STITCH_RUNTIME: "external" });
  const calls: UpdateManyCall[] = [];
  let row: Record<string, unknown> = readyFinalVideo({
    segments: [
      { segmentIndex: 0, status: VideoJobStatus.SUCCEEDED, outputVideoUrl: "https://tos.example.com/seg0.mp4?X-Tos-Expires=86400&X-Tos-Signature=abc", outputThumbUrl: null, assignedAssets: null },
      { segmentIndex: 1, status: VideoJobStatus.SUCCEEDED, outputVideoUrl: "https://abc.public.blob.vercel-storage.com/seg1.mp4", outputThumbUrl: null, assignedAssets: null },
    ],
  });
  patchModel(t, db.finalVideo, {
    findUnique: async () => row,
    updateMany: async (args: UpdateManyCall) => { calls.push(args); return { count: 1 }; },
  });
  patchModel(t, db.videoBrief, { findUnique: async () => ({ videoGenerationPlan: null }) });
  const patch = { bgm: { trackId: "wholesome" as const, volume: 0.2 } };
  await assert.rejects(restitchReadyFinalVideo("fv-1", patch), (err: unknown) =>
    err instanceof RestitchRejectedError && err.code === "INVALID_STATE" && /临时地址/.test(err.message));

  row = readyFinalVideo({ brief: { id: "brief-1", status: VideoBriefStatus.ARCHIVED } });
  await assert.rejects(restitchReadyFinalVideo("fv-1", patch), (err: unknown) =>
    err instanceof RestitchRejectedError && err.code === "INVALID_STATE" && /归档/.test(err.message));
  row = readyFinalVideo({ brief: { id: "brief-1", status: VideoBriefStatus.DROPPED } });
  await assert.rejects(restitchReadyFinalVideo("fv-1", patch), (err: unknown) =>
    err instanceof RestitchRejectedError && err.code === "INVALID_STATE");
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
  postProduction: unknown;
  previousPostProduction: unknown;
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
          /// Prisma.DbNull = 清空 JSON 列
          (state as unknown as Record<string, unknown>)[key] = value === Prisma.DbNull ? null : value;
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
    /// 重拼 CAS 之后的形态：新设置已写进 postProduction，旧快照在 previousPostProduction
    postProduction: MERGED_PLAN,
    previousPostProduction: BASE_PLAN,
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
  assert.deepEqual(state.postProduction, BASE_PLAN, "后期快照回到旧版（不是那套从没渲染成功的新设置）");
  assert.equal(state.previousPostProduction, null);
  assert.equal(bgmAttributionFor(state.postProduction), null, "配乐署名读数随快照复原（旧片没有配乐）");
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
  /// 已交付：不建 PENDING 桩；复检标记挂到最近一条（已 APPROVED 的）QAReview 上（#16 item 12）
  const reviewFinds: Array<Record<string, unknown>> = [];
  const reviewUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  patchModel(t, db.qAReview, {
    findFirst: async (args: Record<string, unknown>) => {
      reviewFinds.push(args);
      return { id: "qa-approved", status: "APPROVED", aiScoreBreakdown: { hook_quality: 9, finalFrameQa: { status: "ok", checkedAt: "t1" } }, aiIssues: ["[成片复检] 旧片问题", "人工备注"] };
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => { reviewUpdates.push(args); return {}; },
    create: async () => { throw new Error("已交付 brief 不该建 QA 桩"); },
  });
  const warned: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warned.push(args); });

  const result = await finishStitchTask({ finalVideoId: "fv-1", attemptToken: "attempt-2", stitchedVideoUrl: NEW_URL });
  assert.equal(result.ok, true);
  assert.equal(state.status, FinalVideoStatus.READY);
  assert.equal(state.stitchedVideoUrl, NEW_URL);
  assert.equal(state.previousStitchedVideoUrl, null, "成功后不再需要回滚依据");
  assert.equal(state.previousPostProduction, null, "两份回滚依据都清掉");
  assert.deepEqual(state.postProduction, MERGED_PLAN, "成功：新设置就是当前快照");
  assert.equal(briefUpdates.length, 1);
  assert.equal("status" in briefUpdates[0].data, false, "已发布 brief 状态不动");
  assert.equal(briefUpdates[0].data.finalVideoUrl, NEW_URL);
  assert.equal("brandedVideoUrl" in briefUpdates[0].data, false, "品牌封装指针保留（#16 item 9），只记日志");
  assert.ok(warned.some((args) => /需要重新品牌封装/.test(String(args[0]))), "日志提示需重新封装");
  assert.deepEqual((reviewFinds[0] as { orderBy?: unknown }).orderBy, { createdAt: "desc" }, "挂到最近一条 QAReview");
  assert.equal(reviewUpdates.length, 1);
  assert.equal(reviewUpdates[0].where.id, "qa-approved");
  const stamped = reviewUpdates[0].data.aiScoreBreakdown as Record<string, unknown>;
  assert.equal((stamped.finalFrameQa as { status: string }).status, "pending");
  assert.equal(stamped.hook_quality, 9, "打分不动");
  assert.deepEqual(reviewUpdates[0].data.aiIssues, ["人工备注"], "旧片的复检问题清掉，别人的保留");
});

test("成功：ARCHIVED brief 只刷新 URL，状态不动、不建桩、不挂标记（#16 item 6 白名单）", async (t) => {
  const state = restitchingRow(FinalVideoStatus.STITCHING, "attempt-archived");
  stateMachine(t, state, { brief: { id: "brief-1" } });
  const briefUpdates: Array<{ data: Record<string, unknown> }> = [];
  patchModel(t, db.videoBrief, {
    findUnique: async () => ({ finalVideoId: "fv-1", status: VideoBriefStatus.ARCHIVED, brandedVideoUrl: null, finalVideo: { stitchedVideoUrl: state.stitchedVideoUrl, thumbnailUrl: null } }),
    update: async (args: { data: Record<string, unknown> }) => { briefUpdates.push(args); return {}; },
  });
  patchModel(t, db.qAReview, {
    findFirst: async () => { throw new Error("归档 brief 不该碰 QAReview"); },
    create: async () => { throw new Error("归档 brief 不该碰 QAReview"); },
  });
  await finishStitchTask({ finalVideoId: "fv-1", attemptToken: "attempt-archived", stitchedVideoUrl: NEW_URL });
  assert.equal(briefUpdates.length, 1);
  assert.deepEqual(Object.keys(briefUpdates[0].data).sort(), ["finalThumbnailUrl", "finalVideoUrl"]);
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
    findUnique: async (args: { where: { id: string } }) =>
      args.where.id === "fv-1"
        ? { previousStitchedVideoUrl: OLD_URL, previousPostProduction: BASE_PLAN }
        : { previousStitchedVideoUrl: null, previousPostProduction: null },
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
  assert.deepEqual(rollback.data.postProduction, BASE_PLAN, "后期快照回到旧版");
  assert.equal(rollback.data.previousPostProduction, Prisma.DbNull);
  assert.equal(bgmAttributionFor(rollback.data.postProduction), null, "配乐署名随快照复原");
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
    findUnique: async () => ({ previousStitchedVideoUrl: OLD_URL, previousPostProduction: BASE_PLAN }),
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
  assert.deepEqual(updates[0].data.postProduction, BASE_PLAN, "后期快照回到旧版");
  assert.equal(bgmAttributionFor(updates[0].data.postProduction), null);
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
    findUnique: async () => ({ previousStitchedVideoUrl: OLD_URL, previousPostProduction: BASE_PLAN }),
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
  assert.deepEqual(updates[0].data.postProduction, BASE_PLAN, "后期快照回到旧版");
  assert.equal(bgmAttributionFor(updates[0].data.postProduction), null);
  assert.match(String(updates[0].data.ffmpegError), /已取消本次换字幕/);
});

test("rollbackRestitch：没有旧 URL 的行不是重拼，什么都不做", async (t) => {
  let touched = false;
  patchModel(t, db.finalVideo, {
    findUnique: async () => ({ previousStitchedVideoUrl: null, previousPostProduction: null }),
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
  /// #16 item 10：解析补丁 + 只读预检 → 限流 → 写入；没成（本请求内合成失败已回滚）→ 409
  assert.ok(branch.indexOf("prepareRestitch(") < branch.indexOf("assertAuthenticatedActionRateLimit"), "限流在补丁解析与状态预检之后");
  assert.ok(branch.indexOf("assertAuthenticatedActionRateLimit") < branch.indexOf("commitRestitch("), "限流先于写入");
  assert.match(branch, /if \(result\.rolledBack\) \{\s*throw new RestitchRejectedError\(\s*"INVALID_STATE"/);
  assert.doesNotMatch(branch, /rechargeIfRefunded/, "只重拼零生成计费，不补扣额度");
  const cancelRoute = await readFile("src/app/api/library/[id]/cancel/route.ts", "utf8");
  assert.match(cancelRoute, /restitchRolledBack: result\.restitchRolledBack \?\? 0/, "取消路由透传回滚条数");
  const service = await readFile("src/lib/services/stitch-service.ts", "utf8");
  assert.doesNotMatch(service.slice(service.indexOf("async function markBriefReady")), /brandedVideoUrl: null/, "不清空 brandedVideoUrl（#16 item 9）");

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
  const archived = structuredClone(base) as unknown as { rounds: Array<{ angles: Array<{ videoBrief: { status: string } }> }> };
  archived.rounds[0].angles[0].videoBrief.status = "ARCHIVED";
  assert.equal(toUnifiedLibraryRow(archived as unknown as Input)?.canRestitch, false, "归档的不能改成片（与 prepareRestitch 同一判据）");
  const ephemeral = structuredClone(base) as unknown as { rounds: Array<{ angles: Array<{ videoBrief: { videoJobs: Array<{ outputVideoUrl: string }> } }> }> };
  ephemeral.rounds[0].angles[0].videoBrief.videoJobs[1].outputVideoUrl = "https://tos.example.com/seg1.mp4?X-Tos-Expires=86400";
  assert.equal(toUnifiedLibraryRow(ephemeral as unknown as Input)?.canRestitch, false, "段原片是临时签名地址");
  assert.deepEqual(restitchDefaultsFor(BASE_PLAN), { captions: BASE_PLAN.captions, bgm: BASE_PLAN.audio.bgm });
  assert.equal(restitchDefaultsFor({ broken: true }), null);
});
