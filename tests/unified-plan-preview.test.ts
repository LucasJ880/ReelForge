import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanPreview } from "../src/lib/video-generation/plan-preview";
import { buildAssemblyPlan } from "../src/lib/video-generation/video-assembly-plan";
import type {
  BrandPackagingPlan,
  VideoSegment,
} from "../src/types/video-generation";

function aiSeg(order: number, duration: number): VideoSegment {
  return {
    id: `seg_${order}`,
    order,
    type: "ai_generated_clip",
    role: "hook",
    durationSeconds: duration,
    purpose: "test",
    prompt: "x",
    negativePrompt: "no logo",
    sourceAssetIds: [],
    uploadedAssetId: null,
    cameraDirection: null,
    visualDirection: null,
    outputSpec: { aspectRatio: "9:16", resolution: "1080x1920" },
  };
}

function uploadedSeg(order: number, duration: number): VideoSegment {
  return {
    id: `seg_${order}`,
    order,
    type: "uploaded_clip",
    role: "demo",
    durationSeconds: duration,
    purpose: "test",
    prompt: null,
    negativePrompt: null,
    sourceAssetIds: [],
    uploadedAssetId: "u1",
    cameraDirection: null,
    visualDirection: null,
    outputSpec: { aspectRatio: "9:16", resolution: "1080x1920" },
  };
}

function endCardSeg(order: number, duration: number): VideoSegment {
  return {
    id: `seg_${order}`,
    order,
    type: "brand_end_card",
    role: "cta",
    durationSeconds: duration,
    purpose: "x",
    prompt: null,
    negativePrompt: null,
    sourceAssetIds: [],
    uploadedAssetId: null,
    cameraDirection: null,
    visualDirection: null,
    outputSpec: { aspectRatio: "9:16", resolution: "1080x1920" },
  };
}

const brand3s: BrandPackagingPlan = {
  mode: "auto_end_card",
  logoAssetId: null,
  endCardDurationSeconds: 3,
  cta: "Tap",
  brandName: "Acme",
  slogan: null,
  website: null,
  renderStrategy: "render_ffmpeg_overlay",
  warnings: [],
};

const noBrand: BrandPackagingPlan = {
  mode: "none",
  endCardDurationSeconds: 0,
  cta: null,
  brandName: null,
  slogan: null,
  website: null,
  renderStrategy: "no_end_card",
  warnings: [],
};

test("[unified-plan-preview] business 30s + 2 AI + branded end card → summary mentions branded end card", () => {
  const segments = [aiSeg(0, 15), aiSeg(1, 15), endCardSeg(2, 3)];
  const assemblyPlan = buildAssemblyPlan({
    segments,
    brandPackaging: brand3s,
    aspectRatio: "9:16",
  });
  const preview = buildPlanPreview({
    segments,
    brandPackaging: brand3s,
    assemblyPlan,
    aspectRatio: "9:16",
    userType: "business",
  });

  assert.equal(preview.breakdown.aiClipCount, 2);
  assert.equal(preview.breakdown.uploadedClipCount, 0);
  assert.equal(preview.breakdown.hasBrandEndCard, true);
  assert.equal(preview.breakdown.finalDurationSec, 33);
  assert.equal(preview.breakdown.aspectRatio, "9:16");
  assert.match(preview.summary, /2 AI-generated clips/);
  assert.match(preview.summary, /3s branded end card/);
  assert.match(preview.summary, /vertical/);
  assert.match(preview.summary, /ad/);
});

test("[unified-plan-preview] personal 15s text-only → no end card, summary calls it 'video'", () => {
  const segments = [aiSeg(0, 15)];
  const assemblyPlan = buildAssemblyPlan({
    segments,
    brandPackaging: noBrand,
    aspectRatio: "9:16",
  });
  const preview = buildPlanPreview({
    segments,
    brandPackaging: noBrand,
    assemblyPlan,
    aspectRatio: "9:16",
    userType: "personal",
  });

  assert.equal(preview.breakdown.aiClipCount, 1);
  assert.equal(preview.breakdown.hasBrandEndCard, false);
  assert.match(preview.summary, /1 AI-generated clip\b/);
  assert.match(preview.summary, /video/);
  assert.doesNotMatch(preview.summary, /branded end card/);
});

test("[unified-plan-preview] mixed 30s with uploaded clip → mentions uploaded clip", () => {
  const segments = [aiSeg(0, 15), uploadedSeg(1, 8), endCardSeg(2, 3)];
  const assemblyPlan = buildAssemblyPlan({
    segments,
    brandPackaging: brand3s,
    aspectRatio: "9:16",
  });
  const preview = buildPlanPreview({
    segments,
    brandPackaging: brand3s,
    assemblyPlan,
    aspectRatio: "9:16",
    userType: "business",
  });

  assert.equal(preview.breakdown.uploadedClipCount, 1);
  assert.match(preview.summary, /1 AI-generated clip\b/);
  assert.match(preview.summary, /1 uploaded clip\b/);
  assert.match(preview.summary, /branded end card/);
});

test("[unified-plan-preview] 16:9 → orientation 'horizontal'", () => {
  const segments = [aiSeg(0, 15)];
  const assemblyPlan = buildAssemblyPlan({
    segments,
    brandPackaging: noBrand,
    aspectRatio: "16:9",
  });
  const preview = buildPlanPreview({
    segments,
    brandPackaging: noBrand,
    assemblyPlan,
    aspectRatio: "16:9",
    userType: "personal",
  });
  assert.match(preview.summary, /horizontal/);
});
