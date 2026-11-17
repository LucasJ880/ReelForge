import assert from "node:assert/strict";
import test from "node:test";
import {
  DIRECTOR_PROMPT_VERSION,
  parseDirectorPlan,
  safeParseDirectorPlan,
} from "../src/lib/schemas/director-plan";
import { mockDirectorPlan } from "./helpers/director-plan-fixture";
import { planSegments } from "../src/lib/duration/segment-planner";

function ctx(targetDurationSec: 15 | 30 | 60) {
  return {
    targetDurationSec,
    segmentSlots: planSegments(targetDurationSec),
    clientBrief: {
      businessName: "Acme",
      productName: "Acme Smart Blinds",
      brandAssets: { logoUrl: "https://example.com/logo.png" },
    },
    productInput: {},
    targetCountry: "US",
    targetLanguage: "en-US",
    targetPlatform: "tiktok",
    angle: {
      title: "Hands-free morning routine",
      hook: "What if your blinds opened with the sunrise?",
      narrative: null,
      type: "OPTIMIZATION",
      explorationTheme: null,
      localeNotes: null,
    },
  };
}

test("DirectorPlan: 15s mock 通过 zod 校验，1 段", () => {
  const plan = parseDirectorPlan(mockDirectorPlan(ctx(15)));
  assert.equal(plan.version, DIRECTOR_PROMPT_VERSION);
  assert.equal(plan.targetDurationSec, 15);
  assert.equal(plan.segmentPlan.length, 1);
  assert.equal(plan.segmentPlan[0].segmentIndex, 0);
});

test("DirectorPlan: 30s mock 通过 zod 校验，2 段连续", () => {
  const plan = parseDirectorPlan(mockDirectorPlan(ctx(30)));
  assert.equal(plan.targetDurationSec, 30);
  assert.equal(plan.segmentPlan.length, 2);
  assert.equal(plan.segmentPlan[0].fromSec, 0);
  assert.equal(plan.segmentPlan[0].toSec, 15);
  assert.equal(plan.segmentPlan[1].fromSec, 15);
  assert.equal(plan.segmentPlan[1].toSec, 30);
  /// 每段必须有非空 seedancePrompt
  for (const s of plan.segmentPlan) {
    assert.ok(s.seedancePrompt.length > 10);
  }
});

test("DirectorPlan: 60s mock 通过 zod 校验，4 段连续", () => {
  const plan = parseDirectorPlan(mockDirectorPlan(ctx(60)));
  assert.equal(plan.targetDurationSec, 60);
  assert.equal(plan.segmentPlan.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.equal(plan.segmentPlan[i].segmentIndex, i);
    assert.equal(plan.segmentPlan[i].fromSec, i * 15);
    assert.equal(plan.segmentPlan[i].toSec, i * 15 + 15);
  }
});

test("DirectorPlan: editingPlan.stitchOrder 与 segmentPlan 对齐", () => {
  for (const d of [15, 30, 60] as const) {
    const plan = parseDirectorPlan(mockDirectorPlan(ctx(d)));
    assert.deepEqual(
      plan.editingPlan.stitchOrder,
      plan.segmentPlan.map((s) => s.segmentIndex),
    );
  }
});

test("DirectorPlan: timeline 块数量随时长增加", () => {
  const p15 = parseDirectorPlan(mockDirectorPlan(ctx(15)));
  const p30 = parseDirectorPlan(mockDirectorPlan(ctx(30)));
  const p60 = parseDirectorPlan(mockDirectorPlan(ctx(60)));
  assert.ok(p30.timelineScript.length > p15.timelineScript.length);
  assert.ok(p60.timelineScript.length > p30.timelineScript.length);
});

test("DirectorPlan: schema 拒绝缺少 segmentPlan 的对象", () => {
  const result = safeParseDirectorPlan({
    version: DIRECTOR_PROMPT_VERSION,
    language: "en-US",
    targetDurationSec: 15,
    platform: "tiktok",
    strategySummary: {
      targetAudience: "x",
      corePainPoint: "y",
      emotionalAngle: "z",
      keySellingPoints: ["w"],
    },
    timelineScript: [
      {
        fromSec: 0,
        toSec: 5,
        visual: "x",
      },
    ],
    /// 故意省略 segmentPlan
  });
  assert.equal(result.ok, false);
});

test("DirectorPlan: schema 接受最小合法对象（zod 默认值兜底）", () => {
  const result = safeParseDirectorPlan({
    version: DIRECTOR_PROMPT_VERSION,
    language: "en-US",
    targetDurationSec: 15,
    platform: "tiktok",
    strategySummary: {
      targetAudience: "x",
      corePainPoint: "y",
      emotionalAngle: "z",
      keySellingPoints: ["w"],
    },
    timelineScript: [{ fromSec: 0, toSec: 5, visual: "x" }],
    segmentPlan: [
      {
        segmentIndex: 0,
        durationSec: 15,
        fromSec: 0,
        toSec: 15,
        role: "hook",
        seedancePrompt: "a clear visual prompt",
      },
    ],
    editingPlan: {},
  });
  assert.equal(result.ok, true);
});
