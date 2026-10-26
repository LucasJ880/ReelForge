/**
 * P02-C · 主播参考图（AssetRole person）落到文字锚，且**只在开关 STORYBOARD_PERSON_REFS 放行时**生效：
 * - consistency bible 启发式兜底：有 person 图 → 具体人物描述 + 「与主播参考图同一人」；没有 / 开关 off → 原默认
 * - Seedance 段提示词 CHARACTER 行：有 person 参考 → 前缀 "must match the presenter reference photo"
 * - 纯产品模版 + 主播图：主播优先，不写「NO on-camera person」自相矛盾
 * 走 LLM 强制 mock，离线、确定。
 */
process.env.LLM_FORCE_MOCK = "true";
process.env.STORYBOARD_PERSON_REFS = "on";

import assert from "node:assert/strict";
import test from "node:test";
import { heuristicBible } from "../src/lib/video-generation/consistency-bible";
import { buildVideoSegments } from "../src/lib/video-generation/prompt-intelligence";
import { planUnifiedSegments } from "../src/lib/video-generation/segment-planner-adapter";
import { getStyleTemplate } from "../src/lib/video-generation/style-templates";
import { presenterReferenceAssets } from "../src/lib/video-generation/storyboard-person-refs";
import type {
  CreativeBrief,
  InputClassification,
  UploadedAsset,
} from "../src/types/video-generation";

const brief: CreativeBrief = {
  hook: "A navy roman shade drops into place as morning light softens",
  narrative: "Show the shade being lowered and raised in a real living room",
  targetAudience: "Homeowners 30-55",
  corePainPoint: "Harsh glare at breakfast",
  emotionalAngle: "Calm and control",
  keySellingPoints: ["cordless lift", "blackout lining"],
  cta: "Tap to shop",
  platformFit: "tiktok 9:16",
  recommendedDurationReason: "15s hook + payoff",
  angleVariants: [],
};

const classification: InputClassification = {
  userType: "business",
  generationMode: "text_to_video_ad",
  videoGoal: "product_ad",
  targetPlatform: "tiktok",
  needsCTA: true,
  needsBrandPackaging: true,
  needsUserClipInsertion: false,
  confidence: 0.9,
  missingFields: [],
  warnings: [],
};

function image(overrides: Partial<UploadedAsset>): UploadedAsset {
  return {
    id: "a1",
    type: "IMAGE",
    inferredRole: "product_image",
    roleConfidence: 0.8,
    url: "https://example.com/img.jpg",
    mimeType: "image/jpeg",
    fileName: "img.jpg",
    width: 1080,
    height: 1920,
    durationSeconds: null,
    ...overrides,
  };
}

const presenter = image({
  id: "p1",
  inferredRole: "reference_image",
  userAssignedRole: "person",
  url: "https://example.com/presenter.jpg",
  fileName: "presenter.jpg",
});

const PRESENTER_CHARACTER_PREFIX =
  /^CHARACTER \(must match the presenter reference photo — same face, hair, skin tone and build; keep 100% identical in every cut\): /m;

async function aiPrompts(assets: UploadedAsset[], styleTemplateId?: string): Promise<string[]> {
  const slots = planUnifiedSegments({ targetDurationSec: 15, clipPlacement: null, brandPackaging: null });
  const segments = await buildVideoSegments({
    creativeBrief: brief,
    segmentSlots: slots,
    classifiedAssets: assets,
    classification,
    aspectRatio: "9:16",
    styleTemplate: styleTemplateId ? getStyleTemplate(styleTemplateId) : null,
  });
  const prompts = segments.filter((segment) => segment.type === "ai_generated_clip").map((s) => s.prompt!);
  assert.ok(prompts.length > 0);
  return prompts;
}

test("bible 启发式兜底：有主播参考图时保留具体人物描述并追加「与主播参考图同一人」；没有时保持原默认", () => {
  const withPresenter = heuristicBible({
    creativeBrief: brief,
    classification,
    classifiedAssets: [presenter, image({ id: "prod" })],
    aiSegmentCount: 2,
    language: "zh-CN",
  });
  assert.match(withPresenter.characterProfile, /^One woman in her late 20s/, "具体人物描述仍在");
  assert.match(withPresenter.characterProfile, /Must be the exact person in the presenter reference photo/);

  const without = heuristicBible({
    creativeBrief: brief,
    classification,
    classifiedAssets: [image({ id: "prod" })],
    aiSegmentCount: 2,
    language: "zh-CN",
  });
  assert.doesNotMatch(without.characterProfile, /presenter reference photo/);
  assert.match(without.characterProfile, /^One woman in her late 20s/);
});

test("段提示词 CHARACTER 行：有 person 参考时带 must match the presenter reference photo 前缀；没有时不带", async () => {
  for (const prompt of await aiPrompts([presenter, image({ id: "prod" })])) {
    assert.match(prompt, PRESENTER_CHARACTER_PREFIX);
  }
  for (const prompt of await aiPrompts([image({ id: "prod" })])) {
    assert.match(prompt, /^CHARACTER \(keep 100% identical in every cut\): /m);
    assert.doesNotMatch(prompt, /presenter reference photo/);
  }
});

test("开关 off 时，即便素材标了 person，bible 与段提示词都不写主播文字锚（P02-F(s) 前不许承诺照片参考）", async (t) => {
  process.env.STORYBOARD_PERSON_REFS = "off";
  t.after(() => { process.env.STORYBOARD_PERSON_REFS = "on"; });
  assert.deepEqual(presenterReferenceAssets([presenter]), []);
  const bible = heuristicBible({
    creativeBrief: brief, classification, classifiedAssets: [presenter], aiSegmentCount: 2, language: "zh-CN",
  });
  assert.doesNotMatch(bible.characterProfile, /presenter reference photo/);
  for (const prompt of await aiPrompts([presenter, image({ id: "prod" })])) {
    assert.match(prompt, /^CHARACTER \(keep 100% identical in every cut\): /m);
    assert.doesNotMatch(prompt, /presenter reference photo/);
  }
});

test("纯产品模版 + 主播图：主播优先，不写 NO on-camera person 与主播锁自相矛盾；没有主播图时仍是纯产品", async () => {
  const template = getStyleTemplate("tpl_perfume_macro");
  assert.ok(template && !template.scaffold.characterHint && template.scaffold.dialogueStyle == null, "fixture 必须是纯产品模版");
  for (const prompt of await aiPrompts([presenter, image({ id: "prod" })], "tpl_perfume_macro")) {
    assert.doesNotMatch(prompt, /NO on-camera person/);
    assert.match(prompt, PRESENTER_CHARACTER_PREFIX);
  }
  for (const prompt of await aiPrompts([image({ id: "prod" })], "tpl_perfume_macro")) {
    assert.match(prompt, /^NO on-camera person: the product is the only hero of every shot\.$/m);
    assert.doesNotMatch(prompt, /^CHARACTER \(/m);
  }
});
