/**
 * P02-C · 主播参考图（AssetRole person）落到文字锚：
 * - consistency bible 启发式兜底：有 person 图时 characterProfile = 与主播参考图同一人；没有时保持现状
 * - Seedance 段提示词 CHARACTER 行：有 person 参考时前缀 "must match the presenter reference photo"
 * 走 LLM 强制 mock，离线、确定。
 */
process.env.LLM_FORCE_MOCK = "true";

import assert from "node:assert/strict";
import test from "node:test";
import { heuristicBible } from "../src/lib/video-generation/consistency-bible";
import { buildVideoSegments } from "../src/lib/video-generation/prompt-intelligence";
import { planUnifiedSegments } from "../src/lib/video-generation/segment-planner-adapter";
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

test("bible 启发式兜底：有主播参考图时人物 = 照片里那个人；没有时保持原默认", () => {
  const withPresenter = heuristicBible({
    creativeBrief: brief,
    classification,
    classifiedAssets: [presenter, image({ id: "prod" })],
    aiSegmentCount: 2,
    language: "zh-CN",
  });
  assert.match(withPresenter.characterProfile, /^The exact person in the presenter reference photo/);

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

test("段提示词 CHARACTER 行：有 person 参考时带 must match the presenter reference photo 前缀", async () => {
  const slots = planUnifiedSegments({ targetDurationSec: 15, clipPlacement: null, brandPackaging: null });
  const withPresenter = await buildVideoSegments({
    creativeBrief: brief,
    segmentSlots: slots,
    classifiedAssets: [presenter, image({ id: "prod" })],
    classification,
    aspectRatio: "9:16",
  });
  const aiSegments = withPresenter.filter((segment) => segment.type === "ai_generated_clip");
  assert.ok(aiSegments.length > 0);
  for (const segment of aiSegments) {
    assert.match(
      segment.prompt!,
      /^CHARACTER \(must match the presenter reference photo — same face, hair, skin tone and build; keep 100% identical in every cut\): /m,
    );
  }

  const without = await buildVideoSegments({
    creativeBrief: brief,
    segmentSlots: slots,
    classifiedAssets: [image({ id: "prod" })],
    classification,
    aspectRatio: "9:16",
  });
  for (const segment of without.filter((s) => s.type === "ai_generated_clip")) {
    assert.match(segment.prompt!, /^CHARACTER \(keep 100% identical in every cut\): /m);
    assert.doesNotMatch(segment.prompt!, /presenter reference photo/);
  }
});
