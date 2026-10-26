import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";

import { db } from "../src/lib/db";
import {
  CRON_FRAME_QA_BUDGET,
  reserveStoryboardReviewBudget,
  runWithFrameQaBudget,
  type FrameQaBudgetOptions,
} from "../src/lib/services/frame-qa-gate";
import {
  aiReviewRegenerationDirection,
  readAiReviewSummary,
  readFrameAiReview,
  STORYBOARD_AI_REVIEW_FALLBACK_MS,
  STORYBOARD_AI_REVIEW_MAX_REGENS_PER_FRAME,
  storyboardAiReviewMode,
  storyboardAiReviewProgress,
  storyboardProviderAttempts,
} from "../src/lib/video-generation/storyboard-ai-review";
import {
  genericJudgeSystem,
  parseStoryboardFrameReview,
  reviewStoryboardFrames,
  type StoryboardFrameReviewResult,
} from "../src/lib/video-generation/storyboard-gacha";
import {
  __test__ as storyboardServiceTest,
  regenerateStoryboardFrame,
  reviewAutoStoryboardRun,
  shadowReviewStoryboardRun,
  storyboardRunView,
} from "../src/lib/video-generation/storyboard-service";

/**
 * P01-D · 批量故事板 AI 审帧（D-1 三档 off|shadow|block，默认 off）。
 *
 * 全部用内存假库 + 注入的审帧函数，不触真实 DB、不调 OpenAI / Shuyu，零计费。
 * 「API 单条 AUTO」= videoJobId 为空的 AUTO run（cron poll-videos 一路审）。
 */

type Row = Record<string, unknown>;

function matches(row: Row, where: Row | undefined, store: FakeStore): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (key === "AND") {
      if (!(condition as Row[]).every((part) => matches(row, part, store))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(condition as Row[]).some((part) => matches(row, part, store))) return false;
      continue;
    }
    if (key === "storyboardRun") {
      const run = store.runs.get(row.storyboardRunId as string);
      if (!run || !matches(run, condition as Row, store)) return false;
      continue;
    }
    const value = row[key];
    if (condition instanceof Date) {
      if (!(value instanceof Date) || value.getTime() !== condition.getTime()) return false;
      continue;
    }
    if (condition !== null && typeof condition === "object") {
      const ops = condition as Row;
      if ("in" in ops && !(ops.in as unknown[]).includes(value)) return false;
      if ("not" in ops && value === ops.not) return false;
      continue;
    }
    if ((value ?? null) !== condition) return false;
  }
  return true;
}

interface FakeStore {
  runs: Map<string, Row>;
  frames: Map<string, Row>;
  tick: number;
}

function installFakeDb(t: TestContext, store: FakeStore) {
  const runModel = db.storyboardRun as unknown as Row;
  const frameModel = db.storyboardFrame as unknown as Row;
  const client = db as unknown as Row;
  const originals = {
    runFindFirst: runModel.findFirst,
    runUpdateMany: runModel.updateMany,
    frameFindFirst: frameModel.findFirst,
    frameFindUnique: frameModel.findUnique,
    frameUpdateMany: frameModel.updateMany,
    frameCreate: frameModel.create,
    transaction: client.$transaction,
  };
  t.after(() => {
    runModel.findFirst = originals.runFindFirst;
    runModel.updateMany = originals.runUpdateMany;
    frameModel.findFirst = originals.frameFindFirst;
    frameModel.findUnique = originals.frameFindUnique;
    frameModel.updateMany = originals.frameUpdateMany;
    frameModel.create = originals.frameCreate;
    client.$transaction = originals.transaction;
  });
  const bump = () => new Date(Date.UTC(2026, 9, 26, 12, 0, 0) + ++store.tick * 1000);
  const currentFrames = (runId: string) =>
    [...store.frames.values()]
      .filter((frame) => frame.storyboardRunId === runId && frame.isCurrent)
      .sort((a, b) => (a.ordinal as number) - (b.ordinal as number))
      .map((frame) => ({ ...frame }));
  const withRun = (frame: Row) => {
    const run = store.runs.get(frame.storyboardRunId as string)!;
    return { ...frame, storyboardRun: { ...run, frames: currentFrames(run.id as string) } };
  };
  runModel.findFirst = async (args: { where: Row }) => {
    const run = [...store.runs.values()].find((row) => matches(row, args.where, store));
    return run ? { ...run, frames: currentFrames(run.id as string) } : null;
  };
  runModel.updateMany = async (args: { where: Row; data: Row }) => {
    let count = 0;
    for (const run of store.runs.values()) {
      if (!matches(run, args.where, store)) continue;
      Object.assign(run, JSON.parse(JSON.stringify(args.data, (_k, v) => v)), { updatedAt: bump() });
      for (const [key, value] of Object.entries(args.data)) {
        if (value instanceof Date || value === null) run[key] = value;
      }
      count += 1;
    }
    return { count };
  };
  frameModel.findFirst = async (args: { where: Row }) => {
    const frame = [...store.frames.values()].find((row) => matches(row, args.where, store));
    return frame ? withRun(frame) : null;
  };
  frameModel.findUnique = async (args: { where: { id: string } }) => {
    const frame = store.frames.get(args.where.id);
    return frame ? withRun(frame) : null;
  };
  frameModel.updateMany = async (args: { where: Row; data: Row }) => {
    let count = 0;
    for (const frame of store.frames.values()) {
      if (!matches(frame, args.where, store)) continue;
      Object.assign(frame, args.data, { updatedAt: bump() });
      count += 1;
    }
    return { count };
  };
  frameModel.create = async (args: { data: Row }) => {
    const id = `frame-${store.frames.size + 1}`;
    const row: Row = {
      status: "QUEUED",
      submissionState: "NOT_STARTED",
      externalTaskId: null,
      outputUrl: null,
      outputAsset: null,
      aiReview: null,
      planId: null,
      ...args.data,
      id,
      updatedAt: bump(),
    };
    store.frames.set(id, row);
    return { ...row };
  };
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
}

function seedRun(store: FakeStore, overrides: Row = {}, frameOverrides: Record<number, Row> = {}): string {
  const runId = (overrides.id as string) ?? "run-1";
  store.runs.set(runId, {
    id: runId,
    userId: "owner-1",
    status: "GENERATING",
    approvalPolicy: "AUTO",
    durationSec: 15,
    aspectRatio: "9:16",
    purpose: "api-storyboard",
    sourcePrompt: "Show the folding bowl on a park lawn",
    inputAssetIds: [],
    inputImageUrls: ["https://assets.example.test/product.jpg"],
    personAssetIds: [],
    anchorCutoutUrls: [],
    aiReviewSummary: null,
    videoJobId: null,
    videoBriefId: null,
    dispatchReservationKey: null,
    approvedAt: null,
    errorCode: null,
    errorMessage: null,
    updatedAt: new Date(Date.UTC(2026, 9, 26, 12, 0, 0)),
    ...overrides,
  });
  for (let ordinal = 0; ordinal < 4; ordinal += 1) {
    const id = `${runId}-f${ordinal}`;
    store.frames.set(id, {
      id,
      storyboardRunId: runId,
      ordinal,
      attempt: 1,
      isCurrent: true,
      beat: `beat-${ordinal}`,
      prompt: `prompt-${ordinal}`,
      status: "SUCCEEDED",
      submissionState: "ACCEPTED",
      lastProviderStatus: "success",
      externalTaskId: `ext-${id}`,
      providerRequestKey: `storyboard:${runId}:frame:${ordinal}:attempt:1`,
      outputUrl: `https://assets.example.test/${id}.png`,
      outputAsset: null,
      inputAssetIds: [],
      inputImageUrls: [],
      aiReview: null,
      errorCode: null,
      errorMessage: null,
      ...(frameOverrides[ordinal] ?? {}),
    });
  }
  return runId;
}

function newStore(): FakeStore {
  return { runs: new Map(), frames: new Map(), tick: 0 };
}

function setMode(t: TestContext, mode: string | undefined) {
  const previous = process.env.STORYBOARD_AI_REVIEW;
  if (mode === undefined) delete process.env.STORYBOARD_AI_REVIEW;
  else process.env.STORYBOARD_AI_REVIEW = mode;
  t.after(() => {
    if (previous === undefined) delete process.env.STORYBOARD_AI_REVIEW;
    else process.env.STORYBOARD_AI_REVIEW = previous;
  });
}

function allPass(frameUrls: string[]): StoryboardFrameReviewResult {
  return {
    checked: true,
    frames: frameUrls.map((_, index) => ({ index, pass: true, score: 8, issues: "" })),
    note: "all pass",
  };
}

function installRuntime(
  t: TestContext,
  options: {
    review?: (args: { frameUrls: string[] }) => Promise<StoryboardFrameReviewResult>;
    visionAvailable?: boolean;
  } = {},
) {
  const calls: Array<{ frameUrls: string[] }> = [];
  const submitted: Array<{ prompt: string; requestKey: string }> = [];
  storyboardServiceTest.__setRuntimeDependenciesForTests({
    visionAvailable: () => options.visionAvailable ?? true,
    reviewFrames: async (args) => {
      calls.push({ frameUrls: args.frameUrls });
      return options.review ? options.review(args) : allPass(args.frameUrls);
    },
    submitTask: async (args) => {
      submitted.push({ prompt: args.prompt, requestKey: args.requestKey });
      return { externalTaskId: `ext-${args.requestKey}` } as never;
    },
  });
  t.after(() => storyboardServiceTest.__setRuntimeDependenciesForTests(null));
  return { calls, submitted };
}

const inCronBudget = <T>(fn: () => Promise<T>, overrides: Partial<FrameQaBudgetOptions> = {}) =>
  runWithFrameQaBudget({ label: "test:cron", ...CRON_FRAME_QA_BUDGET, ...overrides }, fn);

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

test("P01-D：开关默认 off，只认 shadow / block", () => {
  assert.equal(storyboardAiReviewMode(undefined), "off");
  assert.equal(storyboardAiReviewMode(""), "off");
  assert.equal(storyboardAiReviewMode("on"), "off");
  assert.equal(storyboardAiReviewMode(" Shadow "), "shadow");
  assert.equal(storyboardAiReviewMode("block"), "block");
});

test("P01-D：逐帧解析——每帧 {index, pass, score, issues}；缺帧 / 越界 / 重复整包不合法；低于阈值即不过", () => {
  const frames = parseStoryboardFrameReview(
    {
      frames: [
        { index: 1, pass: true, score: 5, issues: "product color drifted" },
        { index: 0, pass: true, score: 9, issues: "" },
        { index: 2, pass: false, score: 8, issues: "  text   on wall " },
      ],
    },
    3,
  );
  assert.deepEqual(frames, [
    { index: 0, pass: true, score: 9, issues: "" },
    { index: 1, pass: false, score: 5, issues: "product color drifted" },
    { index: 2, pass: false, score: 8, issues: "text on wall" },
  ]);
  assert.throws(() => parseStoryboardFrameReview({ frames: [{ index: 0, score: 9 }] }, 2), /covered 1\/2/);
  assert.throws(() => parseStoryboardFrameReview({ frames: [{ index: 3, score: 9 }] }, 2), /invalid index/);
  assert.throws(
    () => parseStoryboardFrameReview({ frames: [{ index: 0, score: 9 }, { index: 0, score: 9 }] }, 2),
    /duplicate/,
  );
  assert.throws(() => parseStoryboardFrameReview({ best: 0 }, 2), /no frames array/);
});

test("P01-D：审帧只复用抽卡的扣分条目，抽卡评审的 system 一字不变", async () => {
  const judge = genericJudgeSystem();
  assert.match(judge, /Score each CANDIDATE 0-10/);
  assert.match(judge, /\{"scores":\[\{"index":0,"score":7,"issues":"\.\.\."\}\],"best":0\}/);
  assert.match(judge, /- any visible text, logo, watermark, caption, phone number, or QR code \(instant score ≤ 2\)\n- product identity/);
  const source = await readFile("src/lib/video-generation/storyboard-gacha.ts", "utf8");
  const reviewBody = source.slice(source.indexOf("export async function reviewStoryboardFrames"));
  assert.doesNotMatch(reviewBody, /judgeStoryboardCandidates|\.best\b/);
});

test("P01-D：reviewStoryboardFrames——vision 不可用不调用；回包不合法 / 超时都 fail-open 为 checked=false", async () => {
  let called = 0;
  const unavailable = await reviewStoryboardFrames({
    frameUrls: ["a"],
    visionAvailable: () => false,
    analyze: async () => {
      called += 1;
      return { data: {} } as never;
    },
  });
  assert.deepEqual(unavailable, { checked: false, reason: "vision_unavailable", note: "vision review unavailable" });
  assert.equal(called, 0);

  const sent: Array<{ images: string[]; options: unknown }> = [];
  const ok = await reviewStoryboardFrames({
    frameUrls: ["f0", "f1"],
    productUrls: ["p0", "p1", "p2", "p3"],
    visionAvailable: () => true,
    analyze: async (images, _system, _user, options) => {
      sent.push({ images, options });
      return { data: { frames: [{ index: 0, pass: true, score: 8 }, { index: 1, pass: false, score: 3, issues: "fix" }] } } as never;
    },
  });
  assert.equal(ok.checked, true);
  assert.deepEqual(sent[0]!.images, ["p0", "p1", "p2", "f0", "f1"], "最多 3 张实拍在前，帧在后");
  assert.deepEqual(sent[0]!.options, { detail: "low", maxTokens: 900 });

  const invalid = await reviewStoryboardFrames({
    frameUrls: ["f0", "f1"],
    visionAvailable: () => true,
    analyze: async () => ({ data: { frames: [{ index: 0, score: 8 }] } }) as never,
  });
  assert.equal(invalid.checked, false);
  assert.equal(!invalid.checked && invalid.reason, "error");

  const slow = await reviewStoryboardFrames({
    frameUrls: ["f0"],
    timeoutMs: 20,
    visionAvailable: () => true,
    analyze: () => new Promise(() => undefined),
  });
  assert.equal(!slow.checked && slow.reason, "timeout");
});

test("P01-D：审帧预算——上下文外不给；审帧 ≤60s/tick；与帧质检共用总窗口；settle 归还多占", async () => {
  assert.equal(reserveStoryboardReviewBudget(30_000).ok, false);
  await inCronBudget(async () => {
    const first = reserveStoryboardReviewBudget(30_000);
    const second = reserveStoryboardReviewBudget(30_000);
    assert.equal(first.ok && second.ok, true);
    const third = reserveStoryboardReviewBudget(30_000);
    assert.equal(third.ok, false);
    if (first.ok) first.settle(5_000);
    assert.equal(reserveStoryboardReviewBudget(25_000).ok, true, "第一次只花了 5s，余下 25s 还回来");
  });
  await inCronBudget(
    async () => {
      assert.equal(reserveStoryboardReviewBudget(30_000).ok, false, "总窗口剩余不足一次占位");
    },
    { totalBudgetMs: 10_000 },
  );
  assert.equal(CRON_FRAME_QA_BUDGET.totalBudgetMs, 200_000);
  assert.equal(CRON_FRAME_QA_BUDGET.storyboardReviewBudgetMs, 60_000);
});

test("P01-D：审帧重抽不占供应商尝试数；进度只在 block 的审帧中 / 重抽中露出", () => {
  assert.equal(storyboardProviderAttempts({ attempt: 3, aiReview: { regenCount: 2 } }), 1);
  assert.equal(storyboardProviderAttempts({ attempt: 2, aiReview: null }), 2);
  assert.equal(storyboardProviderAttempts({ attempt: 1, aiReview: { regenCount: 9 } }), 1);
  assert.deepEqual(storyboardAiReviewProgress({ mode: "block", state: "regenerating", regenRound: 2 }), {
    state: "regenerating",
    regenRound: 2,
  });
  assert.equal(storyboardAiReviewProgress({ mode: "block", state: "passed", regenRound: 2 }), null);
  assert.equal(storyboardAiReviewProgress({ mode: "shadow", state: "reviewing" }), null);
  assert.equal(storyboardAiReviewProgress(null), null);
  assert.ok(aiReviewRegenerationDirection("x".repeat(5000)).length <= 1000);
});

// ---------------------------------------------------------------------------
// 三档状态机（API 单条 AUTO）
// ---------------------------------------------------------------------------

test("P01-D off：AUTO 全部出图直接 APPROVED，不写汇总、不调审帧", async (t) => {
  setMode(t, undefined);
  const store = newStore();
  installFakeDb(t, store);
  const { calls } = installRuntime(t);
  const runId = seedRun(store);
  await storyboardServiceTest.advanceRun(runId);
  const run = store.runs.get(runId)!;
  assert.equal(run.status, "APPROVED");
  assert.ok(run.approvedAt instanceof Date);
  assert.equal(run.aiReviewSummary, null);
  assert.equal(await shadowReviewStoryboardRun(runId), "not_eligible");
  assert.equal(calls.length, 0);
});

test("P01-D shadow：状态机不变（AUTO 直接 APPROVED），预算内旁路写 aiReview，不重抽", async (t) => {
  setMode(t, "shadow");
  const store = newStore();
  installFakeDb(t, store);
  const { calls, submitted } = installRuntime(t, {
    review: async ({ frameUrls }) => ({
      checked: true,
      frames: frameUrls.map((_, index) => ({ index, pass: index !== 2, score: index === 2 ? 3 : 8, issues: index === 2 ? "logo on wall" : "" })),
      note: "#2 fails",
    }),
  });
  const runId = seedRun(store);
  await storyboardServiceTest.advanceRun(runId);
  assert.equal(store.runs.get(runId)!.status, "APPROVED");

  assert.equal(await shadowReviewStoryboardRun(runId), "deferred_budget", "预算上下文外不审");
  assert.equal(await inCronBudget(() => shadowReviewStoryboardRun(runId)), "reviewed");
  const run = store.runs.get(runId)!;
  assert.equal(run.status, "APPROVED");
  const summary = readAiReviewSummary(run.aiReviewSummary)!;
  assert.equal(summary.mode, "shadow");
  assert.equal(summary.state, "shadow_done");
  assert.match(summary.note ?? "", /would block 1/);
  const verdict = readFrameAiReview(store.frames.get(`${runId}-f2`)!.aiReview).verdict!;
  assert.equal(verdict.pass, false);
  assert.equal(verdict.mode, "shadow");
  assert.equal(submitted.length, 0, "shadow 永不重抽");
  assert.equal(calls.length, 1);
  assert.equal(await inCronBudget(() => shadowReviewStoryboardRun(runId)), "not_eligible", "只审一次");
});

test("P01-D block：API 单条 AUTO 出完图停在 AWAITING_APPROVAL，审帧全过 → APPROVED", async (t) => {
  setMode(t, "block");
  const store = newStore();
  installFakeDb(t, store);
  const { calls } = installRuntime(t);
  const runId = seedRun(store);
  await storyboardServiceTest.advanceRun(runId);
  let run = store.runs.get(runId)!;
  assert.equal(run.status, "AWAITING_APPROVAL");
  assert.equal(run.approvedAt, null);
  assert.equal(readAiReviewSummary(run.aiReviewSummary)!.state, "reviewing");
  const view = storyboardRunView({ ...run, frames: [...store.frames.values()] } as never);
  assert.equal(view.canApprove, false, "AUTO 的闸不给用户手动确认");

  assert.equal(await reviewAutoStoryboardRun(runId), "deferred", "用户面轮询不审、不计预算不足");
  assert.equal(readAiReviewSummary(store.runs.get(runId)!.aiReviewSummary)!.budgetShortTicks, 0);

  assert.equal(await inCronBudget(() => reviewAutoStoryboardRun(runId)), "approved");
  run = store.runs.get(runId)!;
  assert.equal(run.status, "APPROVED");
  assert.equal(readAiReviewSummary(run.aiReviewSummary)!.state, "passed");
  assert.equal(readAiReviewSummary(run.aiReviewSummary)!.reviewLeaseUntil, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.frameUrls.length, 4);
});

test("P01-D block：不过的帧以 issues 作 promptOverride 重抽，regenCount 单独计、不占 attempt 名额；新帧出图后只审新帧再批准", async (t) => {
  setMode(t, "block");
  const store = newStore();
  installFakeDb(t, store);
  let round = 0;
  const { calls, submitted } = installRuntime(t, {
    review: async ({ frameUrls }) => {
      round += 1;
      if (round === 1) {
        return {
          checked: true,
          frames: frameUrls.map((_, index) => ({
            index,
            pass: index !== 1,
            score: index === 1 ? 2 : 8,
            issues: index === 1 ? "remove the caption text from the wall" : "",
          })),
          note: "#1 fails",
        };
      }
      return allPass(frameUrls);
    },
  });
  const runId = seedRun(store);
  await storyboardServiceTest.advanceRun(runId);
  assert.equal(await inCronBudget(() => reviewAutoStoryboardRun(runId)), "regenerating");

  let run = store.runs.get(runId)!;
  assert.equal(run.status, "GENERATING");
  const summary = readAiReviewSummary(run.aiReviewSummary)!;
  assert.equal(summary.state, "regenerating");
  assert.equal(summary.regenRound, 1);
  assert.equal(storyboardAiReviewProgress(run.aiReviewSummary)?.regenRound, 1);

  const old = store.frames.get(`${runId}-f1`)!;
  assert.equal(old.isCurrent, false);
  assert.equal(readFrameAiReview(old.aiReview).verdict?.pass, false);
  const fresh = [...store.frames.values()].find((frame) => frame.ordinal === 1 && frame.isCurrent)!;
  assert.equal(fresh.attempt, 2);
  assert.equal(readFrameAiReview(fresh.aiReview).regenCount, 1);
  assert.equal(storyboardProviderAttempts(fresh as never), 1, "审帧重抽不占 BATCH_FRAME_MAX_ATTEMPTS");
  assert.equal(submitted.length, 1);
  assert.match(submitted[0]!.prompt, /USER DIRECTION[^\n]*AI frame review — fix this frame: remove the caption text from the wall/);
  assert.equal(submitted[0]!.prompt.match(/USER DIRECTION/g)?.length, 1);
  assert.equal(readFrameAiReview(store.frames.get(`${runId}-f0`)!.aiReview).verdict?.pass, true);

  // 新帧出图 → advanceRun 再次进入 AWAITING_APPROVAL（regenRound 保留）
  const live = store.frames.get(fresh.id as string)!;
  Object.assign(live, { status: "SUCCEEDED", outputUrl: "https://assets.example.test/f1-v2.png" });
  await storyboardServiceTest.advanceRun(runId);
  run = store.runs.get(runId)!;
  assert.equal(run.status, "AWAITING_APPROVAL");
  assert.equal(readAiReviewSummary(run.aiReviewSummary)!.regenRound, 1);

  assert.equal(await inCronBudget(() => reviewAutoStoryboardRun(runId)), "approved");
  assert.equal(store.runs.get(runId)!.status, "APPROVED");
  assert.equal(calls.length, 2);
  assert.equal(readFrameAiReview(live.aiReview).verdict?.pass, true);
  assert.equal(readFrameAiReview(live.aiReview).regenCount, 1);
});

test("P01-D block：预算耗尽这一 tick 只记一笔，下一 tick 有预算仍能批准；连续 3 个 tick 不足则带 warning 兜底批准", async (t) => {
  setMode(t, "block");
  const store = newStore();
  installFakeDb(t, store);
  const { calls } = installRuntime(t);
  const runId = seedRun(store);
  await storyboardServiceTest.advanceRun(runId);
  const starved = { storyboardReviewBudgetMs: 0 };
  assert.equal(await inCronBudget(() => reviewAutoStoryboardRun(runId), starved), "deferred_budget");
  assert.equal(readAiReviewSummary(store.runs.get(runId)!.aiReviewSummary)!.budgetShortTicks, 1);
  assert.equal(store.runs.get(runId)!.status, "AWAITING_APPROVAL");
  assert.equal(await inCronBudget(() => reviewAutoStoryboardRun(runId)), "approved");
  assert.equal(calls.length, 1);

  const second = seedRun(store, { id: "run-2" });
  await storyboardServiceTest.advanceRun(second);
  assert.equal(await inCronBudget(() => reviewAutoStoryboardRun(second), starved), "deferred_budget");
  assert.equal(await inCronBudget(() => reviewAutoStoryboardRun(second), starved), "deferred_budget");
  assert.equal(await inCronBudget(() => reviewAutoStoryboardRun(second), starved), "approved_with_warning");
  const summary = readAiReviewSummary(store.runs.get(second)!.aiReviewSummary)!;
  assert.equal(store.runs.get(second)!.status, "APPROVED");
  assert.match(summary.warning ?? "", /连续 3 轮/);
  assert.equal(calls.length, 1, "兜底批准不调 vision");
});

test("P01-D block：停留超过 20 分钟按时长兜底批准，不依赖本 tick 有预算（用户面轮询也放行）", async (t) => {
  setMode(t, "block");
  const store = newStore();
  installFakeDb(t, store);
  const { calls } = installRuntime(t);
  const runId = seedRun(store);
  await storyboardServiceTest.advanceRun(runId);
  const since = Date.parse(readAiReviewSummary(store.runs.get(runId)!.aiReviewSummary)!.awaitingSince!);
  const later = new Date(since + STORYBOARD_AI_REVIEW_FALLBACK_MS + 1000);
  assert.equal(await reviewAutoStoryboardRun(runId, later), "approved_with_warning");
  const run = store.runs.get(runId)!;
  assert.equal(run.status, "APPROVED");
  assert.match(readAiReviewSummary(run.aiReviewSummary)!.warning ?? "", /20 分钟/);
  assert.equal(calls.length, 0);
});

test("P01-D block：vision 不可用不插闸——advanceRun 记 skipped 直接批准；已在闸里的 run 也直接放行", async (t) => {
  setMode(t, "block");
  const store = newStore();
  installFakeDb(t, store);
  const { calls } = installRuntime(t, { visionAvailable: false });
  const runId = seedRun(store);
  await storyboardServiceTest.advanceRun(runId);
  let run = store.runs.get(runId)!;
  assert.equal(run.status, "APPROVED");
  assert.equal(readAiReviewSummary(run.aiReviewSummary)!.state, "skipped");

  const waiting = seedRun(store, {
    id: "run-waiting",
    status: "AWAITING_APPROVAL",
    aiReviewSummary: { mode: "block", state: "reviewing", regenRound: 0, budgetShortTicks: 0, awaitingSince: new Date().toISOString(), updatedAt: "" },
  });
  assert.equal(await reviewAutoStoryboardRun(waiting), "approved_skipped");
  run = store.runs.get(waiting)!;
  assert.equal(run.status, "APPROVED");
  assert.equal(readAiReviewSummary(run.aiReviewSummary)!.state, "skipped");
  assert.equal(calls.length, 0);
});

test("P01-D block：审帧调用失败 fail-open 带 warning 批准；开关关掉后残留在闸里的 run 直接放行", async (t) => {
  setMode(t, "block");
  const store = newStore();
  installFakeDb(t, store);
  installRuntime(t, { review: async () => ({ checked: false, reason: "timeout", note: "review timeout >25s" }) });
  const runId = seedRun(store);
  await storyboardServiceTest.advanceRun(runId);
  assert.equal(await inCronBudget(() => reviewAutoStoryboardRun(runId)), "approved_with_warning");
  assert.match(readAiReviewSummary(store.runs.get(runId)!.aiReviewSummary)!.warning ?? "", /调用失败/);

  const leftover = seedRun(store, { id: "run-leftover" });
  await storyboardServiceTest.advanceRun(leftover);
  assert.equal(store.runs.get(leftover)!.status, "AWAITING_APPROVAL");
  process.env.STORYBOARD_AI_REVIEW = "off";
  assert.equal(await reviewAutoStoryboardRun(leftover), "approved_skipped");
  assert.equal(store.runs.get(leftover)!.status, "APPROVED");
});

test("P01-D block：审帧重抽用满 / FRAME_REGENERATION_LIMIT 都当「用满」放行，带 warning，不再付费重抽", async (t) => {
  setMode(t, "block");
  const store = newStore();
  installFakeDb(t, store);
  const { submitted } = installRuntime(t, {
    review: async ({ frameUrls }) => ({
      checked: true,
      frames: frameUrls.map((_, index) => ({ index, pass: index > 1, score: index > 1 ? 8 : 2, issues: index > 1 ? "" : "product warped" })),
      note: "#0 #1 fail",
    }),
  });
  const runId = seedRun(store, { status: "GENERATING" }, {
    0: { attempt: 1 + STORYBOARD_AI_REVIEW_MAX_REGENS_PER_FRAME, aiReview: { regenCount: STORYBOARD_AI_REVIEW_MAX_REGENS_PER_FRAME } },
    1: { attempt: 4, aiReview: null },
  });
  await storyboardServiceTest.advanceRun(runId);
  assert.equal(await inCronBudget(() => reviewAutoStoryboardRun(runId)), "approved_with_warning");
  const run = store.runs.get(runId)!;
  assert.equal(run.status, "APPROVED");
  assert.match(readAiReviewSummary(run.aiReviewSummary)!.warning ?? "", /重抽用满/);
  assert.equal(readFrameAiReview(store.frames.get(`${runId}-f0`)!.aiReview).exhausted, true);
  assert.equal(readFrameAiReview(store.frames.get(`${runId}-f1`)!.aiReview).exhausted, true, "attempt 4 = 已重做 3 次，FRAME_REGENERATION_LIMIT");
  assert.equal(submitted.length, 0);
});

test("P01-D：审帧重抽用满之后供应商再失败不判死——仍可按新 attempt 重投（不撞 FRAME_REGENERATION_LIMIT）", async (t) => {
  setMode(t, "block");
  const store = newStore();
  installFakeDb(t, store);
  const { submitted } = installRuntime(t);
  const runId = seedRun(store, { status: "FAILED", videoJobId: "job-1" }, {
    2: {
      attempt: 3,
      aiReview: { regenCount: 2 },
      status: "FAILED",
      submissionState: "REJECTED",
      externalTaskId: null,
      errorCode: "PROVIDER_REJECTED",
    },
  });
  const failed = store.frames.get(`${runId}-f2`)!;
  assert.equal(storyboardProviderAttempts(failed as never) < 3, true, "批量 BATCH_FRAME_MAX_ATTEMPTS=3 仍有名额");
  await regenerateStoryboardFrame({ userId: "owner-1", runId, frameId: failed.id as string });
  const fresh = [...store.frames.values()].find((frame) => frame.ordinal === 2 && frame.isCurrent)!;
  assert.equal(fresh.attempt, 4);
  assert.equal(readFrameAiReview(fresh.aiReview).regenCount, 2, "供应商重投继承审帧重抽数，不再 +1");
  assert.equal(store.runs.get(runId)!.status, "GENERATING");
  assert.equal(submitted.length, 1);
});

test("P01-D：并发的审帧只有一份真调 vision（updatedAt CAS 占位 + 租期）", async (t) => {
  setMode(t, "block");
  const store = newStore();
  installFakeDb(t, store);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { calls } = installRuntime(t, {
    review: async ({ frameUrls }) => {
      await gate;
      return allPass(frameUrls);
    },
  });
  const runId = seedRun(store);
  await storyboardServiceTest.advanceRun(runId);
  const first = inCronBudget(() => reviewAutoStoryboardRun(runId));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await inCronBudget(() => reviewAutoStoryboardRun(runId)), "busy");
  release();
  assert.equal(await first, "approved");
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// 接线与锁定管线
// ---------------------------------------------------------------------------

test("P01-D：批量 tick 与 cron 单条轮询都接了 {AWAITING_APPROVAL, AUTO} 分支；审帧后检查续租", async () => {
  const [batch, service] = await Promise.all([
    readFile("src/lib/services/batch-service.ts", "utf8"),
    readFile("src/lib/video-generation/storyboard-service.ts", "utf8"),
  ]);
  const review = batch.slice(batch.indexOf("async function reviewBatchStoryboards"));
  assert.match(review.slice(0, 1200), /status: "AWAITING_APPROVAL",\s*approvalPolicy: "AUTO"/);
  assert.match(review, /reviewAutoStoryboardRun\(run\.id\)/);
  assert.match(batch, /await reviewBatchStoryboards\(batchId\);/);
  assert.match(
    batch,
    /await prepareBatchStoryboards\(batchId, batch\.userId\);[\s\S]{0,200}if \(!\(await renewBatchTickLease\(batchId, leaseOwner\)\)\)/,
  );
  const poll = service.slice(service.indexOf("export async function pollPendingStoryboardRuns"));
  assert.match(poll.slice(0, 1500), /status: StoryboardRunStatus\.AWAITING_APPROVAL,\s*approvalPolicy: StoryboardApprovalPolicy\.AUTO/);
  assert.match(poll, /await reviewAutoStoryboardRun\(run\.id\)/);
  assert.match(batch, /storyboardProviderAttempts\(frame\) < BATCH_FRAME_MAX_ATTEMPTS/);
});

test("P01-D：SunnyShutter 两条锁定管线不接审帧、不接抽卡评审", async () => {
  const [lockedPipeline, shadePipeline] = await Promise.all([
    readFile("src/lib/video-generation/sunnyshutter-image2-pipeline.ts", "utf8"),
    readFile("src/lib/video-generation/sunnyshutter-shade-pipeline.ts", "utf8"),
  ]);
  for (const source of [lockedPipeline, shadePipeline]) {
    assert.doesNotMatch(source, /reviewStoryboardFrames|reviewAutoStoryboardRun|STORYBOARD_AI_REVIEW|generateFrameWithGacha|analyzeImages/);
  }
});
