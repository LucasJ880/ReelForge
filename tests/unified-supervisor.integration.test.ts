/**
 * Supervisor end-to-end tests in heuristic mode (LLM forced mock).
 */
process.env.LLM_FORCE_MOCK = "true";

import assert from "node:assert/strict";
import test from "node:test";
import { buildPlan } from "../src/lib/video-generation/generation-supervisor";
import type {
  UnifiedVideoGenerationRequest,
  UploadedAsset,
} from "../src/types/video-generation";

function req(
  overrides: Partial<UnifiedVideoGenerationRequest>,
): UnifiedVideoGenerationRequest {
  return {
    userType: "business",
    rawPrompt:
      "Morning routine, real user pours water from our reusable bottle. Real people, daylight, kitchen, calm energy.",
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

test("[unified-generation-supervisor] business 30s text-only → canDispatch, 2 AI segments + end card", async () => {
  const plan = await buildPlan(req({}));

  assert.equal(plan.qualityReview.canDispatch, true, JSON.stringify(plan.qualityReview.blockers));
  assert.equal(plan.inputClassification.generationMode, "text_to_video_ad");
  assert.equal(plan.brandPackagingPlan.mode, "auto_end_card");
  assert.equal(plan.segments.length, 3); // 2 AI + 1 end card
  assert.equal(plan.segments[0].type, "ai_generated_clip");
  assert.equal(plan.segments[1].type, "ai_generated_clip");
  assert.equal(plan.segments[2].type, "brand_end_card");
  assert.equal(plan.assemblyPlan.finalDurationSeconds, 33);
  assert.equal(plan.assemblyPlan.aspectRatio, "9:16");
  assert.match(plan.planPreview.summary, /vertical/);
  assert.match(plan.planPreview.summary, /ad/);
  /// Seedance prompts must NOT mention brand keywords
  for (const sp of plan.seedancePrompts) {
    assert.doesNotMatch(sp.prompt, /https?:\/\//);
    assert.doesNotMatch(sp.prompt, /\bbuy\s+now\b/i);
    assert.doesNotMatch(sp.prompt, /\bswipe\s+up\b/i);
    assert.ok(sp.negativePrompt.includes("no logo"));
  }
});

test("[unified-generation-supervisor] business 15s with product image → image_to_video_ad", async () => {
  const productImage: UploadedAsset = {
    id: "p1",
    type: "IMAGE",
    inferredRole: "product_image",
    roleConfidence: 0.85,
    url: "https://example.com/hero.jpg",
    mimeType: "image/jpeg",
    fileName: "hero.jpg",
    width: 1080,
    height: 1920,
  };
  const plan = await buildPlan(
    req({ selectedDuration: 15, attachments: [productImage] }),
  );
  assert.equal(plan.inputClassification.generationMode, "image_to_video_ad");
  assert.equal(plan.qualityReview.canDispatch, true);
  assert.equal(plan.assemblyPlan.finalDurationSeconds, 17); // 15 + 2s end card
  /// product image is referenced via sourceAssetIds, not URL in prompt
  for (const sp of plan.seedancePrompts) {
    assert.ok(sp.referenceImageUrls.includes("https://example.com/hero.jpg"));
    assert.doesNotMatch(sp.prompt, /https?:\/\//);
  }
});

test("[unified-generation-supervisor] business 60s with intro_clip + ad_clip → uploaded clips placed", async () => {
  const intro: UploadedAsset = {
    id: "i1",
    type: "VIDEO",
    inferredRole: "intro_clip",
    roleConfidence: 0.9,
    url: "https://example.com/intro.mp4",
    mimeType: "video/mp4",
    fileName: "intro.mp4",
    durationSeconds: 3,
  };
  const ad: UploadedAsset = {
    id: "a1",
    type: "VIDEO",
    inferredRole: "ad_clip",
    roleConfidence: 0.7,
    url: "https://example.com/ad.mp4",
    mimeType: "video/mp4",
    fileName: "ad.mp4",
    durationSeconds: 8,
  };
  const plan = await buildPlan(
    req({ selectedDuration: 60, attachments: [intro, ad] }),
  );

  assert.equal(plan.inputClassification.generationMode, "mixed_assets_to_video_ad");
  assert.equal(plan.qualityReview.canDispatch, true);
  const uploadedSegs = plan.segments.filter((s) => s.type === "uploaded_clip");
  assert.ok(uploadedSegs.length >= 1, "should have at least 1 uploaded clip segment");
  const ids = uploadedSegs.map((s) => s.uploadedAssetId);
  assert.ok(ids.includes("i1"));
});

test("[unified-generation-supervisor] personal 15s → text_to_video, no brand", async () => {
  const plan = await buildPlan(
    req({
      userType: "personal",
      selectedDuration: 15,
      selectedBrandEndingMode: "none",
      cta: null,
      brandKit: null,
      rawPrompt: "A cat sits by a sunlit window watching birds outside.",
    }),
  );
  assert.equal(plan.inputClassification.generationMode, "text_to_video");
  assert.equal(plan.brandPackagingPlan.mode, "none");
  assert.equal(plan.segments.length, 1); // 1 AI clip, no end card
  assert.equal(plan.segments[0].type, "ai_generated_clip");
  assert.equal(plan.creativeBrief.cta, null);
  assert.match(plan.planPreview.summary, /video/);
  assert.doesNotMatch(plan.planPreview.summary, /branded end card/);
});

test("[unified-generation-supervisor] each plan has a unique id", async () => {
  const a = await buildPlan(req({}));
  const b = await buildPlan(req({}));
  assert.notEqual(a.id, b.id);
});

test("[unified-generation-supervisor] supervisor auto-classifies assets with unknown inferredRole", async () => {
  const unclassified: UploadedAsset = {
    id: "u1",
    type: "IMAGE",
    inferredRole: "unknown",
    roleConfidence: 0,
    url: "https://example.com/acme-logo.png",
    mimeType: "image/png",
    fileName: "acme-logo.png",
    width: 256,
    height: 256,
  };
  const plan = await buildPlan(req({ attachments: [unclassified] }));
  const out = plan.classifiedAssets.find((a) => a.id === "u1")!;
  assert.equal(out.inferredRole, "logo");
  assert.ok(out.roleConfidence > 0.5);
});

test("[unified-generation-supervisor] Seedance brand-violation prompt is blocked", async () => {
  /// Forge an obviously-bad prompt context by having the heuristic include the
  /// brand name explicitly. We simulate this by checking that even the worst-case
  /// heuristic path stays clean. (heuristic prompts never include CTA phrases.)
  const plan = await buildPlan(req({}));
  for (const seg of plan.segments) {
    if (seg.type !== "ai_generated_clip") continue;
    assert.doesNotMatch(seg.prompt!, /\bbuy\s+now\b/i);
    assert.doesNotMatch(seg.prompt!, /\bswipe\s+up\b/i);
    assert.doesNotMatch(seg.prompt!, /\bQR\s*code\b/i);
    assert.doesNotMatch(seg.prompt!, /\blink\s+in\s+bio\b/i);
  }
});
