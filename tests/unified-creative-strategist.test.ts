/**
 * Creative strategist tests run in heuristic mode (LLM forced mock).
 */
process.env.LLM_FORCE_MOCK = "true";

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreativeBrief,
  __test__ as ctxTestUtils,
} from "../src/lib/video-generation/creative-strategist";
import type {
  InputClassification,
  UnifiedVideoGenerationRequest,
  UploadedAsset,
} from "../src/types/video-generation";

function classFor(userType: "business" | "personal"): InputClassification {
  return {
    userType,
    generationMode: userType === "business" ? "text_to_video_ad" : "text_to_video",
    videoGoal: userType === "business" ? "product_ad" : "personal_creative",
    targetPlatform: "tiktok",
    needsCTA: userType === "business",
    needsBrandPackaging: userType === "business",
    needsUserClipInsertion: false,
    confidence: 0.9,
    missingFields: [],
    warnings: [],
  };
}

function req(overrides: Partial<UnifiedVideoGenerationRequest>): UnifiedVideoGenerationRequest {
  return {
    userType: "business",
    rawPrompt: "Show our new bottle on a morning run. Real users, no models.",
    attachments: [],
    selectedDuration: 30,
    selectedAspectRatio: "9:16",
    selectedBrandEndingMode: "auto_end_card",
    cta: "Tap to shop",
    platform: null,
    brandKit: { brandName: "Acme", logoUrl: null, slogan: null, website: null },
    language: "en",
    ...overrides,
  };
}

test("[unified-creative-strategist] business → has CTA, key selling points, empty variants in heuristic", async () => {
  const brief = await buildCreativeBrief({
    request: req({}),
    classification: classFor("business"),
    classifiedAssets: [],
  });
  assert.equal(typeof brief.hook, "string");
  assert.ok(brief.hook.length > 0);
  assert.equal(brief.cta, "Tap to shop");
  assert.ok(Array.isArray(brief.keySellingPoints));
  assert.ok(brief.keySellingPoints.length >= 1);
  assert.deepEqual(brief.angleVariants, []);
});

test("[unified-creative-strategist] personal → cta null, empty selling points", async () => {
  const brief = await buildCreativeBrief({
    request: req({
      userType: "personal",
      selectedBrandEndingMode: "none",
      cta: null,
      brandKit: null,
    }),
    classification: classFor("personal"),
    classifiedAssets: [],
  });
  assert.equal(brief.cta, null);
  assert.deepEqual(brief.keySellingPoints, []);
  assert.deepEqual(brief.angleVariants, []);
});

test("[unified-creative-strategist] heuristic hook = first sentence of prompt", async () => {
  const brief = await buildCreativeBrief({
    request: req({
      rawPrompt: "A hand reaches into a fridge. The bottle catches morning sun.",
    }),
    classification: classFor("business"),
    classifiedAssets: [],
  });
  assert.equal(brief.hook, "A hand reaches into a fridge.");
});

test("[unified-creative-strategist] extractFirstSentence handles Chinese punctuation", () => {
  /// regex requires whitespace after the sentence terminator (cross-language pattern)
  const r = ctxTestUtils.extractFirstSentence("一只手伸进冰箱。 瓶子在晨光中闪烁。");
  assert.equal(r, "一只手伸进冰箱。");
});

test("[unified-creative-strategist] empty prompt → fallback hook", async () => {
  const brief = await buildCreativeBrief({
    request: req({ rawPrompt: "" }),
    classification: classFor("business"),
    classifiedAssets: [],
  });
  assert.ok(brief.hook.length > 0);
  assert.ok(brief.narrative.length > 0);
});

test("[unified-creative-strategist] product image asset surfaces in selling points hint", async () => {
  const product: UploadedAsset = {
    id: "p1",
    type: "IMAGE",
    inferredRole: "product_image",
    roleConfidence: 0.8,
    url: "https://example.com/p.jpg",
    mimeType: "image/jpeg",
    fileName: "hydra-bottle.jpg",
  };
  const brief = await buildCreativeBrief({
    request: req({ attachments: [product] }),
    classification: classFor("business"),
    classifiedAssets: [product],
  });
  assert.ok(
    brief.keySellingPoints.some((sp) => sp.includes("hydra-bottle.jpg")),
    "should hint at the uploaded product",
  );
});
