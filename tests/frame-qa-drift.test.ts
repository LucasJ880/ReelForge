/**
 * P01-B 段级漂移判据（影子）：判据纯函数、按行类型取参考图、门禁接线、与烧字门禁的超时隔离。
 *
 * 全部依赖注入：不跑 ffmpeg、不调 vision（OpenAI 额度不足期间也不该调）、不连数据库。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, test } from "node:test";
import { VideoProvider } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  FRAME_QA_STATUS,
  __test__ as gateTest,
  decideFrameQaGate,
  runWithFrameQaBudget,
  type FrameQaGateDeps,
} from "../src/lib/services/frame-qa-gate";
import { summarizeFrameQa } from "../src/lib/services/frame-qa-report-service";
import {
  FRAME_DRIFT_SCORE_FLOOR,
  FRAME_DRIFT_SYSTEM,
  FRAME_DRIFT_TIMEOUT_MS,
  batchDriftReferences,
  briefDriftReferences,
  buildDriftUserPrompt,
  decideDriftVerdict,
  frameDriftMode,
  runFrameDriftCheck,
  type DriftVisionCall,
  type FrameDriftReferences,
  type FrameDriftResult,
} from "../src/lib/video-generation/frame-drift";
import { raceGateWithDrift, type FrameQaVerdict } from "../src/lib/video-generation/frame-qa";
import { STORYBOARD_RUBRIC_IDENTITY_PENALTIES, genericJudgeSystem } from "../src/lib/video-generation/storyboard-gacha";

const ENV_KEYS = ["FRAME_QA_OUTSIDE_BUDGET", "FRAME_QA_DRIFT_MODE"] as const;
let envBackup: Record<string, string | undefined> = {};
beforeEach(() => {
  envBackup = {};
  for (const k of ENV_KEYS) envBackup[k] = process.env[k];
  process.env.FRAME_QA_OUTSIDE_BUDGET = "inline";
  delete process.env.FRAME_QA_DRIFT_MODE;
});
afterEach(() => {
  const env = process.env as Record<string, string | undefined>;
  for (const k of ENV_KEYS) {
    if (envBackup[k] === undefined) delete env[k];
    else env[k] = envBackup[k];
  }
});

const NOW = new Date("2026-10-26T08:00:00.000Z");
const FRAMES = ["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"];

const PASS: FrameQaVerdict = { ok: true, checked: true, frameCount: 6, issues: [], summary: "帧质检通过（6 帧无画面文字）" };
const BLOCK: FrameQaVerdict = {
  ok: false,
  checked: true,
  frameCount: 6,
  issues: [{ frameIndex: 2, detail: "检测到画面叠加文字「曬」" }],
  summary: "帧质检拦截：第3帧 检测到画面叠加文字「曬」",
};

const DRIFTED: FrameDriftResult = decideDriftVerdict(
  [
    { index: 0, productMatch: true, personConsistent: true, score: 9, issues: "" },
    { index: 1, productMatch: false, personConsistent: true, score: 3, issues: "瓶身变成了方形" },
  ],
  2,
);

// ---------- 判据 ----------

test("判据：只复用故事板评审的身份 / 几何扣分条目，信封是逐帧 {index, productMatch, personConsistent, score, issues}", () => {
  for (const line of STORYBOARD_RUBRIC_IDENTITY_PENALTIES) {
    assert.ok(FRAME_DRIFT_SYSTEM.includes(line), line);
    assert.ok(genericJudgeSystem().includes(line), "抽卡评审仍是同一条");
  }
  assert.match(FRAME_DRIFT_SYSTEM, /"index":0,"productMatch":true,"personConsistent":true,"score":9,"issues":""/);
  assert.doesNotMatch(FRAME_DRIFT_SYSTEM, /"best"|CANDIDATE|instant score/, "不沿用抽卡的 N 选 1 信封与烧字扣分");
  assert.match(FRAME_DRIFT_SYSTEM, /Ignore burned-in text/);
  assert.match(buildDriftUserPrompt(3, 6, { storyboardCount: 1 }), /first 3 image\(s\) are CONTEXT images: 2 real product photo\(s\), then 1 approved storyboard keyframe/);
  assert.match(buildDriftUserPrompt(2, 4), /first 2 image\(s\) are CONTEXT images: 2 real product photo\(s\)\. The next 4/);
});

test("decideDriftVerdict：商品不符 / 人物不一致 / 低于评分下限 任一即漂移；最低分取各帧最小；缺项不当成漂移", () => {
  assert.equal(DRIFTED.checked, true);
  assert.equal(DRIFTED.ok, false);
  assert.equal(DRIFTED.drifted, true);
  assert.equal(DRIFTED.score, 3);
  assert.deepEqual(DRIFTED.issues.map((issue) => issue.frameIndex), [1]);
  assert.match(DRIFTED.summary, /第2帧 商品与参考图不一致、一致性 3\/10 低于 4（瓶身变成了方形）/);

  const person = decideDriftVerdict([{ index: 0, productMatch: true, personConsistent: false, score: 8 }], 1);
  assert.equal(person.ok, false);
  assert.match(person.issues[0].detail, /人物与故事板不一致/);

  const lowScore = decideDriftVerdict([{ productMatch: true, personConsistent: true, score: FRAME_DRIFT_SCORE_FLOOR - 0.5 }], 1);
  assert.equal(lowScore.ok, false);
  assert.equal(lowScore.frames[0].index, 0, "缺 index 按位置补");

  const sparse = decideDriftVerdict([{ index: 0 }, { index: 1, score: "11", issues: ["a", "b"] }], 2);
  assert.equal(sparse.ok, true, "vision 没给的项不当成漂移");
  assert.equal(sparse.frames[1].score, 10, "分数夹到 0-10");
  assert.equal(sparse.frames[1].issues, "a; b");

  const empty = decideDriftVerdict([], 6);
  assert.equal(empty.checked, false);
  assert.equal(empty.ok, true);
  assert.match(empty.skipped ?? "", /缺少 frames/);
});

test("开关：FRAME_QA_DRIFT_MODE 只认 shadow，其余（含未设置 / block）一律 off", () => {
  assert.equal(frameDriftMode({}), "off");
  assert.equal(frameDriftMode({ FRAME_QA_DRIFT_MODE: " Shadow " }), "shadow");
  assert.equal(frameDriftMode({ FRAME_QA_DRIFT_MODE: "block" }), "off");
});

// ---------- 参考图按行类型取 ----------

test("批量行：assignedAssets.assets[].url（去重、只收 http(s)、最多 3 张）；没分到素材 → 不调 vision", () => {
  const refs = batchDriftReferences({
    index: 0,
    assets: [
      { id: "a", url: "https://a.test/1.jpg" },
      { id: "b", url: "https://a.test/2.jpg" },
      { id: "a2", url: "https://a.test/1.jpg" },
      { id: "c", url: "/brand/local.png" },
      { id: "d", url: "https://a.test/3.jpg" },
      { id: "e", url: "https://a.test/4.jpg" },
    ],
  });
  assert.deepEqual(refs, {
    source: "batch_assets",
    productUrls: ["https://a.test/1.jpg", "https://a.test/2.jpg", "https://a.test/3.jpg"],
    storyboardUrls: [],
  });
  assert.match(batchDriftReferences({ assets: [] }).unavailableReason ?? "", /没有分配/);
  assert.match(batchDriftReferences(null).unavailableReason ?? "", /没有分配/);
});

test("单条段行：按 P02-F(v) 的 referenceLayout 切出实拍 + 故事板首帧，跳过切片与主播；没有布局不猜", () => {
  const urls = [
    "https://a.test/real-0.jpg",
    "https://a.test/real-1.jpg",
    "https://a.test/cutout-0.png",
    "https://a.test/person.jpg",
    "https://a.test/frame-0.png",
    "https://a.test/frame-1.png",
  ];
  const plan = { referenceLayout: { productPhotoCount: 2, anchorCount: 1, personCount: 1, frameCount: 2, limit: 8 } };
  assert.deepEqual(briefDriftReferences(urls, plan), {
    source: "brief_storyboard",
    productUrls: ["https://a.test/real-0.jpg", "https://a.test/real-1.jpg"],
    storyboardUrls: ["https://a.test/frame-0.png"],
  });
  const textOnly = briefDriftReferences(["https://a.test/frame-0.png"], {
    referenceLayout: { productPhotoCount: 0, anchorCount: 0, personCount: 0, frameCount: 1, limit: 8 },
  });
  assert.deepEqual(textOnly.productUrls, []);
  assert.deepEqual(textOnly.storyboardUrls, ["https://a.test/frame-0.png"]);
  assert.match(briefDriftReferences(urls, { segmentPlan: [] }).unavailableReason ?? "", /布局未知/);
  assert.match(
    briefDriftReferences([], { referenceLayout: { productPhotoCount: 0, anchorCount: 0, personCount: 0, frameCount: 0, limit: 8 } })
      .unavailableReason ?? "",
    /没有实拍与故事板帧/,
  );
});

// ---------- 执行 ----------

function visionStub(response: () => Promise<{ data: unknown }>) {
  const calls: Array<{ images: string[]; system: string; user: string; options: unknown }> = [];
  const analyze: DriftVisionCall = async (images, system, user, options) => {
    calls.push({ images, system, user, options });
    return response();
  };
  return { analyze, calls };
}

const BATCH_REFS: FrameDriftReferences = { source: "batch_assets", productUrls: ["https://a.test/1.jpg"], storyboardUrls: [] };
const BRIEF_REFS: FrameDriftReferences = {
  source: "brief_storyboard",
  productUrls: ["https://a.test/real-0.jpg"],
  storyboardUrls: ["https://a.test/frame-0.png"],
};

test("runFrameDriftCheck：图序 实拍 → 故事板首帧 → 段帧，用生产 system 与 low 精度；无参考图不调 vision", async () => {
  const { analyze, calls } = visionStub(async () => ({
    data: { frames: [{ index: 0, productMatch: true, personConsistent: true, score: 8, issues: "" }, { index: 1, productMatch: true, personConsistent: true, score: 9, issues: "" }] },
  }));
  const result = await runFrameDriftCheck({ frames: FRAMES, references: BRIEF_REFS, analyze });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].images, ["https://a.test/real-0.jpg", "https://a.test/frame-0.png", ...FRAMES]);
  assert.equal(calls[0].system, FRAME_DRIFT_SYSTEM);
  assert.match(calls[0].user, /1 real product photo\(s\), then 1 approved storyboard keyframe/);
  assert.deepEqual(calls[0].options, { detail: "low", maxTokens: 1200 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.references, { source: "brief_storyboard", productCount: 1, storyboardCount: 1 });

  const none = await runFrameDriftCheck({
    frames: FRAMES,
    references: batchDriftReferences({ assets: [] }),
    analyze,
  });
  assert.equal(calls.length, 1, "无参考图不调 vision");
  assert.equal(none.checked, false);
});

test("runFrameDriftCheck：自带超时与异常兜底，永不 throw", async () => {
  const hang = visionStub(() => new Promise(() => {}));
  const timedOut = await runFrameDriftCheck({ frames: FRAMES, references: BATCH_REFS, analyze: hang.analyze, timeoutMs: 15 });
  assert.equal(timedOut.checked, false);
  assert.match(timedOut.skipped ?? "", /漂移检查超时/);
  const boom = visionStub(async () => {
    throw new Error("429 quota");
  });
  const failed = await runFrameDriftCheck({ frames: FRAMES, references: BATCH_REFS, analyze: boom.analyze });
  assert.equal(failed.checked, false);
  assert.match(failed.skipped ?? "", /429 quota/);
  assert.equal(FRAME_DRIFT_TIMEOUT_MS, 30_000);
});

test("编排：漂移在烧字 race 之外——漂移超时只记 drift.skipped，烧字拦截结论原样返回", async () => {
  const hang = visionStub(() => new Promise(() => {}));
  const started = Date.now();
  const verdict = await raceGateWithDrift({
    gate: async (onFrames) => {
      onFrames(FRAMES);
      return BLOCK;
    },
    gateTimeoutMs: 1_000,
    drift: { run: (frames) => runFrameDriftCheck({ frames, references: BATCH_REFS, analyze: hang.analyze, timeoutMs: 20 }) },
  });
  assert.equal(verdict.ok, false, "烧字拦截不受漂移超时影响");
  assert.deepEqual(verdict.issues, BLOCK.issues);
  assert.equal(verdict.drift?.checked, false);
  assert.match(verdict.drift?.skipped ?? "", /漂移检查超时/);
  assert.ok(Date.now() - started < 1_000, "等的是漂移自己的超时，不是烧字门禁的");
});

test("编排：烧字门禁先超时（帧还没抽完）→ 漂移记「抽帧未完成」不调 vision；漂移执行器抛错也只记 skipped", async () => {
  let driftRuns = 0;
  const slow = await raceGateWithDrift({
    gate: () => new Promise(() => {}),
    gateTimeoutMs: 10,
    drift: {
      run: async () => {
        driftRuns += 1;
        return DRIFTED;
      },
    },
  });
  assert.equal(slow.checked, false);
  assert.match(slow.summary, /门禁超时/);
  assert.equal(driftRuns, 0);
  assert.match(slow.drift?.skipped ?? "", /抽帧未完成/);

  const thrown = await raceGateWithDrift({
    gate: async (onFrames) => {
      onFrames(FRAMES);
      return PASS;
    },
    gateTimeoutMs: 1_000,
    drift: {
      run: async () => {
        throw new Error("boom");
      },
    },
  });
  assert.equal(thrown.ok, true);
  assert.match(thrown.drift?.skipped ?? "", /boom/);

  const textFailedDriftRan = await raceGateWithDrift({
    gate: async (onFrames) => {
      onFrames(FRAMES);
      throw new Error("vision 500");
    },
    gateTimeoutMs: 1_000,
    drift: { run: async () => DRIFTED },
  });
  assert.equal(textFailedDriftRan.checked, false, "烧字 vision 失败照常 fail-open");
  assert.equal(textFailedDriftRan.drift?.ok, false, "抽帧已完成的漂移检查照常落下");
});

test("编排：不带 drift（off）= 不起漂移执行、verdict 与烧字门禁原样一致、不带 drift 字段", async () => {
  const verdict = await raceGateWithDrift({
    gate: async (onFrames) => {
      onFrames(FRAMES);
      return PASS;
    },
    gateTimeoutMs: 1_000,
  });
  assert.deepEqual(verdict, PASS);
  assert.equal("drift" in verdict, false);
});

// ---------- 门禁接线 ----------

function gateDeps(overrides: Partial<FrameQaGateDeps> = {}) {
  const calls: { qa: Array<unknown[]>; refs: number } = { qa: [], refs: 0 };
  const deps: FrameQaGateDeps = {
    isFrameQaEnabled: () => true,
    runFrameTextQa: async (...args: unknown[]) => {
      calls.qa.push(args);
      const opts = args[1] as { drift?: { references: FrameDriftReferences } } | undefined;
      return opts?.drift ? { ...PASS, drift: DRIFTED } : PASS;
    },
    loadPriorDetail: async () => null,
    now: () => NOW,
    ...overrides,
  };
  return { deps, calls };
}

function detailOf(data: Record<string, unknown>) {
  return data.frameQaDetail as Record<string, unknown>;
}

test("门禁 off（默认）：不取参考图、只按旧签名调烧字门禁、detail 不带 drift", async () => {
  const { deps, calls } = gateDeps({
    references: async () => {
      calls.refs += 1;
      return BATCH_REFS;
    },
  });
  const decision = await decideFrameQaGate(
    {
      jobId: "job-off",
      provider: VideoProvider.SEEDANCE_T2V,
      videoUrl: "https://v.test/seg.mp4",
      driftSource: { assignedAssets: { assets: [{ url: "https://a.test/1.jpg" }] }, videoBriefId: null },
    },
    deps,
  );
  assert.equal(calls.refs, 0);
  assert.deepEqual(calls.qa, [["https://v.test/seg.mp4"]]);
  assert.equal(decision.action, "pass");
  if (decision.action === "pass") assert.equal("drift" in detailOf(decision.successData as Record<string, unknown>), false);
});

test("门禁 shadow · 批量行：参考图取 assignedAssets（默认解析器，不查库），检出漂移照样 PASSED（不改 ok）", async () => {
  const { deps, calls } = gateDeps({ driftMode: () => "shadow" });
  delete (deps as Partial<FrameQaGateDeps>).references;
  const decision = await decideFrameQaGate(
    {
      jobId: "job-batch",
      provider: VideoProvider.SEEDANCE_T2V,
      videoUrl: "https://v.test/seg.mp4",
      driftSource: {
        assignedAssets: { assets: [{ id: "a", url: "https://a.test/1.jpg" }, { id: "b", url: "https://a.test/2.jpg" }] },
        videoBriefId: null,
      },
    },
    deps,
  );
  const opts = calls.qa[0][1] as { drift: { references: FrameDriftReferences } };
  assert.deepEqual(opts.drift.references, {
    source: "batch_assets",
    productUrls: ["https://a.test/1.jpg", "https://a.test/2.jpg"],
    storyboardUrls: [],
  });
  assert.equal(decision.action, "pass");
  if (decision.action === "pass") {
    assert.equal(decision.successData.frameQaStatus, FRAME_QA_STATUS.PASSED, "shadow 不改放行结论");
    assert.deepEqual(detailOf(decision.successData as Record<string, unknown>).drift, DRIFTED);
  }
});

test("门禁 shadow · 单条段行：读 brief 的参考图 + referenceLayout 切出实拍与故事板首帧；烧字拦截照常 BLOCKED", async (t) => {
  const model = db.videoBrief as unknown as Record<string, unknown>;
  const original = model.findUnique;
  const queried: Array<Record<string, unknown>> = [];
  model.findUnique = async (args: Record<string, unknown>) => {
    queried.push(args);
    return {
      referenceImageUrls: [
        "https://a.test/real-0.jpg",
        "https://a.test/cutout.png",
        "https://a.test/person.jpg",
        "https://a.test/frame-0.png",
        "https://a.test/frame-1.png",
      ],
      directorPlan: { referenceLayout: { productPhotoCount: 1, anchorCount: 1, personCount: 1, frameCount: 2, limit: 8 } },
    };
  };
  t.after(() => {
    model.findUnique = original;
  });
  const { deps, calls } = gateDeps({
    driftMode: () => "shadow",
    runFrameTextQa: async (...args: unknown[]) => {
      calls.qa.push(args);
      return { ...BLOCK, drift: DRIFTED };
    },
  });
  delete (deps as Partial<FrameQaGateDeps>).references;
  const decision = await decideFrameQaGate(
    {
      jobId: "job-seg",
      provider: VideoProvider.SEEDANCE_T2V,
      videoUrl: "https://v.test/seg.mp4",
      driftSource: { assignedAssets: null, videoBriefId: "brief-1" },
    },
    deps,
  );
  assert.deepEqual((queried[0].where as Record<string, unknown>).id, "brief-1");
  const opts = calls.qa[0][1] as { drift: { references: FrameDriftReferences } };
  assert.deepEqual(opts.drift.references, {
    source: "brief_storyboard",
    productUrls: ["https://a.test/real-0.jpg"],
    storyboardUrls: ["https://a.test/frame-0.png"],
  });
  assert.equal(decision.action, "block", "烧字拦截照旧，漂移只附在 detail 上");
  if (decision.action === "block") {
    assert.equal(decision.failureData.frameQaStatus, FRAME_QA_STATUS.BLOCKED);
    assert.deepEqual(detailOf(decision.failureData as Record<string, unknown>).drift, DRIFTED);
  }
});

test("门禁 shadow：参考图读取失败不影响烧字门禁，drift 记原因", async () => {
  const { deps, calls } = gateDeps({
    driftMode: () => "shadow",
    references: async () => {
      throw new Error("db down");
    },
  });
  const decision = await decideFrameQaGate(
    { jobId: "job-x", provider: VideoProvider.SEEDANCE_T2V, videoUrl: "https://v.test/seg.mp4", driftSource: { assignedAssets: null, videoBriefId: "b" } },
    deps,
  );
  const opts = calls.qa[0][1] as { drift: { references: FrameDriftReferences } };
  assert.match(opts.drift.references.unavailableReason ?? "", /db down/);
  assert.equal(decision.action, "pass");
});

test("预算：shadow 每段多留漂移的 30s，剩余窗口只够烧字门禁时 defer；off 照旧放行", async () => {
  assert.equal(gateTest.PER_CHECK_RESERVE_WITH_DRIFT_MS, gateTest.PER_CHECK_RESERVE_MS + FRAME_DRIFT_TIMEOUT_MS);
  assert.ok(gateTest.FRAME_QA_CLAIM_LEASE_MS > gateTest.PER_CHECK_RESERVE_WITH_DRIFT_MS, "占位租期仍大于开漂移后的最坏耗时");
  const budget = { label: "cron:test", maxChecks: 4, timeBudgetMs: gateTest.PER_CHECK_RESERVE_MS + 5_000 };
  const params = { jobId: "job-b", provider: VideoProvider.SEEDANCE_T2V, videoUrl: "https://v.test/seg.mp4" };
  const off = await runWithFrameQaBudget(budget, () => decideFrameQaGate(params, gateDeps().deps));
  assert.equal(off.action, "pass");
  const shadow = await runWithFrameQaBudget(budget, () =>
    decideFrameQaGate(params, gateDeps({ driftMode: () => "shadow" }).deps),
  );
  assert.deepEqual(shadow, { action: "defer", reason: "frame_qa_budget_time_exhausted" });
});

test("reconcile 接线：门禁拿到整行的 assignedAssets / videoBriefId 作参考图来源", async () => {
  const service = await readFile("src/lib/services/video-service.ts", "utf8");
  assert.match(service, /driftSource: \{ assignedAssets: job\.assignedAssets, videoBriefId: job\.videoBriefId \}/);
});

test("运维报表：没跑成的漂移（checked=false）不进分母；生产形状 ok=false 算命中、score 取平均", () => {
  const row = (id: string, drift: unknown) => ({
    id,
    batchJobId: null,
    frameQaStatus: "PASSED",
    frameQaCheckedAt: NOW,
    frameQaDetail: { drift },
    outputVideoUrl: null,
  });
  const report = summarizeFrameQa(
    [
      row("1", DRIFTED),
      row("2", decideDriftVerdict([{ index: 0, productMatch: true, personConsistent: true, score: 9 }], 1)),
      row("3", decideDriftVerdict([], 6)),
    ],
    7,
  );
  assert.deepEqual(report.drift, { available: true, rows: 2, flagged: 1, flaggedRate: 0.5, meanScore: 6 });
});

test("能力文案不动：影子默认 off，看图文案仍只写错字与水印", async () => {
  const env = await readFile(".env.example", "utf8");
  assert.match(env, /^FRAME_QA_DRIFT_MODE=off$/m);
  const prodEnv = await readFile(".env.production.example", "utf8");
  assert.match(prodEnv, /^# FRAME_QA_DRIFT_MODE=off$/m);
});
