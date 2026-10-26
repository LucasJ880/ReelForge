import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import {
  CRON_FRAME_QA_BUDGET,
  frameQaBudgetUsage,
  noteFrameQaVisionFailure,
  runWithFrameQaBudget,
} from "../src/lib/services/frame-qa-gate";
import {
  buildFinalFrameQaWrite,
  FINAL_FRAME_QA_BATCH,
  FINAL_FRAME_QA_MAX_ATTEMPTS,
  finalFrameQaMode,
  pendingFinalFrameQaWhere,
  referenceImageFromPlan,
  runPendingFinalFrameQa,
  type FinalFrameQaClaim,
  type FinalFrameQaWrite,
  type PendingFinalFrameQaRow,
} from "../src/lib/services/final-frame-qa-service";
import { FINAL_FRAME_QA_ISSUE_PREFIX } from "../src/lib/services/qa-review-merge";
import {
  decideFinalFrameVerdict,
  FINAL_FRAME_QA_SYSTEM,
  finalFrameQaMarkFromResult,
  runFinalFrameQa,
} from "../src/lib/video-generation/final-frame-qa";
import {
  pendingFinalFrameQaMark,
  readFinalFrameQaMark,
  type FinalFrameQaMark,
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
  assert.equal(timedOut.retryable, true, "超时是瞬时原因，消费者可重排");
  assert.equal(visionDown.retryable, undefined, "vision 报错不算瞬时原因");
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
  existing = { id: "qa-1", aiScoreBreakdown: { hook_quality: 8, finalFrameQa: { status: "ok", checkedAt: "t1" } }, aiIssues: ["旧", "[成片复检] 第1帧 旧片的假字"] };
  await finishStitchTask({ finalVideoId: "fv-1", attemptToken: "tok2", stitchedVideoUrl: "https://x.test/new2.mp4" });
  assert.equal(created.length, 1, "已有 PENDING 桩不再新建");
  assert.equal(updated.length, 1);
  const merged = updated[0].aiScoreBreakdown as Record<string, unknown>;
  assert.equal(merged.hook_quality, 8);
  assert.equal(readFinalFrameQaMark(merged)?.status, "pending");
  assert.deepEqual(readFinalFrameQaMark(merged), readFinalFrameQaMark(merged) && { status: "pending", requestedAt: readFinalFrameQaMark(merged)?.requestedAt }, "整体覆盖 finalFrameQa 对象，旧结论不残留");
  assert.deepEqual(updated[0].aiIssues, ["旧"], "上一版成片的「[成片复检]」问题被清掉，别人的问题保留");

  /// video-service 的旧单段副本不在本轮改
  const videoService = await readFile("src/lib/services/video-service.ts", "utf8");
  const copy = videoService.slice(videoService.indexOf("async function ensureQAPendingStub"));
  assert.match(copy.slice(0, 400), /data: \{ videoBriefId: briefId, status: "PENDING" \}/);
});

// ---------------------------------------------------------------------------
// 4. 消费者：开关 / 让路 / 每次 ≤2 条 / 认领凭证 / 原子落库 / 超时重排
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

const CLAIM_MS = NOW.getTime();

/// 内存版 claim / saveClaimed：凭证 = 认领时刻；saveClaimed 把 build(prior) 的结果记下来
function memoryStore(saved: Array<{ id: string; write: FinalFrameQaWrite }>) {
  return {
    claim: async (r: PendingFinalFrameQaRow): Promise<FinalFrameQaClaim | null> => ({
      checkingAtMs: CLAIM_MS,
      videoUrl: r.videoBrief?.finalVideo?.stitchedVideoUrl ?? "",
    }),
    saveClaimed: async (r: PendingFinalFrameQaRow, _claim: FinalFrameQaClaim, build: (prior: FinalFrameQaMark | null) => FinalFrameQaWrite) => {
      saved.push({ id: r.id, write: build(readFinalFrameQaMark(r.aiScoreBreakdown)) });
      return true;
    },
    saveUnclaimed: async (r: PendingFinalFrameQaRow, write: FinalFrameQaWrite) => {
      saved.push({ id: r.id, write });
      return true;
    },
  };
}

test("开关：FINAL_FRAME_QA_MODE 默认 off（不查库、不跑）；只有 shadow 才消费", async (t) => {
  assert.equal(finalFrameQaMode({}), "off");
  assert.equal(finalFrameQaMode({ FINAL_FRAME_QA_MODE: "shadow" }), "shadow");
  assert.equal(finalFrameQaMode({ FINAL_FRAME_QA_MODE: "on" }), "off", "只认 shadow，别的值一律 off");
  let queried = false;
  const off = await runPendingFinalFrameQa(2, {
    mode: () => "off",
    findPending: async () => { queried = true; return [row("qa-1")]; },
  });
  assert.deepEqual(off, { mode: "off", scanned: 0, checked: 0, issues: 0, skipped: 0, deferred: 0, requeued: 0 });
  assert.equal(queried, false);
  t.diagnostic("shadow 路径由下面的用例覆盖");
});

test("让路：本轮段级门禁有 deferred 或 vision 报错 → 整轮跳过，不查库", async () => {
  let queried = 0;
  const deferred = await runPendingFinalFrameQa(2, {
    mode: () => "shadow",
    budgetUsage: () => ({ deferred: 1, visionFailures: 0 }),
    findPending: async () => { queried += 1; return []; },
  });
  assert.equal(deferred.skippedRound, "segment_gate_deferred");
  const visionDown = await runPendingFinalFrameQa(2, {
    mode: () => "shadow",
    budgetUsage: () => ({ deferred: 0, visionFailures: 2 }),
    findPending: async () => { queried += 1; return []; },
  });
  assert.equal(visionDown.skippedRound, "segment_gate_vision_failed");
  assert.equal(queried, 0);
  /// 预算上下文里记 vision 失败的钩子
  await runWithFrameQaBudget({ label: "t", ...CRON_FRAME_QA_BUDGET }, async () => {
    noteFrameQaVisionFailure();
    assert.equal(frameQaBudgetUsage()?.visionFailures, 1);
  });
});

test("消费者：每次最多 2 条（findPending 收到 limit 2、多给也只处理 2），结论按归属落回并追加 [成片复检] 问题", async () => {
  const limits: number[] = [];
  const saved: Array<{ id: string; write: FinalFrameQaWrite }> = [];
  const ran: Array<{ url: string; ref: string | null | undefined }> = [];
  const sweep = await runWithFrameQaBudget({ label: "test", ...CRON_FRAME_QA_BUDGET }, () =>
    runPendingFinalFrameQa(FINAL_FRAME_QA_BATCH, {
      mode: () => "shadow",
      ...memoryStore(saved),
      findPending: async (limit) => { limits.push(limit); return [row("qa-1"), row("qa-2"), row("qa-3")]; },
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
  assert.deepEqual(sweep, { mode: "shadow", scanned: 2, checked: 2, issues: 2, skipped: 0, deferred: 0, requeued: 0 });
  assert.deepEqual(saved.map((s) => s.id), ["qa-1", "qa-2"]);
  assert.equal(saved[0].write.mark.status, "issues");
  assert.equal(saved[0].write.mark.requestedAt, NOW.toISOString(), "requestedAt 从上一版标记带过来");
  assert.deepEqual(saved[0].write.issues, ["第1帧 检测到假字标（模型画上去的标签 / 徽章 / 价签）「NEW!」"]);
});

test("消费者：vision 不可用 → 不认领、不占预算，走 saveUnclaimed 记 skipped + 原因；预算用完 → 留在 pending", async () => {
  const saved: Array<{ id: string; write: FinalFrameQaWrite }> = [];
  let claimed = 0;
  const sweep = await runWithFrameQaBudget({ label: "test", ...CRON_FRAME_QA_BUDGET }, async () => {
    const out = await runPendingFinalFrameQa(2, {
      mode: () => "shadow",
      ...memoryStore(saved),
      claim: async () => { claimed += 1; return { checkingAtMs: CLAIM_MS, videoUrl: "x" }; },
      findPending: async () => [row("qa-1")],
      run: async () => { throw new Error("不该跑"); },
      isVisionAvailable: () => false,
      now: () => NOW,
    });
    assert.equal(frameQaBudgetUsage()?.used, 0, "不占预算");
    return out;
  });
  assert.equal(claimed, 0);
  assert.equal(sweep.skipped, 1);
  assert.equal(saved[0].write.mark.status, "skipped");
  assert.match(saved[0].write.mark.skipReason ?? "", /vision 不可用/);

  const untouched = await runWithFrameQaBudget({ label: "test", maxChecks: 0, timeBudgetMs: 60_000 }, () =>
    runPendingFinalFrameQa(2, {
      mode: () => "shadow",
      findPending: async () => [row("qa-1"), row("qa-2")],
      claim: async () => { throw new Error("预算没了不该认领"); },
      saveClaimed: async () => { throw new Error("预算没了不该写"); },
      saveUnclaimed: async () => { throw new Error("预算没了不该写"); },
      run: async () => { throw new Error("不该跑"); },
      isVisionAvailable: () => true,
      now: () => NOW,
    }),
  );
  assert.deepEqual(untouched, { mode: "shadow", scanned: 2, checked: 0, issues: 0, skipped: 0, deferred: 2, requeued: 0 });
});

test("超时重排：瞬时失败在次数内回到 pending（attempts+1），到上限改记 skipped 放弃", async () => {
  const timeout = { status: "skipped" as const, issues: [], checkedAt: NOW.toISOString(), frameCount: 0, skipReason: "复检超时（>45s）", retryable: true, referenceUsed: false };
  const first = buildFinalFrameQaWrite({ status: "checking", requestedAt: "t0" }, timeout, NOW);
  assert.equal(first.requeued, true);
  assert.deepEqual(first.mark, { status: "pending", requestedAt: "t0", attempts: 1 });
  const last = buildFinalFrameQaWrite({ status: "checking", requestedAt: "t0", attempts: FINAL_FRAME_QA_MAX_ATTEMPTS - 1 }, timeout, NOW);
  assert.equal(last.requeued, false);
  assert.equal(last.mark.status, "skipped");
  assert.equal(last.mark.attempts, FINAL_FRAME_QA_MAX_ATTEMPTS);
  assert.match(last.mark.skipReason ?? "", /放弃/);
  /// 非瞬时的 skipped（vision 报错）不重排
  const hard = buildFinalFrameQaWrite(null, { ...timeout, retryable: undefined, skipReason: "复检执行异常：429" }, NOW);
  assert.equal(hard.requeued, false);
  assert.equal(hard.mark.status, "skipped");

  const saved: Array<{ id: string; write: FinalFrameQaWrite }> = [];
  const sweep = await runWithFrameQaBudget({ label: "test", ...CRON_FRAME_QA_BUDGET }, () =>
    runPendingFinalFrameQa(1, {
      mode: () => "shadow",
      ...memoryStore(saved),
      findPending: async () => [row("qa-1")],
      run: async () => timeout,
      isVisionAvailable: () => true,
      now: () => NOW,
    }),
  );
  assert.equal(sweep.requeued, 1);
  assert.equal(sweep.skipped, 0);
  assert.equal(saved[0].write.mark.status, "pending");
});

test("默认 claim / saveClaimed：事务里重读，凭证不符或成片已换就不写；相符才按归属合并写回", async (t) => {
  const claims: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  patchModel(t, db.qAReview, {
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => { claims.push(args); return { count: 1 }; },
  });
  const writes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  let fresh: Record<string, unknown> = {};
  patchModel(t, db as unknown as object, {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        qAReview: {
          findUnique: async () => fresh,
          updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => { writes.push(args); return { count: 1 }; },
        },
      }),
  });
  const base = row("qa-1", { aiIssues: ["旧问题", `${FINAL_FRAME_QA_ISSUE_PREFIX} 上一版的问题`] });
  const run = (freshRow: Record<string, unknown>) => {
    fresh = freshRow;
    return runWithFrameQaBudget({ label: "test", ...CRON_FRAME_QA_BUDGET }, () =>
      runPendingFinalFrameQa(1, {
        mode: () => "shadow",
        findPending: async () => [base],
        run: async () => decideFinalFrameVerdict([{ index: 2, fakeText: true, textContent: "曬" }], 6, true, NOW),
        isVisionAvailable: () => true,
        now: () => NOW,
      }),
    );
  };

  /// 认领 CAS：pending → checking，带认领时刻
  const checking = { ...base, aiScoreBreakdown: { hook_quality: 7, finalFrameQa: { status: "checking", requestedAt: NOW.toISOString(), checkingAtMs: NOW.getTime() } } };
  const ok = await run(checking);
  assert.equal(ok.checked, 1);
  assert.deepEqual(claims[0].where, { id: "qa-1", aiScoreBreakdown: { path: ["finalFrameQa", "status"], equals: "pending" } });
  assert.equal(readFinalFrameQaMark(claims[0].data.aiScoreBreakdown)?.status, "checking");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].where, { id: "qa-1", aiScoreBreakdown: { path: ["finalFrameQa", "checkingAtMs"], equals: NOW.getTime() } });
  const breakdown = writes[0].data.aiScoreBreakdown as Record<string, unknown>;
  assert.equal(breakdown.hook_quality, 7, "不覆盖打分");
  const mark = readFinalFrameQaMark(breakdown);
  assert.equal(mark?.status, "issues");
  assert.equal(mark?.requestedAt, NOW.toISOString(), "requestedAt 保留");
  assert.deepEqual(writes[0].data.aiIssues, ["旧问题", `${FINAL_FRAME_QA_ISSUE_PREFIX} 第3帧 检测到假字 / 畸形字形「曬」`], "旧复检问题整体替换，别人的问题保留");

  /// 凭证不符（别的调用接手）→ 不写
  writes.length = 0;
  const stolen = await run({ ...checking, aiScoreBreakdown: { finalFrameQa: { status: "checking", checkingAtMs: NOW.getTime() + 1 } } });
  assert.equal(writes.length, 0);
  assert.equal(stolen.deferred, 1);

  /// 成片已换（只重拼成功后重新挂 pending）→ 不写
  const swapped = await run({ ...checking, videoBrief: { ...base.videoBrief, finalVideo: { stitchedVideoUrl: "https://abc.public.blob.vercel-storage.com/new.mp4" } } });
  assert.equal(writes.length, 0);
  assert.equal(swapped.deferred, 1);
});

test("where：按 JSON 路径取 pending，或 checking 且租期已过；不限 QAReview.status；参考图优先用户指定角色", () => {
  const where = pendingFinalFrameQaWhere(NOW);
  assert.equal("status" in where, false, "已交付 brief 的标记挂在 APPROVED 行上");
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
  const sweep = { mode: "shadow" as const, scanned: 1, checked: 1, issues: 0, skipped: 0, deferred: 0, requeued: 0 };
  const ok = createPollVideosHandler({
    ...base,
    runPendingFinalFrameQa: async (limit?: number) => {
      limits.push(limit ?? -1);
      assert.equal(frameQaBudgetUsage()?.label, "cron:poll-videos", "跑在同一份预算上下文里");
      return sweep;
    },
  });
  const body = (await (await ok(new NextRequest("http://localhost/api/cron/poll-videos"))).json()) as Record<string, unknown>;
  assert.deepEqual(limits, [2]);
  assert.deepEqual(body.finalFrameQa, sweep);
  assert.equal(body.degraded, false);

  const down = createPollVideosHandler({
    ...base,
    runPendingFinalFrameQa: async () => { throw new Error("db hiccup"); },
  });
  const degraded = (await (await down(new NextRequest("http://localhost/api/cron/poll-videos"))).json()) as Record<string, unknown>;
  assert.equal(degraded.degraded, true);
  assert.match(String(degraded.finalFrameQaError), /db hiccup/);
});
