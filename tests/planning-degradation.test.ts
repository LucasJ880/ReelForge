import assert from "node:assert/strict";
import test, { mock, type TestContext } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanPreviewCard } from "../src/components/video-generation/plan-preview-card";
import { StoryboardWorkflowPanel } from "../src/components/video-generation/storyboard-workflow-panel";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { db } from "../src/lib/db";
import { openai } from "../src/lib/providers/openai";
import { containsBannedCustomerTerm } from "../src/lib/video-generation/business-status";
import { buildPlan } from "../src/lib/video-generation/generation-supervisor";
import {
  PLANNING_DEGRADED_LOG_PREFIX,
  PLANNING_FALLBACK_BY_STAGE,
  PLANNING_STAGES,
  createPlanningDegradationLog,
  logPlanningDegradations,
  planningDegradation,
  planningDegradationReason,
  readPlanningDegradations,
} from "../src/lib/video-generation/planning-degradation";
import {
  planningDegradationIssueCode,
  planningDegradationNotice,
  planningStageFromIssueCode,
} from "../src/lib/video-generation/planning-degradation-notice";
import { buildQualityReview } from "../src/lib/video-generation/quality-reviewer";
import { designStoryboardShotCards, type StoryboardShotCard } from "../src/lib/video-generation/shot-cards";
import { STORYBOARD_BEATS_SHORT } from "../src/lib/video-generation/storyboard-beats";
import { createStoryboardRun, storyboardRunView } from "../src/lib/video-generation/storyboard-service";
import { videoGenerationPlanSchema } from "../src/lib/schemas/unified-input";
import type {
  PlanningDegradation,
  UnifiedVideoGenerationRequest,
  VideoGenerationPlan,
} from "../src/types/video-generation";

/**
 * 2026-10-29 · 出方案阶段 AI 调用失败后退回启发式 / 模板，要在方案上看得到：
 * 哪一步（stage）、为什么（reason，直接用错误信息）、退回了什么（fallback）。
 * 镜头卡在建故事板时调，同一形状记到 StoryboardRun.planningDegradations。成功路径不变、不多调一次。
 * 看得到的出口：质量评审 warning（方案卡「请注意」，商家话）、故事板面板一行同色提示、一行结构化运维日志。
 * 这里只打假的 chat.completions.create，真接口验证见交付说明。
 */

/* ── 形状与工具 ─────────────────────────────────────────────────────── */

test("原因：直接用错误信息，压成一行、截断、抹掉疑似密钥；不是 Error 的也能转", () => {
  assert.equal(planningDegradationReason(new Error("OpenAI 返回了空响应")), "OpenAI 返回了空响应");
  assert.equal(
    planningDegradationReason(new Error("OpenAI 返回的不是合法 JSON：Unexpected end\n原文：{\"a\":  1")),
    "OpenAI 返回的不是合法 JSON：Unexpected end 原文：{\"a\": 1",
  );
  assert.equal(planningDegradationReason("镜头卡设计超时（40 秒没返回）"), "镜头卡设计超时（40 秒没返回）");
  assert.equal(planningDegradationReason(new Error(`x${"y".repeat(500)}`)).length, 300);
  assert.equal(
    planningDegradationReason(new Error("401 Incorrect API key provided: sk-abcdefghijklmnop1234")),
    "401 Incorrect API key provided: sk-[REDACTED]",
  );
  assert.equal(planningDegradationReason(new Error("")), "unknown error");
  assert.equal(planningDegradationReason(42), "42");
});

test("每一步对应一个兜底；记录形状 = 阶段 / 原因 / 兜底", () => {
  assert.deepEqual([...PLANNING_STAGES], [
    "creative_brief",
    "visual_reference",
    "consistency_bible",
    "segment_prompts",
    "shot_cards",
  ]);
  assert.deepEqual(PLANNING_FALLBACK_BY_STAGE, {
    creative_brief: "heuristic_brief",
    visual_reference: "no_visual_analysis",
    consistency_bible: "heuristic_bible",
    segment_prompts: "heuristic_segment_prompts",
    shot_cards: "template_beats",
  });
  assert.deepEqual(planningDegradation("consistency_bible", new Error("OpenAI 返回了空响应")), {
    stage: "consistency_bible",
    reason: "OpenAI 返回了空响应",
    fallback: "heuristic_bible",
  });
});

test("收集器按流水线顺序给出（并行的两步谁先失败都一样），同一步保持记录先后", () => {
  const log = createPlanningDegradationLog();
  assert.deepEqual(log.list(), []);
  log.record(planningDegradation("segment_prompts", "b"));
  log.record(planningDegradation("visual_reference", "a"));
  log.record(planningDegradation("creative_brief", "c"));
  log.record(planningDegradation("segment_prompts", "d"));
  assert.deepEqual(
    log.list().map((entry) => `${entry.stage}:${entry.reason}`),
    ["creative_brief:c", "visual_reference:a", "segment_prompts:b", "segment_prompts:d"],
  );
});

test("读库里的 JSON：认得出的留下（兜底按阶段补齐），null / 旧数据 / 坏条目跳过", () => {
  assert.deepEqual(readPlanningDegradations(null), []);
  assert.deepEqual(readPlanningDegradations({ stage: "shot_cards" }), []);
  assert.deepEqual(
    readPlanningDegradations([
      { stage: "shot_cards", reason: "OpenAI 返回了空响应", fallback: "template_beats" },
      { stage: "shot_cards" },
      { stage: "nope", reason: "x" },
      "junk",
      null,
    ]),
    [
      { stage: "shot_cards", reason: "OpenAI 返回了空响应", fallback: "template_beats" },
      { stage: "shot_cards", reason: "", fallback: "template_beats" },
    ],
  );
});

test("运维日志：有降级打一行「前缀 + JSON」（带原因原文），没有不打", (t) => {
  const warn = mock.method(console, "warn", () => undefined);
  t.after(() => warn.mock.restore());
  logPlanningDegradations({ source: "plan", planId: "plan-1" }, []);
  assert.equal(warn.mock.callCount(), 0);
  const degradations = [planningDegradation("visual_reference", new Error("400 Unable to download content"))];
  logPlanningDegradations({ source: "storyboard", runId: "run-1" }, degradations);
  assert.equal(warn.mock.callCount(), 1);
  const [line] = warn.mock.calls[0].arguments as [string];
  assert.ok(line.startsWith(`${PLANNING_DEGRADED_LOG_PREFIX} {`));
  assert.ok(!line.includes("\n"));
  assert.deepEqual(JSON.parse(line.slice(PLANNING_DEGRADED_LOG_PREFIX.length + 1)), {
    source: "storyboard",
    runId: "run-1",
    degradations,
  });
});

test("商家提示：每一步都有中英两句人话，不带内部术语；质量评审 code 能来回认", () => {
  for (const stage of PLANNING_STAGES) {
    const zh = planningDegradationNotice(stage, "zh");
    const en = planningDegradationNotice(stage, "en");
    assert.match(zh, /^这次 AI /);
    assert.match(en, /^AI couldn't /);
    assert.doesNotMatch(en, /[\u3400-\u9fff]/u, `${stage} en has no CJK`);
    for (const copy of [zh, en]) {
      assert.equal(containsBannedCustomerTerm(copy), false, copy);
      assert.doesNotMatch(copy, /segment|prompt|provider|seedance|director|bible|llm|openai|gpt|fallback|heuristic|token/i, copy);
    }
    assert.equal(planningStageFromIssueCode(planningDegradationIssueCode(stage)), stage);
  }
  assert.equal(planningStageFromIssueCode("prompt_too_short"), null);
  assert.equal(planningStageFromIssueCode("planning_degraded_toString"), null);
});

test("质量评审：每个降级的步骤一条 warning（同一步只一条），英文原句、每条扣 5 分，不拦派发", () => {
  const base = {
    classification: {
      userType: "business",
      generationMode: "text_to_video_ad",
      videoGoal: "product_ad",
      targetPlatform: "tiktok",
      needsCTA: true,
      needsBrandPackaging: false,
      needsUserClipInsertion: false,
      confidence: 0.9,
      missingFields: [],
      warnings: [],
    },
    classifiedAssets: [],
    brandPackaging: {
      mode: "none",
      logoAssetId: null,
      endCardDurationSeconds: 0,
      cta: null,
      brandName: null,
      slogan: null,
      website: null,
      renderStrategy: "none",
      warnings: [],
    },
    segments: [],
    creativeBrief: {
      hook: "h",
      narrative: "n",
      targetAudience: "a",
      corePainPoint: "p",
      emotionalAngle: "e",
      keySellingPoints: ["k"],
      cta: null,
      platformFit: "f",
      recommendedDurationReason: "r",
      angleVariants: [],
    },
  } as unknown as Parameters<typeof buildQualityReview>[0];
  const clean = buildQualityReview(base);
  const degraded = buildQualityReview({
    ...base,
    planningDegradations: [
      planningDegradation("visual_reference", "x"),
      planningDegradation("consistency_bible", "y"),
      planningDegradation("consistency_bible", "z"),
    ],
  });
  assert.deepEqual(clean.warnings, []);
  assert.deepEqual(degraded.warnings, [
    {
      severity: "warning",
      code: "planning_degraded_visual_reference",
      message: planningDegradationNotice("visual_reference", "en"),
    },
    {
      severity: "warning",
      code: "planning_degraded_consistency_bible",
      message: planningDegradationNotice("consistency_bible", "en"),
    },
  ]);
  assert.equal(degraded.score, clean.score - 10);
  assert.equal(degraded.canDispatch, true);
});

test("方案 zod：带 planningDegradations 的方案能过校验；旧方案没有这个字段也能过", () => {
  const shape = videoGenerationPlanSchema.shape.planningDegradations;
  assert.equal(shape.safeParse(undefined).success, true);
  assert.equal(
    shape.safeParse([{ stage: "shot_cards", reason: "x", fallback: "template_beats" }]).success,
    true,
  );
  assert.equal(shape.safeParse([{ stage: "nope", reason: "x", fallback: "template_beats" }]).success, false);
});

/* ── buildPlan：假的 OpenAI，按系统提示词分辨是哪一步 ─────────────────── */

const LLM_ENV: Record<string, string | undefined> = {
  OPENAI_API_KEY: "sk-test-planning-degradation",
  LLM_FORCE_MOCK: undefined,
  DIRECTOR_FORCE_MOCK: undefined,
  SCRIPT_FORCE_MOCK: undefined,
  AIVORA_DRY_RUN: undefined,
  AI_PROVIDER: undefined,
  STORYBOARD_SHOT_CARDS: undefined,
};

function useEnv(t: TestContext, vars: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

type Stage = "brief" | "vision" | "bible" | "segments" | "shotCards";
type CreateParams = { model: string; messages: Array<{ role: string; content: unknown }> };

function stageOf(params: CreateParams): Stage {
  const system = String(params.messages[0]?.content ?? "");
  if (system.includes("creative strategist")) return "brief";
  if (system.includes("location scout")) return "vision";
  /// 段提示词的系统提示词里也提到 "consistency bible"，先认它
  if (system.includes("writing shot lists")) return "segments";
  if (system.includes("storyboard shot cards")) return "shotCards";
  if (system.includes("consistency bible")) return "bible";
  throw new Error(`unexpected OpenAI call: ${system.slice(0, 80)}`);
}

function ok(payload: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function apiError(status: number, message: string, code?: string) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

const LLM_PRODUCT = "A teal braided cotton rope dog toy with one knotted loop, 30cm long, chunky twisted strands.";

const GOOD: Record<Exclude<Stage, "shotCards">, unknown> = {
  brief: {
    hook: "A golden retriever sprints in with the knot in its mouth",
    narrative: "Tug of war, then the dog naps chewing the knot.",
    targetAudience: "Dog owners with heavy chewers",
    corePainPoint: "Toys that fall apart in a day",
    emotionalAngle: "Playful and cozy",
    keySellingPoints: ["Chew-proof cotton rope", "Tug and teeth cleaning"],
    cta: "Shop the rope toy",
    platformFit: "Vertical pet content",
    recommendedDurationReason: "15s fits one play loop",
    angleVariants: [],
  },
  vision: {
    isRealLocation: false,
    locationDescription: null,
    signageText: null,
    signageKind: null,
    keyFeatures: ["teal braided rope", "single knot loop"],
    productDescription: LLM_PRODUCT,
    viewsCovered: ["product on white"],
  },
  bible: {
    characterProfile: "A woman in her early 30s with a low ponytail, oat sweater and jeans, relaxed pet-owner vibe.",
    environmentProfile: "A bright living room with a light-oak floor, grey sofa and a round dog bed by the window.",
    productDescription: LLM_PRODUCT,
    lightingArc: ["soft morning daylight"],
    voiceProfile: "zh-CN, warm female voice",
    styleKeywords: "authentic handheld footage, natural light",
  },
  segments: {
    segments: [
      {
        shots: [
          { fromSec: 0, toSec: 5, visual: "Golden retriever runs in holding the teal rope knot", camera: "low tracking", dialogue: "" },
          { fromSec: 5, toSec: 10, visual: "Tug of war between the dog and the owner's hand", camera: "medium", dialogue: "" },
          { fromSec: 10, toSec: 15, visual: "Dog lies in its bed chewing the knot", camera: "close-up", dialogue: "" },
        ],
        negativePrompt: "low quality, blurry",
        cameraDirection: "handheld",
        visualDirection: "warm daylight",
        continuityNotes: "",
      },
    ],
  },
};

function stubOpenAi(t: TestContext, respond: (stage: Stage, params: CreateParams) => unknown): Stage[] {
  const calls: Stage[] = [];
  mock.method(openai.chat.completions, "create", (async (params: CreateParams) => {
    const stage = stageOf(params);
    calls.push(stage);
    return respond(stage, params);
  }) as never);
  t.after(() => mock.restoreAll());
  return calls;
}

function petToyRequest(): UnifiedVideoGenerationRequest {
  return {
    userType: "business",
    rawPrompt: "青绿色棉绳编织狗玩具，带一个绳结环。拍一只金毛在客厅里叼着绳结跑过来，和主人拔河，最后趴在狗窝里继续啃。",
    attachments: [1, 2].map((index) => ({
      id: `petToy-photo-${index}`,
      assetId: `petToy-photo-${index}`,
      type: "IMAGE",
      inferredRole: "product_image",
      roleConfidence: 1,
      userAssignedRole: "product_image",
      url: `https://example.public.blob.vercel-storage.com/petToy/${index}.png`,
      mimeType: "image/png",
      fileName: `petToy-${index}.png`,
    })),
    selectedDuration: 15,
    selectedAspectRatio: "9:16",
    selectedBrandEndingMode: "none",
    language: "zh-CN",
  } as unknown as UnifiedVideoGenerationRequest;
}

test("buildPlan 成功路径：四步都用上 AI → planningDegradations 为空，结果来自 LLM，只调四次", async (t) => {
  useEnv(t, LLM_ENV);
  const calls = stubOpenAi(t, (stage) => ok(GOOD[stage as Exclude<Stage, "shotCards">]));
  const plan = await buildPlan(petToyRequest());
  assert.deepEqual(plan.planningDegradations, []);
  assert.equal(plan.qualityReview.warnings.some((issue) => planningStageFromIssueCode(issue.code)), false);
  assert.equal(plan.consistencyBible?.productDescription, LLM_PRODUCT);
  assert.equal(plan.creativeBrief.hook, "A golden retriever sprints in with the knot in its mouth");
  assert.match(plan.segments.find((s) => s.type === "ai_generated_clip")?.prompt ?? "", /Tug of war/);
  assert.deepEqual([...calls].sort(), ["bible", "brief", "segments", "vision"]);
});

test("buildPlan 四步都失败：按流水线顺序记四条，原因是错误信息原文，兜底真的生效", async (t) => {
  useEnv(t, LLM_ENV);
  const warn = mock.method(console, "warn", () => undefined);
  stubOpenAi(t, (stage) => {
    if (stage === "brief") throw new Error("OpenAI 返回了空响应");
    if (stage === "vision") {
      throw apiError(400, "400 Unable to download content from the provided URL before the timeout.", "invalid_image_url");
    }
    if (stage === "bible") throw new Error("OpenAI 返回的不是合法 JSON：Unexpected end of JSON input\n原文：{\"characterProfile\": \"A wo");
    return ok({ note: "no segment array here" });
  });
  const plan = await buildPlan(petToyRequest());
  const degradations = plan.planningDegradations ?? [];
  /// 拉图失败的原文由 provider 层决定（拉图失败的转 data URL 重试会在前面加上它自己的说明），这里只认 OpenAI 原话还在
  assert.match(degradations[1]?.reason ?? "", /400 Unable to download content from the provided URL before the timeout\./);
  assert.deepEqual(degradations.map((entry, index) => (index === 1 ? { ...entry, reason: "<provider>" } : entry)), [
    { stage: "creative_brief", reason: "OpenAI 返回了空响应", fallback: "heuristic_brief" },
    { stage: "visual_reference", reason: "<provider>", fallback: "no_visual_analysis" },
    {
      stage: "consistency_bible",
      reason: "OpenAI 返回的不是合法 JSON：Unexpected end of JSON input 原文：{\"characterProfile\": \"A wo",
      fallback: "heuristic_bible",
    },
    { stage: "segment_prompts", reason: "LLM 没有返回段数组，整片改用模板镜头表", fallback: "heuristic_segment_prompts" },
  ] satisfies PlanningDegradation[]);
  /// 兜底确实接上了：没看到图、bible 也没写成 → 商品描述只剩「照参考图」的通用句
  assert.match(plan.consistencyBible?.productDescription ?? "", /^The exact product shown in the uploaded reference photos/);
  /// 方案照常出、照常可派发（降级不是 blocker）；商家在「请注意」里看到四句人话
  assert.equal(plan.qualityReview.canDispatch, true);
  assert.deepEqual(
    plan.qualityReview.warnings.map((issue) => planningStageFromIssueCode(issue.code)).filter(Boolean),
    ["creative_brief", "visual_reference", "consistency_bible", "segment_prompts"],
  );
  assert.equal(videoGenerationPlanSchema.safeParse(JSON.parse(JSON.stringify(plan))).success, true);
  /// 运维一行：带方案 id 与原因原文
  const lines = warn.mock.calls
    .map((call) => String(call.arguments[0]))
    .filter((line) => line.startsWith(PLANNING_DEGRADED_LOG_PREFIX));
  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0].slice(PLANNING_DEGRADED_LOG_PREFIX.length + 1));
  assert.equal(logged.source, "plan");
  assert.equal(logged.planId, plan.id);
  assert.deepEqual(logged.degradations, plan.planningDegradations);
});

test("buildPlan 只有一步失败：只记那一步，其余照常用 LLM", async (t) => {
  useEnv(t, LLM_ENV);
  stubOpenAi(t, (stage) => {
    if (stage === "bible") throw new Error("OpenAI 返回了空响应");
    return ok(GOOD[stage as Exclude<Stage, "shotCards">]);
  });
  const plan = await buildPlan(petToyRequest());
  assert.deepEqual(plan.planningDegradations, [
    { stage: "consistency_bible", reason: "OpenAI 返回了空响应", fallback: "heuristic_bible" },
  ]);
  /// bible 退回启发式时商品描述用看图结果（visual_reference 成功了）
  assert.equal(plan.consistencyBible?.productDescription, LLM_PRODUCT);
});

test("buildPlan 段提示词：某一段没给出镜头表 → 只那一段退回模板镜头表，记一条带段号", async (t) => {
  useEnv(t, LLM_ENV);
  stubOpenAi(t, (stage) => {
    if (stage !== "segments") return ok(GOOD[stage as Exclude<Stage, "shotCards">]);
    return ok({ segments: [{ shots: [], negativePrompt: "low quality" }] });
  });
  const plan = await buildPlan(petToyRequest());
  const aiSegments = plan.segments.filter((segment) => segment.type === "ai_generated_clip").length;
  assert.equal(aiSegments, 1);
  assert.deepEqual(plan.planningDegradations, [
    {
      stage: "segment_prompts",
      reason: "AI 段第 1 段（共 1 段）LLM 没给出可用镜头表，改用模板镜头表",
      fallback: "heuristic_segment_prompts",
    },
  ]);
});

test("buildPlan 不调 AI 的情况不记：强制 mock 是配置状态（能力状态管），没有图就不看图", async (t) => {
  useEnv(t, { ...LLM_ENV, LLM_FORCE_MOCK: "true" });
  const calls = stubOpenAi(t, () => {
    throw new Error("must not call OpenAI in forced mock");
  });
  const plan = await buildPlan(petToyRequest());
  assert.deepEqual(plan.planningDegradations, []);
  assert.equal(calls.length, 0);
});

test("buildPlan 没有图：不看图、不记 visual_reference", async (t) => {
  useEnv(t, LLM_ENV);
  const calls = stubOpenAi(t, (stage) => ok(GOOD[stage as Exclude<Stage, "shotCards">]));
  const plan = await buildPlan({ ...petToyRequest(), attachments: [] });
  assert.deepEqual(plan.planningDegradations, []);
  assert.equal(calls.includes("vision"), false);
});

/* ── 镜头卡：失败 / 超时 / 输出不合格各记一条，没调 LLM 不记 ───────────── */

const SHOT_INPUT = {
  story: "青绿色棉绳狗玩具，金毛叼着绳结跑过来，和主人拔河，最后趴在狗窝里继续啃。",
  beats: STORYBOARD_BEATS_SHORT,
  durationSec: 15,
  aspectRatio: "9:16",
  productImageCount: 3,
  personImageCount: 0,
};

const CARD: StoryboardShotCard = {
  lens: "24mm wide shot",
  camera: "knee height, locked off",
  composition: "dog foreground, sofa background",
  action: "the dog runs 2m toward the camera with the knot in its mouth",
  endState: "dog stops at the owner's feet",
  sound: "paws on wooden floor",
};

async function designWith(chat: unknown, extra: { timeoutMs?: number } = {}) {
  const recorded: PlanningDegradation[] = [];
  const cards = await designStoryboardShotCards(SHOT_INPUT, {
    enabled: true,
    llmAvailable: () => true,
    chat: chat as never,
    onDegraded: (degradation) => recorded.push(degradation),
    ...extra,
  });
  return { cards, recorded };
}

test("镜头卡：报错 / 超时 / 输出不合格各记一条（原因写明），返回 null 照旧退回模板节奏", async () => {
  const failed = await designWith(async () => {
    throw new Error("OpenAI 返回了空响应");
  });
  assert.equal(failed.cards, null);
  assert.deepEqual(failed.recorded, [{ stage: "shot_cards", reason: "OpenAI 返回了空响应", fallback: "template_beats" }]);

  const timedOut = await designWith(() => new Promise(() => undefined), { timeoutMs: 10 });
  assert.equal(timedOut.cards, null);
  assert.deepEqual(timedOut.recorded, [
    { stage: "shot_cards", reason: "镜头卡设计超时（0.01 秒没返回）", fallback: "template_beats" },
  ]);

  const tooFew = await designWith(async () => ({ data: { shots: [CARD] } }));
  assert.equal(tooFew.cards, null);
  assert.deepEqual(tooFew.recorded.map((entry) => entry.reason), ["LLM 只给了 1 张镜头卡（要 4 张）"]);

  const noArray = await designWith(async () => ({ data: { cards: "nope" } }));
  assert.deepEqual(noArray.recorded.map((entry) => entry.reason), ["LLM 输出里没有镜头卡数组（要 4 张）"]);

  const missingAction = await designWith(async () => ({
    data: { shots: [CARD, CARD, CARD, { ...CARD, action: "" }] },
  }));
  assert.equal(missingAction.cards, null);
  assert.deepEqual(missingAction.recorded.map((entry) => entry.reason), [
    "LLM 给的镜头卡有缺镜头 / 机位 / 动作的（要 4 张都齐），整套作废",
  ]);
});

test("镜头卡：成功不记；关掉 / LLM 不可用 / 没写故事（根本没调）也不记", async () => {
  const good = await designWith(async () => ({ data: { shots: [CARD, CARD, CARD, CARD] } }));
  assert.equal(good.cards?.length, 4);
  assert.deepEqual(good.recorded, []);

  const recorded: PlanningDegradation[] = [];
  const onDegraded = (degradation: PlanningDegradation) => recorded.push(degradation);
  const chat = (async () => {
    throw new Error("must not be called");
  }) as never;
  assert.equal(await designStoryboardShotCards(SHOT_INPUT, { enabled: false, llmAvailable: () => true, chat, onDegraded }), null);
  assert.equal(await designStoryboardShotCards(SHOT_INPUT, { enabled: true, llmAvailable: () => false, chat, onDegraded }), null);
  assert.equal(
    await designStoryboardShotCards({ ...SHOT_INPUT, story: "  " }, { enabled: true, llmAvailable: () => true, chat, onDegraded }),
    null,
  );
  assert.deepEqual(recorded, []);
});

/* ── 建故事板：镜头卡的降级记到 run 上 ───────────────────────────────── */

function patch(t: TestContext, model: Record<string, unknown>, patches: Record<string, unknown>) {
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = model[key];
    model[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) model[key] = originals[key];
  });
}

/** 建 run 时截住写库的 data（抛哨兵错误，不往下提交帧）。 */
function captureRunCreate(t: TestContext): Array<Record<string, unknown>> {
  const created: Array<Record<string, unknown>> = [];
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findUnique: async () => null,
    create: async (args: { data: Record<string, unknown> }) => {
      created.push(args.data);
      throw new Error("stop after create");
    },
  });
  return created;
}

const RUN_INPUT = {
  userId: "owner-1",
  prompt: SHOT_INPUT.story,
  durationSec: 15,
  aspectRatio: "9:16" as const,
  voiceoverScript: "耐咬的棉绳结，拔河、磨牙都靠它。",
};

test("建故事板：镜头卡 LLM 失败 → run.planningDegradations 记一条，帧照旧按模板节奏", async (t) => {
  useEnv(t, LLM_ENV);
  const warn = mock.method(console, "warn", () => undefined);
  stubOpenAi(t, () => {
    throw new Error("OpenAI 返回了空响应");
  });
  const created = captureRunCreate(t);
  await assert.rejects(createStoryboardRun({ ...RUN_INPUT, idempotencyKey: "degraded-run" }), /stop after create/);
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].planningDegradations, [
    { stage: "shot_cards", reason: "OpenAI 返回了空响应", fallback: "template_beats" },
  ]);
  const frames = (created[0].frames as { create: Array<{ prompt: string }> }).create;
  assert.ok(frames.length > 0);
  assert.ok(frames.every((frame) => !frame.prompt.includes("SHOT CARD: ")));
  const lines = warn.mock.calls
    .map((call) => String(call.arguments[0]))
    .filter((line) => line.startsWith(PLANNING_DEGRADED_LOG_PREFIX));
  assert.deepEqual(lines.map((line) => JSON.parse(line.slice(PLANNING_DEGRADED_LOG_PREFIX.length + 1))), [
    { source: "storyboard", runId: created[0].id, degradations: created[0].planningDegradations },
  ]);
});

test("建故事板：镜头卡用上了写 []；批量 run 不设计镜头卡也写 []", async (t) => {
  useEnv(t, LLM_ENV);
  const calls = stubOpenAi(t, () => ok({ shots: [CARD, CARD, CARD, CARD] }));
  const created = captureRunCreate(t);
  await assert.rejects(createStoryboardRun({ ...RUN_INPUT, idempotencyKey: "good-run" }), /stop after create/);
  assert.deepEqual(created[0].planningDegradations, []);
  const frames = (created[0].frames as { create: Array<{ prompt: string }> }).create;
  assert.ok(frames.every((frame) => frame.prompt.includes("SHOT CARD: ")));

  await assert.rejects(
    createStoryboardRun({ ...RUN_INPUT, idempotencyKey: "batch-run", purpose: "batch-video-storyboard" }),
    /stop after create/,
  );
  assert.deepEqual(created[1].planningDegradations, []);
  assert.deepEqual(calls, ["shotCards"], "batch runs never call the shot-card LLM");
});

/* ── 看得到：故事板视图 / 面板、方案卡 ────────────────────────────── */

function viewOf(planningDegradations: unknown, status = "AWAITING_APPROVAL") {
  return storyboardRunView({
    id: "run-1",
    status,
    approvalPolicy: "MANUAL",
    durationSec: 15,
    aspectRatio: "9:16",
    approvedAt: null,
    errorCode: null,
    errorMessage: null,
    dispatchReservationKey: null,
    videoBriefId: null,
    videoJobId: null,
    planningDegradations,
    frames: [],
  } as never);
}

test("故事板视图只下发降级的步骤（去重），不下发原因原文；旧 run 为空", () => {
  const view = viewOf([
    { stage: "shot_cards", reason: "OpenAI 返回了空响应", fallback: "template_beats" },
    { stage: "shot_cards", reason: "again", fallback: "template_beats" },
  ]);
  assert.deepEqual(view.degradedStages, ["shot_cards"]);
  assert.doesNotMatch(JSON.stringify(view), /OpenAI 返回了空响应/);
  assert.deepEqual(viewOf(null).degradedStages, []);
});

test("故事板面板：镜头卡退回模板节奏时提醒一句（与「请注意」同色），锁定后、没降级时都不提醒", () => {
  const render = (english: boolean, view: ReturnType<typeof viewOf>) =>
    renderToStaticMarkup(
      React.createElement(StoryboardWorkflowPanel, {
        run: view,
        english,
        busyFrameId: null,
        approving: false,
        onRegenerate: () => undefined,
        onApprove: () => undefined,
        onEditPlan: () => undefined,
      }),
    );
  const degraded = viewOf([{ stage: "shot_cards", reason: "x", fallback: "template_beats" }]);
  const zh = render(false, degraded);
  assert.match(zh, /data-testid="storyboard-degraded-notice"/);
  assert.match(zh, /text-warning/);
  assert.ok(zh.includes(planningDegradationNotice("shot_cards", "zh")));
  assert.ok(render(true, degraded).includes(planningDegradationNotice("shot_cards", "en").replaceAll("'", "&#x27;")));
  assert.doesNotMatch(render(false, viewOf(null)), /storyboard-degraded-notice/);
  const approved = viewOf([{ stage: "shot_cards", reason: "x", fallback: "template_beats" }], "APPROVED");
  assert.doesNotMatch(render(false, approved), /storyboard-degraded-notice/);
});

test("方案卡：降级提醒进「请注意」，按界面语言给人话，原因原文不上屏", async (t) => {
  useEnv(t, LLM_ENV);
  mock.method(console, "warn", () => undefined);
  stubOpenAi(t, (stage) => {
    if (stage === "vision") throw apiError(400, "400 Unable to download content from the provided URL before the timeout.");
    return ok(GOOD[stage as Exclude<Stage, "shotCards">]);
  });
  const plan = await buildPlan(petToyRequest());
  const render = (locale: "zh-CN" | "en-US", value: VideoGenerationPlan) =>
    renderToStaticMarkup(
      React.createElement(
        /// children 走第三个参数（lint 不许当 prop 传），这里把 Provider 的 children 标成可选让类型对上
        I18nProvider as React.ComponentType<{ initialLocale: "zh-CN" | "en-US"; children?: React.ReactNode }>,
        { initialLocale: locale },
        React.createElement(PlanPreviewCard, { plan: value }),
      ),
    );
  const zh = render("zh-CN", plan);
  assert.match(zh, /请注意/);
  assert.ok(zh.includes(planningDegradationNotice("visual_reference", "zh")));
  assert.doesNotMatch(zh, /Unable to download|AI couldn&#x27;t/);
  const en = render("en-US", plan);
  assert.ok(en.includes(planningDegradationNotice("visual_reference", "en").replaceAll("'", "&#x27;")));
  /// 没降级的方案不出这句
  const clean = { ...plan, qualityReview: { ...plan.qualityReview, warnings: [] }, planningDegradations: [] };
  assert.doesNotMatch(render("zh-CN", clean), /这次 AI/);
});
