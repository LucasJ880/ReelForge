import assert from "node:assert/strict";
import test, { mock } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StoryboardWorkflowPanel } from "../src/components/video-generation/storyboard-workflow-panel";
import { containsBannedCustomerTerm } from "../src/lib/video-generation/business-status";
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
import { storyboardRunView } from "../src/lib/video-generation/storyboard-service";
import { videoGenerationPlanSchema } from "../src/lib/schemas/unified-input";

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
    "director_script",
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
    director_script: "shot_card_storyboard",
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

// ---------------------------------------------------------------------------
// 2026-11-09：此前只打一行 console.warn 的三处降级
// ---------------------------------------------------------------------------

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

/// 11-17 起有商品图的 15 / 30 秒单条片缺省走导演线路（tests/director-line.test.ts）；这两条守的是老线路，
/// 所以把总开关关掉（DIRECTOR_LINE=off 就是线上退回老线路的办法）

