/**
 * Prompt intelligence tests run in heuristic mode (LLM forced mock)
 * to keep them deterministic and offline.
 */
process.env.LLM_FORCE_MOCK = "true";

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVideoSegments,
  __test__ as promptIntelTestUtils,
} from "../src/lib/video-generation/prompt-intelligence";
import { planUnifiedSegments } from "../src/lib/video-generation/segment-planner-adapter";
import type {
  CreativeBrief,
  InputClassification,
  UploadedAsset,
} from "../src/types/video-generation";

const brief: CreativeBrief = {
  hook: "A glass bottle glistens under morning sunlight",
  narrative: "Show our reusable bottle being used on a daily trail run",
  targetAudience: "Active 25-40 year-olds",
  corePainPoint: "Single-use plastic guilt",
  emotionalAngle: "Confidence and calm",
  keySellingPoints: ["double-wall insulation", "leak-proof"],
  cta: "Tap to shop",
  platformFit: "tiktok 9:16",
  recommendedDurationReason: "30s allows hook + payoff",
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

test("[unified-prompt-intelligence] heuristic segments include orientation hint + brand guard", async () => {
  const slots = planUnifiedSegments({
    targetDurationSec: 30,
    clipPlacement: null,
    brandPackaging: null,
  });
  const segments = await buildVideoSegments({
    creativeBrief: brief,
    segmentSlots: slots,
    classifiedAssets: [],
    classification,
    aspectRatio: "9:16",
  });

  assert.ok(segments.length > 0);
  for (const seg of segments) {
    assert.equal(seg.type, "ai_generated_clip");
    assert.ok(seg.prompt && seg.prompt.length > 30, "prompt should be specific");
    assert.match(seg.prompt!, /9:16 vertical/);
    assert.ok(seg.negativePrompt && seg.negativePrompt.includes("no logo"));
    assert.ok(seg.negativePrompt!.includes("no brand text"));
  }
});

test("[unified-prompt-intelligence] heuristic prompts NEVER mention literal brand keywords", async () => {
  const slots = planUnifiedSegments({
    targetDurationSec: 15,
    clipPlacement: null,
    brandPackaging: null,
  });
  const segments = await buildVideoSegments({
    creativeBrief: brief,
    segmentSlots: slots,
    classifiedAssets: [],
    classification,
    aspectRatio: "9:16",
  });

  for (const seg of segments) {
    assert.doesNotMatch(seg.prompt!, /\blogo\b/i);
    assert.doesNotMatch(seg.prompt!, /https?:\/\//);
    assert.doesNotMatch(seg.prompt!, /\bbuy\s+now\b/i);
    assert.doesNotMatch(seg.prompt!, /\bswipe\s+up\b/i);
  }
});

test("[unified-prompt-intelligence] appendBrandGuard adds suffix if missing", () => {
  const before = "low quality, blurry";
  const after = promptIntelTestUtils.appendBrandGuard(before);
  assert.ok(after.includes("no logo"));
  assert.ok(after.includes("no QR codes"));

  /// idempotent
  const again = promptIntelTestUtils.appendBrandGuard(after);
  assert.equal(again, after);
});

test("[unified-prompt-intelligence] uploaded clip slot produces uploaded_clip segment with no prompt", async () => {
  const upload: UploadedAsset = {
    id: "v1",
    type: "VIDEO",
    inferredRole: "ad_clip",
    roleConfidence: 0.7,
    url: "https://example.com/x.mp4",
    mimeType: "video/mp4",
    fileName: "ad.mp4",
    durationSeconds: 8,
  };

  const slots = planUnifiedSegments({
    targetDurationSec: 30,
    clipPlacement: {
      decisions: [
        {
          uploadedAssetId: "v1",
          role: "ad_clip",
          position: "middle",
          targetSegmentOrder: 1,
          replacesAISegment: true,
        },
      ],
      warnings: [],
    },
    brandPackaging: null,
  });
  const segments = await buildVideoSegments({
    creativeBrief: brief,
    segmentSlots: slots,
    classifiedAssets: [upload],
    classification,
    aspectRatio: "9:16",
  });

  const uploaded = segments.find((s) => s.type === "uploaded_clip");
  assert.ok(uploaded);
  assert.equal(uploaded!.uploadedAssetId, "v1");
  assert.equal(uploaded!.prompt, null);
  assert.equal(uploaded!.negativePrompt, null);
});

test("[unified-prompt-intelligence] brand_end_card slot produces brand_end_card segment with no prompt", async () => {
  const slots = planUnifiedSegments({
    targetDurationSec: 30,
    clipPlacement: null,
    brandPackaging: {
      mode: "auto_end_card",
      logoAssetId: null,
      endCardDurationSeconds: 3,
      cta: "Tap",
      brandName: "Acme",
      slogan: null,
      website: null,
      renderStrategy: "render_ffmpeg_overlay",
      warnings: [],
    },
  });
  const segments = await buildVideoSegments({
    creativeBrief: brief,
    segmentSlots: slots,
    classifiedAssets: [],
    classification,
    aspectRatio: "9:16",
  });

  const endCard = segments.find((s) => s.type === "brand_end_card");
  assert.ok(endCard);
  assert.equal(endCard!.prompt, null);
});
