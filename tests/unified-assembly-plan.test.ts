import assert from "node:assert/strict";
import test from "node:test";
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

function uploadedSeg(order: number, duration: number, id: string): VideoSegment {
  return {
    id: `seg_${order}`,
    order,
    type: "uploaded_clip",
    role: "demo",
    durationSeconds: duration,
    purpose: "test",
    prompt: null,
    negativePrompt: null,
    sourceAssetIds: [id],
    uploadedAssetId: id,
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
    purpose: "branded end card",
    prompt: null,
    negativePrompt: null,
    sourceAssetIds: [],
    uploadedAssetId: null,
    cameraDirection: null,
    visualDirection: null,
    outputSpec: { aspectRatio: "9:16", resolution: "1080x1920" },
  };
}

const autoBrand: BrandPackagingPlan = {
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

const noneBrand: BrandPackagingPlan = {
  mode: "none",
  endCardDurationSeconds: 0,
  cta: null,
  brandName: null,
  slogan: null,
  website: null,
  renderStrategy: "no_end_card",
  warnings: [],
};

test("[unified-assembly-plan] 30s with 2 AI segments + end card → 33s, 3 clips, 9:16 res", () => {
  const plan = buildAssemblyPlan({
    segments: [aiSeg(0, 15), aiSeg(1, 15), endCardSeg(2, 3)],
    brandPackaging: autoBrand,
    aspectRatio: "9:16",
  });
  assert.equal(plan.clips.length, 3);
  assert.equal(plan.finalDurationSeconds, 33);
  assert.equal(plan.aspectRatio, "9:16");
  assert.equal(plan.targetResolution, "1080x1920");
  assert.equal(plan.fps, 30);
  assert.equal(plan.outputCodec, "h264_aac_mp4");
  assert.equal(plan.transitions.length, 2);
  for (const t of plan.transitions) assert.equal(t, "cut");
  assert.match(plan.normalizationPlan, /1080x1920/);
});

test("[unified-assembly-plan] sequential clip timing (from/to) is contiguous", () => {
  const plan = buildAssemblyPlan({
    segments: [aiSeg(0, 15), uploadedSeg(1, 8, "u1"), aiSeg(2, 15), endCardSeg(3, 3)],
    brandPackaging: autoBrand,
    aspectRatio: "9:16",
  });
  assert.equal(plan.clips[0].fromSec, 0);
  assert.equal(plan.clips[0].toSec, 15);
  assert.equal(plan.clips[1].fromSec, 15);
  assert.equal(plan.clips[1].toSec, 23);
  assert.equal(plan.clips[2].fromSec, 23);
  assert.equal(plan.clips[2].toSec, 38);
  assert.equal(plan.clips[3].fromSec, 38);
  assert.equal(plan.clips[3].toSec, 41);
  assert.equal(plan.finalDurationSeconds, 41);
});

test("[unified-assembly-plan] uploaded_clip carries uploadedAssetId, sourceVideoJobId null", () => {
  const plan = buildAssemblyPlan({
    segments: [aiSeg(0, 15), uploadedSeg(1, 8, "u1")],
    brandPackaging: noneBrand,
    aspectRatio: "9:16",
  });
  assert.equal(plan.clips[1].sourceType, "uploaded_clip");
  assert.equal(plan.clips[1].uploadedAssetId, "u1");
  assert.equal(plan.clips[1].sourceVideoJobId, null);
});

test("[unified-assembly-plan] 16:9 → 1920x1080", () => {
  const plan = buildAssemblyPlan({
    segments: [aiSeg(0, 15)],
    brandPackaging: noneBrand,
    aspectRatio: "16:9",
  });
  assert.equal(plan.aspectRatio, "16:9");
  assert.equal(plan.targetResolution, "1920x1080");
});

test("[unified-assembly-plan] 1:1 → 1080x1080", () => {
  const plan = buildAssemblyPlan({
    segments: [aiSeg(0, 15)],
    brandPackaging: noneBrand,
    aspectRatio: "1:1",
  });
  assert.equal(plan.targetResolution, "1080x1080");
});

test("[unified-assembly-plan] no brand → normalization plan mentions 'no brand end card'", () => {
  const plan = buildAssemblyPlan({
    segments: [aiSeg(0, 15)],
    brandPackaging: noneBrand,
    aspectRatio: "9:16",
  });
  assert.match(plan.normalizationPlan, /no brand end card/i);
});
