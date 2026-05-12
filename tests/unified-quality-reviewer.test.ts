import assert from "node:assert/strict";
import test from "node:test";
import { buildQualityReview, checkSeedancePromptStatic } from "../src/lib/video-generation/quality-reviewer";
import type {
  BrandPackagingPlan,
  CreativeBrief,
  InputClassification,
  UploadedAsset,
  VideoSegment,
} from "../src/types/video-generation";

function aiSeg(order: number, prompt: string): VideoSegment {
  return {
    id: `seg_${order}`,
    order,
    type: "ai_generated_clip",
    role: "hook",
    durationSeconds: 15,
    purpose: "test",
    prompt,
    negativePrompt: "no logo, no brand text",
    sourceAssetIds: [],
    uploadedAssetId: null,
    cameraDirection: "static",
    visualDirection: "warm",
    outputSpec: { aspectRatio: "9:16", resolution: "1080x1920" },
  };
}

const baseBrief: CreativeBrief = {
  hook: "Cinematic open",
  narrative: "Authentic UGC",
  targetAudience: "Daily users",
  corePainPoint: "Lack of authentic content",
  emotionalAngle: "Confidence",
  keySellingPoints: ["Real moments"],
  cta: "Tap to shop",
  platformFit: "tiktok 9:16",
  recommendedDurationReason: "Hook + payoff",
  angleVariants: [],
};

const baseClass: InputClassification = {
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

const baseBrand: BrandPackagingPlan = {
  mode: "auto_end_card",
  logoAssetId: "lg",
  endCardDurationSeconds: 3,
  cta: "Tap to shop",
  brandName: "Acme",
  slogan: null,
  website: null,
  renderStrategy: "render_ffmpeg_overlay",
  warnings: [],
};

test("[unified-quality-reviewer] clean plan → canDispatch=true, score high", () => {
  const review = buildQualityReview({
    classification: baseClass,
    classifiedAssets: [],
    brandPackaging: baseBrand,
    segments: [
      aiSeg(
        0,
        "9:16 vertical cinematic close-up of fresh produce in a sunlit kitchen, soft natural light",
      ),
      aiSeg(
        1,
        "9:16 vertical handheld over-the-shoulder shot of hands preparing breakfast",
      ),
    ],
    creativeBrief: baseBrief,
  });
  assert.equal(review.canDispatch, true);
  assert.equal(review.blockers.length, 0);
  assert.ok(review.score >= 90);
});

test("[unified-quality-reviewer] 'render the logo' → blocker", () => {
  const review = buildQualityReview({
    classification: baseClass,
    classifiedAssets: [],
    brandPackaging: baseBrand,
    segments: [
      aiSeg(0, "9:16 vertical: please render the logo prominently in the center"),
    ],
    creativeBrief: baseBrief,
  });
  assert.equal(review.canDispatch, false);
  assert.ok(review.blockers.some((b) => b.code === "seedance_logo_request"));
});

test("[unified-quality-reviewer] URL in prompt → blocker", () => {
  const review = buildQualityReview({
    classification: baseClass,
    classifiedAssets: [],
    brandPackaging: baseBrand,
    segments: [
      aiSeg(
        0,
        "9:16 hero shot of bottle with overlay text https://acme.example.com written across",
      ),
    ],
    creativeBrief: baseBrief,
  });
  assert.ok(review.blockers.some((b) => b.code === "seedance_url"));
});

test("[unified-quality-reviewer] QR code phrase → blocker", () => {
  const review = buildQualityReview({
    classification: baseClass,
    classifiedAssets: [],
    brandPackaging: baseBrand,
    segments: [aiSeg(0, "Hero shot with QR code in the lower right corner")],
    creativeBrief: baseBrief,
  });
  assert.ok(review.blockers.some((b) => b.code === "seedance_qr_code"));
});

test("[unified-quality-reviewer] CTA phrase 'buy now' → blocker", () => {
  const review = buildQualityReview({
    classification: baseClass,
    classifiedAssets: [],
    brandPackaging: baseBrand,
    segments: [aiSeg(0, "Closing shot with 'buy now' text rendered on the screen")],
    creativeBrief: baseBrief,
  });
  assert.ok(review.blockers.some((b) => b.code === "seedance_cta_text"));
});

test("[unified-quality-reviewer] image_to_video without product image → blocker", () => {
  const review = buildQualityReview({
    classification: { ...baseClass, generationMode: "image_to_video_ad" },
    classifiedAssets: [],
    brandPackaging: baseBrand,
    segments: [aiSeg(0, "Cinematic product shot in real-world setting with soft daylight")],
    creativeBrief: baseBrief,
  });
  assert.ok(review.blockers.some((b) => b.code === "missing_product_image"));
});

test("[unified-quality-reviewer] mixed_assets without uploaded VIDEO → blocker", () => {
  const imageOnly: UploadedAsset = {
    id: "i1",
    type: "IMAGE",
    inferredRole: "product_image",
    roleConfidence: 0.8,
    url: "x",
    mimeType: "image/jpeg",
    fileName: "hero.jpg",
  };
  const review = buildQualityReview({
    classification: { ...baseClass, generationMode: "mixed_assets_to_video_ad" },
    classifiedAssets: [imageOnly],
    brandPackaging: baseBrand,
    segments: [aiSeg(0, "Cinematic shot of product in warm natural light")],
    creativeBrief: baseBrief,
  });
  assert.ok(review.blockers.some((b) => b.code === "missing_uploaded_clip"));
});

test("[unified-quality-reviewer] short prompt → warning, NOT blocker", () => {
  const review = buildQualityReview({
    classification: baseClass,
    classifiedAssets: [],
    brandPackaging: baseBrand,
    segments: [aiSeg(0, "Hero shot")],
    creativeBrief: baseBrief,
  });
  assert.equal(review.canDispatch, true);
  assert.ok(review.warnings.some((w) => w.code === "prompt_too_short"));
});

test("[unified-quality-reviewer] checkSeedancePromptStatic: multiple violations", () => {
  const issues = checkSeedancePromptStatic(
    "show the logo prominently and render the text 'Tap to shop' over the QR code",
  );
  const codes = issues.map((i) => i.code);
  assert.ok(codes.includes("seedance_logo_request"));
  assert.ok(codes.includes("seedance_render_text"));
  assert.ok(codes.includes("seedance_qr_code"));
});
