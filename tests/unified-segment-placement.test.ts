import assert from "node:assert/strict";
import test from "node:test";
import { buildClipPlacementPlan } from "../src/lib/video-generation/clip-placement-planner";
import type {
  InputClassification,
  UploadedAsset,
} from "../src/types/video-generation";

const baseClassification: InputClassification = {
  userType: "business",
  generationMode: "mixed_assets_to_video_ad",
  videoGoal: "ugc_style_ad",
  targetPlatform: "tiktok",
  needsCTA: true,
  needsBrandPackaging: true,
  needsUserClipInsertion: true,
  confidence: 0.9,
  missingFields: [],
  warnings: [],
};

function asset(overrides: Partial<UploadedAsset>): UploadedAsset {
  return {
    id: "x",
    type: "VIDEO",
    inferredRole: "ad_clip",
    roleConfidence: 0.7,
    url: "https://example.com/x.mp4",
    mimeType: "video/mp4",
    fileName: "x.mp4",
    durationSeconds: 8,
    ...overrides,
  };
}

test("[unified-segment-placement] intro_clip → beginning, replaces segment 0", () => {
  const plan = buildClipPlacementPlan({
    classifiedAssets: [asset({ id: "i1", inferredRole: "intro_clip" })],
    classification: baseClassification,
    targetDurationSec: 30,
    hasBrandEndCard: true,
  });
  const d = plan.decisions.find((x) => x.role === "intro_clip");
  assert.ok(d);
  assert.equal(d!.position, "beginning");
  assert.equal(d!.targetSegmentOrder, 0);
  assert.equal(d!.replacesAISegment, true);
});

test("[unified-segment-placement] outro_clip skipped when brand end card present", () => {
  const plan = buildClipPlacementPlan({
    classifiedAssets: [asset({ id: "o1", inferredRole: "outro_clip" })],
    classification: baseClassification,
    targetDurationSec: 30,
    hasBrandEndCard: true,
  });
  assert.equal(plan.decisions.length, 0);
});

test("[unified-segment-placement] outro_clip → end when no brand end card", () => {
  const plan = buildClipPlacementPlan({
    classifiedAssets: [asset({ id: "o1", inferredRole: "outro_clip" })],
    classification: baseClassification,
    targetDurationSec: 30,
    hasBrandEndCard: false,
  });
  const d = plan.decisions.find((x) => x.role === "outro_clip");
  assert.ok(d);
  assert.equal(d!.position, "end");
});

test("[unified-segment-placement] ad_clip → before_cta when needsCTA", () => {
  const plan = buildClipPlacementPlan({
    classifiedAssets: [asset({ id: "a1", inferredRole: "ad_clip" })],
    classification: baseClassification,
    targetDurationSec: 30,
    hasBrandEndCard: true,
  });
  const d = plan.decisions.find((x) => x.role === "ad_clip");
  assert.ok(d);
  assert.equal(d!.position, "before_cta");
});

test("[unified-segment-placement] logo / product_image NOT placed on timeline", () => {
  const plan = buildClipPlacementPlan({
    classifiedAssets: [
      asset({ id: "lg", type: "IMAGE", inferredRole: "logo" }),
      asset({
        id: "p1",
        type: "IMAGE",
        inferredRole: "product_image",
        mimeType: "image/jpeg",
      }),
    ],
    classification: baseClassification,
    targetDurationSec: 30,
    hasBrandEndCard: true,
  });
  assert.equal(plan.decisions.length, 0);
});
