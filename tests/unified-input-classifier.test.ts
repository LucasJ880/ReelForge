import assert from "node:assert/strict";
import test from "node:test";
import { classifyInput } from "../src/lib/video-generation/input-classifier";
import type {
  UnifiedVideoGenerationRequest,
  UploadedAsset,
} from "../src/types/video-generation";

function makeAsset(overrides: Partial<UploadedAsset>): UploadedAsset {
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

function makeRequest(
  overrides: Partial<UnifiedVideoGenerationRequest>,
): UnifiedVideoGenerationRequest {
  return {
    userType: "business",
    rawPrompt: "Show our new bottle being used during a morning trail run.",
    attachments: [],
    selectedDuration: 30,
    selectedAspectRatio: "9:16",
    selectedBrandEndingMode: "auto_end_card",
    cta: "Tap to shop",
    platform: null,
    brandKit: { brandName: "Acme", logoUrl: null },
    language: "en",
    ...overrides,
  };
}

test("[unified-input-classifier] Business text-only → text_to_video_ad", () => {
  const c = classifyInput(makeRequest({}));
  assert.equal(c.generationMode, "text_to_video_ad");
  assert.equal(c.needsCTA, true);
  assert.equal(c.needsBrandPackaging, true);
  assert.equal(c.userType, "business");
});

test("[unified-input-classifier] Personal text-only → text_to_video", () => {
  const c = classifyInput(
    makeRequest({
      userType: "personal",
      selectedBrandEndingMode: "none",
      cta: null,
      brandKit: null,
    }),
  );
  assert.equal(c.generationMode, "text_to_video");
  assert.equal(c.needsCTA, false);
  assert.equal(c.needsBrandPackaging, false);
});

test("[unified-input-classifier] Business + product_image → image_to_video_ad", () => {
  const c = classifyInput(
    makeRequest({
      attachments: [makeAsset({})],
    }),
  );
  assert.equal(c.generationMode, "image_to_video_ad");
  assert.equal(c.videoGoal, "product_showcase");
});

test("[unified-input-classifier] Business + product_image + ad_clip → mixed_assets_to_video_ad", () => {
  const c = classifyInput(
    makeRequest({
      attachments: [
        makeAsset({ id: "img1" }),
        makeAsset({
          id: "clip1",
          type: "VIDEO",
          inferredRole: "ad_clip",
          mimeType: "video/mp4",
          fileName: "ad_clip.mp4",
          durationSeconds: 8,
        }),
      ],
    }),
  );
  assert.equal(c.generationMode, "mixed_assets_to_video_ad");
  assert.equal(c.needsUserClipInsertion, true);
});

test("[unified-input-classifier] auto_end_card without logo → missingFields includes 'logo'", () => {
  const c = classifyInput(makeRequest({}));
  assert.ok(c.missingFields.includes("logo"));
  assert.ok(c.warnings.some((w) => w.toLowerCase().includes("logo")));
});

test("[unified-input-classifier] short prompt produces warning", () => {
  const c = classifyInput(makeRequest({ rawPrompt: "Cat video." }));
  assert.ok(c.warnings.some((w) => w.toLowerCase().includes("short")));
});
