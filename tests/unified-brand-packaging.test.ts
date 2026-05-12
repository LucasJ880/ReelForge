import assert from "node:assert/strict";
import test from "node:test";
import { buildBrandPackagingPlan } from "../src/lib/video-generation/brand-packaging";
import type {
  InputClassification,
  UnifiedVideoGenerationRequest,
  UploadedAsset,
} from "../src/types/video-generation";

function baseRequest(
  overrides: Partial<UnifiedVideoGenerationRequest>,
): UnifiedVideoGenerationRequest {
  return {
    userType: "business",
    rawPrompt: "Authentic UGC ad for our new bottle, daily use moments.",
    attachments: [],
    selectedDuration: 30,
    selectedAspectRatio: "9:16",
    selectedBrandEndingMode: "auto_end_card",
    cta: "Tap to shop",
    platform: null,
    brandKit: {
      brandName: "Acme",
      logoUrl: "https://example.com/logo.png",
      slogan: null,
      website: null,
    },
    language: "en",
    ...overrides,
  };
}

function baseClass(
  overrides: Partial<InputClassification>,
): InputClassification {
  return {
    userType: "business",
    generationMode: "image_to_video_ad",
    videoGoal: "product_showcase",
    targetPlatform: "tiktok",
    needsCTA: true,
    needsBrandPackaging: true,
    needsUserClipInsertion: false,
    confidence: 0.9,
    missingFields: [],
    warnings: [],
    ...overrides,
  };
}

test("[unified-brand-packaging] Business + auto_end_card + logo asset → auto_end_card", () => {
  const logo: UploadedAsset = {
    id: "lg",
    type: "IMAGE",
    inferredRole: "logo",
    roleConfidence: 0.95,
    url: "https://example.com/logo.png",
    mimeType: "image/png",
    fileName: "acme-logo.png",
  };
  const plan = buildBrandPackagingPlan({
    request: baseRequest({}),
    classification: baseClass({}),
    classifiedAssets: [logo],
  });
  assert.equal(plan.mode, "auto_end_card");
  assert.equal(plan.logoAssetId, "lg");
  assert.equal(plan.renderStrategy, "render_ffmpeg_overlay");
  assert.equal(plan.endCardDurationSeconds, 3); // 30s → 3s
  assert.equal(plan.cta, "Tap to shop");
});

test("[unified-brand-packaging] Business + auto_end_card + no logo → warning, still auto_end_card", () => {
  const plan = buildBrandPackagingPlan({
    request: baseRequest({
      brandKit: { brandName: "Acme", logoUrl: null, slogan: null, website: null },
    }),
    classification: baseClass({}),
    classifiedAssets: [],
  });
  assert.equal(plan.mode, "auto_end_card");
  assert.equal(plan.logoAssetId, null);
  assert.ok(plan.warnings.some((w) => w.toLowerCase().includes("no logo")));
});

test("[unified-brand-packaging] Personal + brand_ending_mode=none → mode=none, render no_end_card", () => {
  const plan = buildBrandPackagingPlan({
    request: baseRequest({
      userType: "personal",
      selectedBrandEndingMode: "none",
      cta: null,
      brandKit: null,
    }),
    classification: baseClass({
      userType: "personal",
      generationMode: "text_to_video",
      needsCTA: false,
      needsBrandPackaging: false,
    }),
    classifiedAssets: [],
  });
  assert.equal(plan.mode, "none");
  assert.equal(plan.renderStrategy, "no_end_card");
  assert.equal(plan.endCardDurationSeconds, 0);
});

test("[unified-brand-packaging] uploaded_clip mode without outro → falls back to auto_end_card", () => {
  const plan = buildBrandPackagingPlan({
    request: baseRequest({ selectedBrandEndingMode: "uploaded_clip" }),
    classification: baseClass({}),
    classifiedAssets: [],
  });
  assert.equal(plan.mode, "auto_end_card");
  assert.ok(plan.warnings.some((w) => w.toLowerCase().includes("uploaded clip mode")));
});

test("[unified-brand-packaging] uploaded_clip mode with outro_clip → uses uploaded clip", () => {
  const outro: UploadedAsset = {
    id: "o1",
    type: "VIDEO",
    inferredRole: "outro_clip",
    roleConfidence: 0.9,
    url: "https://example.com/outro.mp4",
    mimeType: "video/mp4",
    fileName: "outro.mp4",
    durationSeconds: 4,
  };
  const plan = buildBrandPackagingPlan({
    request: baseRequest({ selectedBrandEndingMode: "uploaded_clip" }),
    classification: baseClass({}),
    classifiedAssets: [outro],
  });
  assert.equal(plan.mode, "uploaded_clip");
  assert.equal(plan.uploadedEndingClipAssetId, "o1");
  assert.equal(plan.renderStrategy, "use_uploaded_clip");
  assert.equal(plan.endCardDurationSeconds, 4);
});

test("[unified-brand-packaging] auto_end_card duration scales with total length", () => {
  const p15 = buildBrandPackagingPlan({
    request: baseRequest({ selectedDuration: 15 }),
    classification: baseClass({}),
    classifiedAssets: [],
  });
  const p60 = buildBrandPackagingPlan({
    request: baseRequest({ selectedDuration: 60 }),
    classification: baseClass({}),
    classifiedAssets: [],
  });
  assert.equal(p15.endCardDurationSeconds, 2);
  assert.equal(p60.endCardDurationSeconds, 4);
});
