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
import { leanPlanningEnabled } from "../src/lib/video-generation/planning-mode";
import { groundSegmentPromptForSeedanceOpeningFrame } from "../src/lib/video-generation/storyboard-beats";
import {
  PLANNING_DEGRADED_LOG_PREFIX,
  PLANNING_FALLBACK_BY_STAGE,
  PLANNING_STAGES,
  createPlanningDegradationLog,
  mergePlanningDegradation,
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
    "story_english",
    "presenter_reference",
    "frame_prompt",
  ]);
  assert.deepEqual(PLANNING_FALLBACK_BY_STAGE, {
    creative_brief: "heuristic_brief",
    visual_reference: "no_visual_analysis",
    consistency_bible: "heuristic_bible",
    segment_prompts: "heuristic_segment_prompts",
    shot_cards: "template_beats",
    story_english: "original_wording",
    presenter_reference: "no_presenter_reference",
    frame_prompt: "trimmed_prompt",
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
  /// 缺省 = 出方案精简（planning-mode.ts）：一致性设定与段提示词不调模型
  PLANNING_FULL_LLM: undefined,
};

/// 退回开关打开：四步都调模型的旧路径。下面四条「四步」用例守的是这条仍然保留的退路。
const FULL_LLM_ENV: Record<string, string | undefined> = { ...LLM_ENV, PLANNING_FULL_LLM: "on" };

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
    /// 建故事板时顺带把商家原话译成英文（story-english）。这里一律译成功、不计入 calls：
    /// 这些用例测的是各步降级，译文失败自己的记录在文件末尾单独测（2026-11-09 起译不成也记一条）。
    if (String(params.messages[0]?.content ?? "").includes("You translate a small business owner's request")) {
      return ok({ english: "A golden retriever plays tug of war with a teal rope toy, then naps chewing the knot." });
    }
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
  useEnv(t, FULL_LLM_ENV);
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
  useEnv(t, FULL_LLM_ENV);
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
  useEnv(t, FULL_LLM_ENV);
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
  useEnv(t, FULL_LLM_ENV);
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

// ---------------------------------------------------------------------------
// 2026-11-09：此前只打一行 console.warn 的三处降级
// ---------------------------------------------------------------------------

test("原话译英文：超时 / 输出仍是中文 / 报错都记一条 story_english；已是英文、开关关着、LLM 没配置不算降级", async () => {
  const { renderStoryInEnglish } = await import("../src/lib/video-generation/story-english");
  const story = "一位妈妈在厨房里给孩子倒热水，保温杯一整天都是热的";
  const collect = () => {
    const recorded: Array<{ stage: string; fallback: string; reason: string }> = [];
    return { recorded, onDegraded: (entry: { stage: string; fallback: string; reason: string }) => void recorded.push(entry) };
  };

  const timedOut = collect();
  assert.equal(
    await renderStoryInEnglish(story, {
      enabled: true,
      llmAvailable: () => true,
      chat: (() => new Promise(() => undefined)) as never,
      timeoutMs: 10,
      onDegraded: timedOut.onDegraded,
    }),
    null,
  );
  assert.deepEqual(timedOut.recorded.map((entry) => [entry.stage, entry.fallback]), [["story_english", "original_wording"]]);
  assert.match(timedOut.recorded[0]?.reason ?? "", /timed out/);

  const rejected = collect();
  await renderStoryInEnglish(story, {
    enabled: true,
    llmAvailable: () => true,
    chat: (async () => ({ data: { english: story } })) as never,
    onDegraded: rejected.onDegraded,
  });
  assert.equal(rejected.recorded.length, 1, "译出来还是中文 = 没用上");

  const threw = collect();
  await renderStoryInEnglish(story, {
    enabled: true,
    llmAvailable: () => true,
    chat: (async () => {
      throw new Error("429 You have no credits remaining");
    }) as never,
    onDegraded: threw.onDegraded,
  });
  assert.equal(threw.recorded[0]?.reason, "429 You have no credits remaining");

  const quiet = collect();
  const never = (async () => {
    throw new Error("must not be called");
  }) as never;
  assert.equal(await renderStoryInEnglish("A mom pours hot water in the kitchen.", { enabled: true, chat: never, onDegraded: quiet.onDegraded }), "A mom pours hot water in the kitchen.");
  assert.equal(await renderStoryInEnglish(story, { enabled: false, chat: never, onDegraded: quiet.onDegraded }), null);
  assert.equal(await renderStoryInEnglish(story, { enabled: true, llmAvailable: () => false, chat: never, onDegraded: quiet.onDegraded }), null);
  assert.deepEqual(quiet.recorded, []);

  const ok = collect();
  assert.equal(
    await renderStoryInEnglish(story, {
      enabled: true,
      llmAvailable: () => true,
      chat: (async () => ({ data: { english: "A mom pours hot water for her kid; the bottle stays hot all day." } })) as never,
      onDegraded: ok.onDegraded,
    }),
    "A mom pours hot water for her kid; the bottle stays hot all day.",
  );
  assert.deepEqual(ok.recorded, [], "译成了不记");
});

test("出帧阶段的降级并进 run：同一步只留第一条，按流水线顺序排，旧数据照读", () => {
  const presenter = planningDegradation("presenter_reference", "presenter photos resolved to nothing (2 selected)");
  assert.deepEqual(mergePlanningDegradation(null, presenter), [presenter]);
  assert.equal(mergePlanningDegradation([presenter], presenter), null, "逐帧提交会重复撞见同一个问题，不重复写库");

  const shotCards = planningDegradation("shot_cards", "OpenAI 返回了空响应");
  const trimmed = planningDegradation("frame_prompt", "frame 3 prompt trimmed from 5210 to 5000 chars");
  assert.deepEqual(
    mergePlanningDegradation([trimmed, { stage: "legacy_unknown" }], shotCards)?.map((entry) => entry.stage),
    ["shot_cards", "frame_prompt"],
  );
});

test("新增三步都有给商家看的中英文提醒，且不带内部术语", () => {
  for (const stage of ["story_english", "presenter_reference", "frame_prompt"] as const) {
    for (const locale of ["zh", "en"] as const) {
      const notice = planningDegradationNotice(stage, locale);
      assert.ok(notice.length > 10, `${stage}/${locale}`);
      assert.equal(containsBannedCustomerTerm(notice), false, `${stage}/${locale} 不能出现内部术语`);
    }
    assert.equal(planningStageFromIssueCode(planningDegradationIssueCode(stage)), stage);
  }
});

// ---------------------------------------------------------------------------
// 出方案精简（2026-11-09，planning-mode.ts）：一致性设定与段提示词的产出在按故事板改写时被丢弃，不再为它们调模型
// ---------------------------------------------------------------------------

const SOAK_STORY_EN = "A golden retriever runs into a bright living room with a teal rope toy, plays tug of war with its owner, then naps chewing the knot.";
const SOAK_BEATS = ["叼着绳结跑进客厅", "和主人拔河", "趴在狗窝里啃绳结"];

function groundForVideo(original: string): string {
  return groundSegmentPromptForSeedanceOpeningFrame(original, {
    aspectRatio: "9:16",
    story: SOAK_STORY_EN,
    beats: SOAK_BEATS,
    productPhotoCount: 2,
    totalDurationSec: 15,
    fromSec: 0,
    toSec: 15,
  });
}

test("精简缺省开：出方案只调两次模型（创意简报、看商品图），并行一个阶段；不记降级", async (t) => {
  useEnv(t, LLM_ENV);
  assert.equal(leanPlanningEnabled({}), true);
  const calls = stubOpenAi(t, (stage) => ok(GOOD[stage as Exclude<Stage, "shotCards">]));
  const plan = await buildPlan(petToyRequest());
  assert.deepEqual([...calls].sort(), ["brief", "vision"], "一致性设定与段提示词不再调模型");
  assert.deepEqual(plan.planningDegradations, [], "按设计不调，不是降级");
  assert.equal(plan.qualityReview.warnings.some((issue) => planningStageFromIssueCode(issue.code)), false);
  assert.equal(plan.qualityReview.canDispatch, true);
  /// 方案卡给商家看的开场与卖点仍由模型写
  assert.equal(plan.creativeBrief.hook, "A golden retriever sprints in with the knot in its mouth");
  /// 商品描述直接用「看商品图」那一步的原话，不再经没看图的模型转述
  assert.equal(plan.consistencyBible?.productDescription, LLM_PRODUCT);
  const prompt = plan.segments.find((s) => s.type === "ai_generated_clip")?.prompt ?? "";
  assert.match(prompt, /^PRODUCT \(must exactly match the reference images\): A teal braided cotton rope dog toy/mu);
});

test("精简：看商品图失败照旧记一条并兜底；被跳过的两步不会凭空多出降级记录", async (t) => {
  useEnv(t, LLM_ENV);
  mock.method(console, "warn", () => undefined);
  const calls = stubOpenAi(t, (stage) => {
    if (stage === "vision") throw apiError(400, "400 Unable to download content from the provided URL before the timeout.", "invalid_image_url");
    return ok(GOOD[stage as Exclude<Stage, "shotCards">]);
  });
  const plan = await buildPlan(petToyRequest());
  assert.deepEqual((plan.planningDegradations ?? []).map((entry) => entry.stage), ["visual_reference"]);
  assert.ok(!calls.includes("bible") && !calls.includes("segments"));
  assert.match(plan.consistencyBible?.productDescription ?? "", /^The exact product shown in the uploaded reference photos/);
});

test("退回开关：PLANNING_FULL_LLM=on / true / 1 / yes 走回四次调用；其它值与缺省都是精简", () => {
  for (const value of ["on", "ON", " true ", "1", "yes"]) {
    assert.equal(leanPlanningEnabled({ PLANNING_FULL_LLM: value }), false, value);
  }
  for (const value of ["off", "0", "", "false", "lean"]) {
    assert.equal(leanPlanningEnabled({ PLANNING_FULL_LLM: value }), true, value);
  }
});

test("交给视频模型的提示词：精简与旧路径按同一份故事板改写后逐字相同（丢掉的那两次调用本来就没进成片提示词）", async (t) => {
  useEnv(t, FULL_LLM_ENV);
  stubOpenAi(t, (stage) => ok(GOOD[stage as Exclude<Stage, "shotCards">]));
  const full = await buildPlan(petToyRequest());
  process.env.PLANNING_FULL_LLM = "off";
  const lean = await buildPlan(petToyRequest());
  const fullSegment = full.segments.find((s) => s.type === "ai_generated_clip");
  const leanSegment = lean.segments.find((s) => s.type === "ai_generated_clip");
  assert.ok(fullSegment?.prompt && leanSegment?.prompt);
  /// 改写前两份不同：旧路径带模型写的镜头表（Tug of war…），精简是模板镜头表
  assert.notEqual(fullSegment.prompt, leanSegment.prompt);
  assert.match(fullSegment.prompt, /Tug of war/);
  /// 改写后（真正提交给 Shuyu 的那一份）逐字相同：剧情与镜头来自故事板，方案里只留 PRODUCT / LOCK / Audio / 口播行
  const groundedFull = groundForVideo(fullSegment.prompt);
  const groundedLean = groundForVideo(leanSegment.prompt);
  assert.equal(groundedLean, groundedFull);
  assert.match(groundedLean, /teal braided cotton rope dog toy/, "商品描述还在");
  assert.doesNotMatch(groundedFull, /Tug of war between the dog and the owner's hand/, "模型写的镜头表本来就不在成片提示词里");
  /// 唯一不在这份文本里、但会拼到提交尾部的差别：负面提示词。旧路径是模型每次自由写的一句，精简是固定的一句
  assert.match(fullSegment.negativePrompt ?? "", /^low quality, blurry, /, "旧路径：模型写的那句 + 固定的品牌防护尾巴");
  assert.notEqual(leanSegment.negativePrompt, fullSegment.negativePrompt);
  assert.match(leanSegment.negativePrompt ?? "", /text|subtitle|watermark/i, "精简：固定的一句，同样不许画面出字");
});

test("开着口播：精简与旧路径的声音行、口播台词行逐字相同（都用商家确认过的口播稿）", async (t) => {
  const withVoiceover = (): UnifiedVideoGenerationRequest => ({
    ...petToyRequest(),
    audio: {
      voiceover: { enabled: true, script: "我家狗子拆家第一名，这根绳结它啃了一个月还好好的。", voiceId: "warm-confident", language: "zh-CN" },
    },
  }) as unknown as UnifiedVideoGenerationRequest;
  useEnv(t, FULL_LLM_ENV);
  stubOpenAi(t, (stage) => ok(GOOD[stage as Exclude<Stage, "shotCards">]));
  const full = await buildPlan(withVoiceover());
  process.env.PLANNING_FULL_LLM = "off";
  const lean = await buildPlan(withVoiceover());
  const groundedFull = groundForVideo(full.segments.find((s) => s.type === "ai_generated_clip")?.prompt ?? "");
  const groundedLean = groundForVideo(lean.segments.find((s) => s.type === "ai_generated_clip")?.prompt ?? "");
  assert.equal(groundedLean, groundedFull);
  assert.match(groundedLean, /Spoken dialogue \(voice only, exact wording, zh-CN/u);
  assert.match(groundedLean, /这根绳结它啃了一个月还好好的/u);
});

test("关着口播：精简固定写「不要旁白」；旧路径里模型给镜头写了台词就会要求念台词（台词行却已被丢掉）", async (t) => {
  const chatty = {
    segments: [
      {
        ...(GOOD.segments as { segments: Array<Record<string, unknown>> }).segments[0],
        shots: [
          { fromSec: 0, toSec: 8, visual: "Dog runs in with the rope toy", camera: "low tracking", dialogue: "Look at him go!" },
          { fromSec: 8, toSec: 15, visual: "Dog naps chewing the knot", camera: "close-up", dialogue: "" },
        ],
      },
    ],
  };
  useEnv(t, FULL_LLM_ENV);
  stubOpenAi(t, (stage) => ok(stage === "segments" ? chatty : GOOD[stage as Exclude<Stage, "shotCards">]));
  const full = await buildPlan(petToyRequest());
  process.env.PLANNING_FULL_LLM = "off";
  const lean = await buildPlan(petToyRequest());
  const groundedFull = groundForVideo(full.segments.find((s) => s.type === "ai_generated_clip")?.prompt ?? "");
  const groundedLean = groundForVideo(lean.segments.find((s) => s.type === "ai_generated_clip")?.prompt ?? "");
  assert.match(groundedFull, /Audio: natural voiceover speaking the quoted dialogue lines/u, "旧路径：要求念台词");
  assert.doesNotMatch(groundedFull, /Look at him go/u, "……但台词本身不在成片提示词里");
  assert.match(groundedLean, /Audio: real environment ambience only, no background music, no narration\./u);
  assert.doesNotMatch(groundedLean, /speaking the quoted dialogue lines/u);
});

// ---------------------------------------------------------------------------
// 出方案并成一次（第二步，storyboard-direction.ts）：建故事板一次看图调用，派发视频不再重新看图
// ---------------------------------------------------------------------------

const DIRECTION_REFERENCE = {
  isRealLocation: false,
  locationDescription: null,
  signageText: null,
  signageKind: null,
  keyFeatures: ["teal braided rope", "single knot loop"],
  productDescription: LLM_PRODUCT,
  viewsCovered: ["product on white", "knot detail"],
};

function withProductPhotos(t: TestContext) {
  patch(t, db.mediaAsset as unknown as Record<string, unknown>, {
    findMany: async () => [
      { id: "asset-1", url: "https://example.public.blob.vercel-storage.com/petToy/1.png", mimeType: "image/png", userId: "owner-1" },
      { id: "asset-2", url: "https://example.public.blob.vercel-storage.com/petToy/2.png", mimeType: "image/png", userId: "owner-1" },
    ],
  });
}

test("建故事板（有商品图）：一次看图调用同时出镜头卡、英译与盘点；盘点随 run 落库", async (t) => {
  useEnv(t, LLM_ENV);
  withProductPhotos(t);
  const systems: string[] = [];
  mock.method(openai.chat.completions, "create", (async (params: CreateParams) => {
    systems.push(String(params.messages[0]?.content ?? ""));
    return ok({
      shots: [CARD, CARD, CARD, CARD],
      english: "A golden retriever runs in with a teal rope toy, plays tug of war, then naps chewing the knot.",
      reference: DIRECTION_REFERENCE,
    });
  }) as never);
  t.after(() => mock.restoreAll());
  const created = captureRunCreate(t);
  await assert.rejects(
    createStoryboardRun({ ...RUN_INPUT, idempotencyKey: "direction-run", sourceAssetIds: ["asset-1", "asset-2"] }),
    /stop after create/,
  );
  assert.equal(systems.length, 1, "只调一次模型（此前是镜头卡 + 英译两次，且都没看图）");
  assert.match(systems[0] ?? "", /you can SEE the merchant's real photos/);
  assert.deepEqual(created[0].planningDegradations, []);
  assert.deepEqual(created[0].visualReference, { ...DIRECTION_REFERENCE, photoCount: 2 });
  const frames = (created[0].frames as { create: Array<{ prompt: string }> }).create;
  assert.ok(frames.every((frame) => frame.prompt.includes("SHOT CARD: ")), "镜头卡进了每一帧");
  assert.ok(frames.every((frame) => frame.prompt.includes("A golden retriever runs in with a teal rope toy")), "英译进了每一帧");
});

test("建故事板：合并调用只给了镜头卡 → 只补跑英译；盘点留空（派发时现看），不记降级", async (t) => {
  useEnv(t, LLM_ENV);
  withProductPhotos(t);
  mock.method(console, "warn", () => undefined);
  const systems: string[] = [];
  mock.method(openai.chat.completions, "create", (async (params: CreateParams) => {
    const system = String(params.messages[0]?.content ?? "");
    systems.push(system);
    if (system.includes("You translate a small business owner's request")) {
      return ok({ english: "A golden retriever plays tug of war with a teal rope toy." });
    }
    return ok({ shots: [CARD, CARD, CARD, CARD] });
  }) as never);
  t.after(() => mock.restoreAll());
  const created = captureRunCreate(t);
  await assert.rejects(
    createStoryboardRun({ ...RUN_INPUT, idempotencyKey: "partial-direction-run", sourceAssetIds: ["asset-1", "asset-2"] }),
    /stop after create/,
  );
  assert.equal(systems.length, 2, "合并调用 + 只补英译；镜头卡不重跑");
  assert.ok(systems[1]?.includes("You translate a small business owner's request"));
  assert.equal(Object.hasOwn(created[0], "visualReference"), false, "没看出东西就不落库");
  assert.deepEqual(created[0].planningDegradations, []);
});

test("建故事板：合并调用整次失败 → 退回原来的两次调用，结果与合并前一样；STORYBOARD_DIRECTION=off 也走原路径", async (t) => {
  useEnv(t, LLM_ENV);
  withProductPhotos(t);
  mock.method(console, "warn", () => undefined);
  let first = true;
  const systems: string[] = [];
  mock.method(openai.chat.completions, "create", (async (params: CreateParams) => {
    const system = String(params.messages[0]?.content ?? "");
    systems.push(system);
    if (first) {
      first = false;
      throw apiError(500, "500 upstream error");
    }
    if (system.includes("You translate a small business owner's request")) {
      return ok({ english: "A golden retriever plays tug of war with a teal rope toy." });
    }
    return ok({ shots: [CARD, CARD, CARD, CARD] });
  }) as never);
  t.after(() => mock.restoreAll());
  const created = captureRunCreate(t);
  await assert.rejects(
    createStoryboardRun({ ...RUN_INPUT, idempotencyKey: "failed-direction-run", sourceAssetIds: ["asset-1", "asset-2"] }),
    /stop after create/,
  );
  assert.equal(systems.length, 3, "失败的合并调用 + 原来的镜头卡与英译");
  assert.deepEqual(created[0].planningDegradations, []);
  const frames = (created[0].frames as { create: Array<{ prompt: string }> }).create;
  assert.ok(frames.every((frame) => frame.prompt.includes("SHOT CARD: ")));

  process.env.STORYBOARD_DIRECTION = "off";
  t.after(() => {
    delete process.env.STORYBOARD_DIRECTION;
  });
  systems.length = 0;
  await assert.rejects(
    createStoryboardRun({ ...RUN_INPUT, idempotencyKey: "legacy-run", sourceAssetIds: ["asset-1", "asset-2"] }),
    /stop after create/,
  );
  assert.equal(systems.length, 2);
  assert.ok(systems.every((system) => !system.includes("you can SEE the merchant's real photos")), "开关关着不走合并调用");
});

test("派发视频：带上故事板存的盘点就不再重新看图，商品描述用存下来的那一句", async (t) => {
  useEnv(t, LLM_ENV);
  const calls = stubOpenAi(t, (stage) => ok(GOOD[stage as Exclude<Stage, "shotCards">]));
  const stored = { ...DIRECTION_REFERENCE, productDescription: "A stored description of the teal rope toy from storyboard time.", photoCount: 2 };
  const plan = await buildPlan(petToyRequest(), { visualRefs: stored });
  assert.deepEqual([...calls], ["brief"], "只剩创意简报一次调用");
  assert.equal(plan.consistencyBible?.productDescription, stored.productDescription);
  assert.deepEqual(plan.planningDegradations, []);
  const prompt = plan.segments.find((s) => s.type === "ai_generated_clip")?.prompt ?? "";
  assert.match(prompt, /A stored description of the teal rope toy from storyboard time\./);
});
