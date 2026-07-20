import assert from "node:assert/strict";
import test from "node:test";
import {
  isStoryboardRequired,
  parseStoryboardArtifact,
  promptImpliesStoryboardFirst,
  requireStoryboardBeforeVideo,
  storyboardFromDemoRecord,
  validateImage2Storyboard,
  type Image2StoryboardArtifact,
} from "../src/lib/video-generation/storyboard-lock";
import { renderSafeShutterPrompt } from "../src/lib/video-generation/shutter-shot-policy";
import { buildQualityReview } from "../src/lib/video-generation/quality-reviewer";
import type {
  BrandPackagingPlan,
  CreativeBrief,
  InputClassification,
  VideoSegment,
} from "../src/types/video-generation";

function validArtifact(
  overrides: Partial<Image2StoryboardArtifact> = {},
): Image2StoryboardArtifact {
  return {
    source: "openai_image2",
    model: "gpt-image-2",
    purpose: "shutter-acceptance-storyboard",
    frames: [
      {
        id: "frame-1",
        order: 1,
        imageUrl: "https://example.com/storyboard/01.png",
        beat: "wide hold on shutter wall",
      },
      {
        id: "frame-2",
        order: 2,
        imageUrl: "https://example.com/storyboard/02.png",
        beat: "one panel swings open on hinges",
      },
    ],
    generatedAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

test("shutter acceptance/presenter runs require storyboard-first", () => {
  assert.equal(isStoryboardRequired({ runKind: "shutter_acceptance" }), true);
  assert.equal(isStoryboardRequired({ runKind: "shutter_presenter" }), true);
  assert.equal(isStoryboardRequired({ runKind: "general" }), false);
});

test("safe shutter prompts imply storyboard-first", () => {
  const prompt = renderSafeShutterPrompt({
    motion: "panel_hinge_open",
    productName: "plantation shutters",
    beats: ["one panel swings open on side hinges"],
  });
  assert.equal(promptImpliesStoryboardFirst(prompt), true);
  assert.equal(
    promptImpliesStoryboardFirst(
      "9:16 cinematic kitchen produce shot with soft daylight",
    ),
    false,
  );
});

test("validateImage2Storyboard fails closed on missing/invalid frames", () => {
  assert.equal(validateImage2Storyboard(null).ok, false);
  assert.equal(validateImage2Storyboard(undefined).ok, false);
  assert.equal(
    validateImage2Storyboard(
      validArtifact({
        frames: [
          {
            id: "x",
            order: 1,
            imageUrl: "",
          },
        ],
      }),
    ).ok,
    false,
  );
  assert.equal(validateImage2Storyboard(validArtifact()).ok, true);
});

test("requireStoryboardBeforeVideo throws for shutter runs without artifact", () => {
  assert.throws(
    () =>
      requireStoryboardBeforeVideo(null, {
        clientLockProfileId: "sunnyshutter",
        runKind: "shutter_acceptance",
        minFrames: 2,
      }),
    /storyboard-first|image2|missing|sunnyshutter/i,
  );
  assert.doesNotThrow(() =>
    requireStoryboardBeforeVideo(validArtifact(), {
      clientLockProfileId: "sunnyshutter",
      runKind: "shutter_acceptance",
      minFrames: 2,
    }),
  );
  assert.doesNotThrow(() =>
    requireStoryboardBeforeVideo(null, { runKind: "general" }),
  );
  /// Other clients: no-op even with shutter runKind
  assert.doesNotThrow(() =>
    requireStoryboardBeforeVideo(null, {
      clientLockProfileId: "acme-blinds",
      runKind: "shutter_acceptance",
      minFrames: 2,
    }),
  );
});

test("storyboardFromDemoRecord adapts investor-demo StoryboardRecord shape", () => {
  const artifact = storyboardFromDemoRecord({
    purpose: "sunny-shutter-investor-demo-v21-storyboards",
    source: "openai",
    model: "gpt-image-2",
    segments: [
      {
        index: 1,
        title: "room",
        blobUrl: "https://example.com/a.png",
        localPath: "/tmp/a.png",
      },
      {
        index: 2,
        title: "panel",
        blobUrl: "https://example.com/b.png",
        localPath: "/tmp/b.png",
      },
    ],
  });
  assert.equal(artifact.source, "openai_image2");
  assert.equal(artifact.frames.length, 2);
  assert.equal(validateImage2Storyboard(artifact).ok, true);
});

test("parseStoryboardArtifact accepts canonical JSON", () => {
  const parsed = parseStoryboardArtifact(validArtifact());
  assert.equal(parsed.frames.length, 2);
  assert.throws(() => parseStoryboardArtifact({ foo: 1 }), /invalid/i);
});

test("quality-reviewer blocks shutter plot-lock prompts without image2 storyboard", () => {
  const prompt = renderSafeShutterPrompt({
    motion: "presenter_point_only",
    productName: "custom plantation shutters",
    beats: ["presenter points at shutters from medium shot"],
    characterLock: "Canadian consultant mid-30s navy blazer",
  });
  const segment: VideoSegment = {
    id: "seg_0",
    order: 0,
    type: "ai_generated_clip",
    role: "demo",
    durationSeconds: 15,
    purpose: "shutter demo",
    prompt,
    sourceAssetIds: [],
    outputSpec: { aspectRatio: "9:16", resolution: "1080x1920" },
  };
  const classification: InputClassification = {
    userType: "business",
    generationMode: "image_to_video_ad",
    videoGoal: "product_ad",
    targetPlatform: "tiktok",
    needsCTA: true,
    needsBrandPackaging: true,
    needsUserClipInsertion: false,
    confidence: 0.9,
    missingFields: [],
    warnings: [],
  };
  const brief: CreativeBrief = {
    hook: "custom shutters",
    narrative: "demo",
    targetAudience: "homeowners",
    corePainPoint: "glare",
    emotionalAngle: "calm",
    keySellingPoints: ["custom fit"],
    platformFit: "tiktok",
    recommendedDurationReason: "30s",
    angleVariants: [],
  };
  const brand: BrandPackagingPlan = {
    mode: "auto_end_card",
    logoAssetId: "lg",
    endCardDurationSeconds: 3,
    cta: "Book Your FREE In-Home Quote",
    brandName: "SUNNY Shutters",
    contactLines: [
      "Call / Text 647-857-8669",
      "690 Progress Ave, Unit 7&8, Scarborough, ON",
    ],
    renderStrategy: "render_ffmpeg_overlay",
    warnings: [],
  };

  const blocked = buildQualityReview({
    classification,
    classifiedAssets: [
      {
        id: "p1",
        type: "IMAGE",
        inferredRole: "product_image",
        roleConfidence: 1,
        url: "https://example.com/product.jpg",
        mimeType: "image/jpeg",
        fileName: "product.jpg",
      },
    ],
    brandPackaging: brand,
    segments: [segment],
    creativeBrief: brief,
    clientLockProfileId: "sunnyshutter",
    storyboard: null,
  });
  assert.equal(blocked.canDispatch, false);
  assert.ok(
    blocked.blockers.some((b) => b.code === "missing_image2_storyboard"),
  );

  const ok = buildQualityReview({
    classification,
    classifiedAssets: [
      {
        id: "p1",
        type: "IMAGE",
        inferredRole: "product_image",
        roleConfidence: 1,
        url: "https://example.com/product.jpg",
        mimeType: "image/jpeg",
        fileName: "product.jpg",
      },
    ],
    brandPackaging: brand,
    segments: [segment],
    creativeBrief: brief,
    clientLockProfileId: "sunnyshutter",
    storyboard: validArtifact(),
  });
  assert.equal(ok.canDispatch, true);
  assert.equal(
    ok.blockers.some((b) => b.code === "missing_image2_storyboard"),
    false,
  );

  /// Non-SunnyShutter brand with same plot-lock prompt: no storyboard gate
  const other = buildQualityReview({
    classification,
    classifiedAssets: [
      {
        id: "p1",
        type: "IMAGE",
        inferredRole: "product_image",
        roleConfidence: 1,
        url: "https://example.com/product.jpg",
        mimeType: "image/jpeg",
        fileName: "product.jpg",
      },
    ],
    brandPackaging: { ...brand, brandName: "Acme Blinds Co" },
    segments: [segment],
    creativeBrief: brief,
    storyboard: null,
  });
  assert.equal(
    other.blockers.some((b) => b.code === "missing_image2_storyboard"),
    false,
  );
});
