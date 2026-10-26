import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import {
  CRON_FRAME_QA_BUDGET,
  frameQaBudgetUsage,
  runWithFrameQaBudget,
} from "../src/lib/services/frame-qa-gate";
import {
  FINAL_FRAME_QA_BATCH,
  pendingFinalFrameQaWhere,
  referenceImageFromPlan,
  runPendingFinalFrameQa,
  type PendingFinalFrameQaRow,
} from "../src/lib/services/final-frame-qa-service";
import {
  decideFinalFrameVerdict,
  FINAL_FRAME_QA_SYSTEM,
  finalFrameQaMarkFromResult,
  runFinalFrameQa,
  type FinalFrameQaResult,
} from "../src/lib/video-generation/final-frame-qa";
import {
  pendingFinalFrameQaMark,
  readFinalFrameQaMark,
} from "../src/lib/video-generation/final-frame-qa-mark";
import { finishStitchTask } from "../src/lib/services/stitch-service";
import { createPollVideosHandler } from "../src/app/api/cron/poll-videos/route";

/**
 * P01-E（链 T）成片级复检（影子）：
 *   - 专用 prompt 放行后期字幕与尾卡 logo，只查假字 / 假字标 / 与首帧是否同一商品；
 *   - fail-open：vision 不可用 / 抽帧失败 / vision 出错 → skipped + 原因；
 *   - 成片 READY 建 QA 桩时写 finalFrameQa = pending；poll-videos 每次最多消费 2 条，结论合并写回。
 * 全部注入依赖，不下载、不跑 ffmpeg、不调 vision、不连库。
 */

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

const NOW = new Date("2026-10-26T12:00:00.000Z");
const FRAMES = ["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB", "data:image/jpeg;base64,CCC"];
const REF = "https://abc.public.blob.vercel-storage.com/product.jpg";

// ---------------------------------------------------------------------------
// 1. prompt 与纯判定
// ---------------------------------------------------------------------------

test("prompt：明确放行后期字幕与尾卡 logo，只查假字 / 假字标 / 同一商品", () => {
  assert.match(FINAL_FRAME_QA_SYSTEM, /must NOT be flagged:[\s\S]*captions \/ subtitles/);
  assert.match(FINAL_FRAME_QA_SYSTEM, /end card[\s\S]*brand logo/);
  assert.match(FINAL_FRAME_QA_SYSTEM, /fakeText/);
  assert.match(FINAL_FRAME_QA_SYSTEM, /fakeLabel/);
  assert.match(FINAL_FRAME_QA_SYSTEM, /productMismatch[\s\S]*FIRST image/);
  /// 不是段级门禁那句「画面零文字」
  assert.doesNotMatch(FINAL_FRAME_QA_SYSTEM, /ZERO burned-in text/);
});

test("判定：全部 false → ok；假字标 / 假字 → issues；同一商品只在带参考图时判", () => {
  const clean = decideFinalFrameVerdict(
    [{ index: 0, textContent: "一拧即开" }, { index: 1, textContent: "SunnyShutter" }],
    2, true, NOW,
  );
  assert.equal(clean.status, "ok");
  assert.deepEqual(clean.issues, []);
  assert.equal(clean.referenceUsed, true);

  const bad = decideFinalFrameVerdict(
    [{ index: 0, fakeLabel: true, textContent: "ISO 900l" }, { index: 2, fakeText: true }, { index: 1, productMismatch: true, note: "a mug instead of blinds" }],
    3, true, NOW,
  );
  assert.equal(bad.status, "issues");
  assert.deepEqual(bad.issues.map((i) => [i.frameIndex, i.kind]), [[0, "fake_label"], [2, "fake_text"], [1, "product_mismatch"]]);
  assert.match(bad.issues[0].detail, /假字标.*ISO 900l/);
  assert.match(bad.issues[2].detail, /与首帧参考图不是同一商品：a mug/);

  const noRef = decideFinalFrameVerdict([{ index: 0, productMismatch: true }], 1, false, NOW);
  assert.equal(noRef.status, "ok", "没有参考图就没有可比对象，productMismatch 忽略");
});

// ---------------------------------------------------------------------------
// 2. runFinalFrameQa：参考图放第一张；fail-open
// ---------------------------------------------------------------------------

test("runFinalFrameQa：参考图作为第一张送 vision，结论按视频帧数计", async () => {
  const sent: Array<{ images: string[]; user: string }> = [];
  const result = await runFinalFrameQa("https://abc.public.blob.vercel-storage.com/final.mp4", {
    firstFrameRef: REF,
    deps: {
      isVisionAvailable: () => true,
      sampleFrames: async () => FRAMES,
      analyze: async (images, _system, user) => {
        sent.push({ images, user });
        return { data: { frames: [{ index: 0 }, { index: 1, fakeLabel: true, textContent: "BEST SELLER" }, { index: 2 }] } } as never;
      },
      now: () => NOW,
    },
  });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].images, [REF, ...FRAMES]);
  assert.match(sent[0].user, /FIRST image is the reference/);
  assert.equal(result.status, "issues");
  assert.equal(result.frameCount, 3);
  assert.equal(result.referenceUsed, true);
  assert.deepEqual(result.issues.map((i) => i.kind), ["fake_label"]);
});

test("runFinalFrameQa fail-open：vision 不可用 / 抽帧失败 / vision 出错 → skipped + 原因，永不 throw", async () => {
  const unavailable = await runFinalFrameQa("https://x.test/v.mp4", {
    deps: { isVisionAvailable: () => false, sampleFrames: async () => { throw new Error("不该抽帧"); }, now: () => NOW },
  });
  assert.equal(unavailable.status, "skipped");
  assert.match(unavailable.skipReason ?? "", /vision 不可用/);

  const noFrames = await runFinalFrameQa("https://x.test/v.mp4", {
    deps: { isVisionAvailable: () => true, sampleFrames: async () => { throw new Error("下载成片失败 HTTP 403"); }, now: () => NOW },
  });
  assert.equal(noFrames.status, "skipped");
  assert.match(noFrames.skipReason ?? "", /下载成片失败 HTTP 403/);

  const visionDown = await runFinalFrameQa("https://x.test/v.mp4", {
    deps: {
      isVisionAvailable: () => true,
      sampleFrames: async () => FRAMES,
      analyze: async () => { throw new Error("429 rate limited"); },
      now: () => NOW,
    },
  });
  assert.equal(visionDown.status, "skipped");
  assert.match(visionDown.skipReason ?? "", /429/);

  const timedOut = await runFinalFrameQa("https://x.test/v.mp4", {
    deps: {
      isVisionAvailable: () => true,
      sampleFrames: () => new Promise(() => undefined),
      now: () => NOW,
      timeoutMs: 10,
    },
  });
  assert.equal(timedOut.status, "skipped");
  assert.match(timedOut.skipReason ?? "", /超时/);
});

// ---------------------------------------------------------------------------
// 3. 标记：建桩写 pending；结论合并写回
// ---------------------------------------------------------------------------

test("ensureQAPendingStub（stitch-service 这一份）：新桩带 finalFrameQa=pending；已有桩合并写回 pending 不擦打分", async (t) => {
  const state = {
    id: "fv-1", status: "STITCHING", stitchAttempts: 0, stitchAttemptToken: "tok",
    stitchedVideoUrl: null as string | null, previousStitchedVideoUrl: null, thumbnailUrl: null, ffmpegError: null,
    brief: { id: "brief-1" },
  };
  patchModel(t, db.finalVideo, {
    findUnique: async () => state,
    updateMany: async (args: { data: Record<string, unknown> }) => { Object.assign(state, args.data); return { count: 1 }; },
  });
  patchModel(t, db.videoBrief, {
    findUnique: async () => ({ finalVideoId: "fv-1", status: "QA_PENDING", brandedVideoUrl: null, finalVideo: { stitchedVideoUrl: "https://x.test/new.mp4", thumbnailUrl: null } }),
    update: async () => ({}),
  });
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  let existing: Record<string, unknown> | null = null;
  patchModel(t, db.qAReview, {
    findFirst: async () => existing,
    create: async (args: { data: Record<string, unknown> }) => { created.push(args.data); return {}; },
    update: async (args: { data: Record<string, unknown> }) => { updated.push(args.data); return {}; },
  });

  await finishStitchTask({ finalVideoId: "fv-1", attemptToken: "tok", stitchedVideoUrl: "https://x.test/new.mp4" });
  assert.equal(created.length, 1);
  const mark = readFinalFrameQaMark(created[0].aiScoreBreakdown);
  assert.equal(mark?.status, "pending");
  assert.ok(mark?.requestedAt);

  /// 只重拼换了成片：已有桩上带着 8 维打分与旧结论 → 重新挂 pending，打分原样
  state.status = "STITCHING"; state.stitchAttemptToken = "tok2";
  existing = { id: "qa-1", aiScoreBreakdown: { hook_quality: 8, finalFrameQa: { status: "ok", checkedAt: "t1" } }, aiIssues: ["旧"] };
  await finishStitchTask({ finalVideoId: "fv-1", attemptToken: "tok2", stitchedVideoUrl: "https://x.test/new2.mp4" });
  assert.equal(created.length, 1, "已有 PENDING 桩不再新建");
  assert.equal(updated.length, 1);
  const merged = updated[0].aiScoreBreakdown as Record<string, unknown>;
  assert.equal(merged.hook_quality, 8);
  assert.equal(readFinalFrameQaMark(merged)?.status, "pending");

  /// video-service 的旧单段副本不在本轮改
  const videoService = await readFile("src/lib/services/video-service.ts", "utf8");
  const copy = videoService.slice(videoService.indexOf("async function ensureQAPendingStub"));
  assert.match(copy.slice(0, 400), /data: \{ videoBriefId: briefId, status: "PENDING" \}/);
});

// ---------------------------------------------------------------------------
// 4. 消费者：每次 ≤2 条；预算共用；vision 不可用记 skipped；结论合并写回
// ---------------------------------------------------------------------------

function row(id: string, extra: Partial<PendingFinalFrameQaRow> = {}): PendingFinalFrameQaRow {
  return {
    id,
    aiScoreBreakdown: { hook_quality: 7, ...pendingFinalFrameQaMark(NOW) },
    aiIssues: ["旧问题"],
    videoBrief: {
      finalVideoUrl: null,
      videoGenerationPlan: { classifiedAssets: [{ inferredRole: "reference_image", url: "https://x.test/ref.jpg" }, { inferredRole: "product_image", url: REF }] },
      finalVideo: { stitchedVideoUrl: `https://abc.public.blob.vercel-storage.com/${id}.mp4` },
    },
    ...extra,
  };
}

test("消费者：每次最多 2 条（findPending 收到 limit 2、多给也只处理 2），结论合并写回并追加 [成片复检] 问题", async () => {
  const limits: number[] = [];
  const saved: Array<{ id: string; result: FinalFrameQaResult }> = [];
  const ran: Array<{ url: string; ref: string | null | undefined }> = [];
  const sweep = await runWithFrameQaBudget({ label: "test", ...CRON_FRAME_QA_BUDGET }, () =>
    runPendingFinalFrameQa(FINAL_FRAME_QA_BATCH, {
      findPending: async (limit) => { limits.push(limit); return [row("qa-1"), row("qa-2"), row("qa-3")]; },
      claim: async () => true,
      save: async (r, result) => { saved.push({ id: r.id, result }); },
      run: async (url, opts) => {
        ran.push({ url, ref: opts?.firstFrameRef });
        return decideFinalFrameVerdict([{ index: 0, fakeLabel: true, textContent: "NEW!" }], 6, true, NOW);
      },
      isVisionAvailable: () => true,
      now: () => NOW,
    }),
  );
  assert.deepEqual(limits, [2]);
  assert.equal(ran.length, 2, "cron 每次最多 2 条");
  assert.deepEqual(ran.map((r) => r.ref), [REF, REF], "参考图取 plan 里的 product_image");
  assert.deepEqual(sweep, { scanned: 2, checked: 2, issues: 2, skipped: 0, deferred: 0 });
  assert.deepEqual(saved.map((s) => s.id), ["qa-1", "qa-2"]);
});

test("消费者：vision 不可用 → 直接记 skipped + 原因，不占预算、不认领；预算用完 → 留在 pending", async () => {
  const saved: Array<{ id: string; result: FinalFrameQaResult }> = [];
  let claimed = 0;
  const sweep = await runWithFrameQaBudget({ label: "test", ...CRON_FRAME_QA_BUDGET }, async () => {
    const out = await runPendingFinalFrameQa(2, {
      findPending: async () => [row("qa-1")],
      claim: async () => { claimed += 1; return true; },
      save: async (r, result) => { saved.push({ id: r.id, result }); },
      run: async () => { throw new Error("不该跑"); },
      isVisionAvailable: () => false,
      now: () => NOW,
    });
    assert.equal(frameQaBudgetUsage()?.used, 0, "不占预算");
    return out;
  });
  assert.equal(claimed, 0);
  assert.deepEqual(sweep, { scanned: 1, checked: 0, issues: 0, skipped: 1, deferred: 0 });
  assert.equal(saved[0].result.status, "skipped");
  assert.match(saved[0].result.skipReason ?? "", /vision 不可用/);

  /// 预算耗尽（maxChecks 0）：什么都不写，下一轮再来
  const untouched = await runWithFrameQaBudget({ label: "test", maxChecks: 0, timeBudgetMs: 60_000 }, () =>
    runPendingFinalFrameQa(2, {
      findPending: async () => [row("qa-1"), row("qa-2")],
      claim: async () => { throw new Error("预算没了不该认领"); },
      save: async () => { throw new Error("预算没了不该写"); },
      run: async () => { throw new Error("不该跑"); },
      isVisionAvailable: () => true,
      now: () => NOW,
    }),
  );
  assert.deepEqual(untouched, { scanned: 2, checked: 0, issues: 0, skipped: 0, deferred: 2 });
});

test("消费者默认 save：合并写——保留 requestedAt 与 8 维打分，问题去重追加「[成片复检] …」", async (t) => {
  const updates: Array<{ data: Record<string, unknown> }> = [];
  patchModel(t, db.qAReview, {
    update: async (args: { data: Record<string, unknown> }) => { updates.push(args); return {}; },
    updateMany: async () => ({ count: 1 }),
  });
  await runWithFrameQaBudget({ label: "test", ...CRON_FRAME_QA_BUDGET }, () =>
    runPendingFinalFrameQa(1, {
      findPending: async () => [row("qa-1")],
      run: async () => decideFinalFrameVerdict([{ index: 2, fakeText: true, textContent: "曬" }], 6, true, NOW),
      isVisionAvailable: () => true,
      now: () => NOW,
    }),
  );
  assert.equal(updates.length, 1);
  const breakdown = updates[0].data.aiScoreBreakdown as Record<string, unknown>;
  assert.equal(breakdown.hook_quality, 7, "不覆盖打分");
  const mark = readFinalFrameQaMark(breakdown);
  assert.equal(mark?.status, "issues");
  assert.equal(mark?.requestedAt, NOW.toISOString(), "requestedAt 保留");
  assert.equal(mark?.checkedAt, NOW.toISOString());
  assert.deepEqual(updates[0].data.aiIssues, ["旧问题", "[成片复检] 第3帧 检测到假字 / 畸形字形「曬」"]);
});

test("where：按 JSON 路径取 pending，或 checking 且租期已过；参考图优先用户指定角色", () => {
  const where = pendingFinalFrameQaWhere(NOW);
  assert.equal(where.status, "PENDING");
  assert.deepEqual((where.OR as unknown[])[0], { aiScoreBreakdown: { path: ["finalFrameQa", "status"], equals: "pending" } });
  assert.equal(referenceImageFromPlan({ classifiedAssets: [{ inferredRole: "product_image", userAssignedRole: "logo", url: "https://x.test/logo.png" }, { inferredRole: "reference_image", userAssignedRole: "product_image", url: REF }] }), REF);
  assert.equal(referenceImageFromPlan(null), null);
  assert.equal(finalFrameQaMarkFromResult(decideFinalFrameVerdict([], 6, false, NOW)).status, "ok");
});

test("poll-videos：成片级复检作为注入依赖跟在轮询 / 清扫之后，limit 2，响应回显；它挂了只算 degraded", async () => {
  const limits: number[] = [];
  const base = {
    machineAuthFailure: () => null,
    startSchedulerHeartbeat: (() => ({ finish: (status: string) => ({ status }) })) as never,
    pollRunningJobs: async () => ({ polled: 0, updated: 0 }) as never,
    pollPendingProductImageJobs: async () => ({ polled: 0, recovered: 0 }) as never,
    pollPendingStoryboardRuns: async () => 0 as never,
    pollPendingContentPostRenders: async () => 0 as never,
    sweepStuckTasks: async () => ({}) as never,
  };
  const ok = createPollVideosHandler({
    ...base,
    runPendingFinalFrameQa: async (limit?: number) => {
      limits.push(limit ?? -1);
      assert.equal(frameQaBudgetUsage()?.label, "cron:poll-videos", "跑在同一份预算上下文里");
      return { scanned: 1, checked: 1, issues: 0, skipped: 0, deferred: 0 };
    },
  });
  const body = (await (await ok(new NextRequest("http://localhost/api/cron/poll-videos"))).json()) as Record<string, unknown>;
  assert.deepEqual(limits, [2]);
  assert.deepEqual(body.finalFrameQa, { scanned: 1, checked: 1, issues: 0, skipped: 0, deferred: 0 });
  assert.equal(body.degraded, false);

  const down = createPollVideosHandler({
    ...base,
    runPendingFinalFrameQa: async () => { throw new Error("db hiccup"); },
  });
  const degraded = (await (await down(new NextRequest("http://localhost/api/cron/poll-videos"))).json()) as Record<string, unknown>;
  assert.equal(degraded.degraded, true);
  assert.match(String(degraded.finalFrameQaError), /db hiccup/);
});
