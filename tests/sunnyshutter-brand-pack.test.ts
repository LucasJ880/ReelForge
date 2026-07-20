import assert from "node:assert/strict";
import test from "node:test";
import { buildBrandPackagingPlan } from "../src/lib/video-generation/brand-packaging";
import {
  SUNNYSHUTTER_PHONE,
  applySunnyShutterBrandPack,
  sunnyShutterEndCardMissingIssues,
} from "../src/lib/video-generation/sunnyshutter-brand-pack";
import type {
  InputClassification,
  UnifiedVideoGenerationRequest,
} from "../src/types/video-generation";

function baseRequest(
  overrides: Partial<UnifiedVideoGenerationRequest> = {},
): UnifiedVideoGenerationRequest {
  return {
    userType: "business",
    rawPrompt: "Custom plantation shutter sales ad",
    attachments: [],
    selectedDuration: 15,
    selectedAspectRatio: "9:16",
    selectedBrandEndingMode: "auto_end_card",
    cta: "Shop now",
    platform: null,
    brandKit: {
      brandName: "SUNNY Shutters",
      logoUrl: "https://example.com/sunny.png",
      slogan: "ignored",
      website: null,
    },
    language: "en",
    ...overrides,
  };
}

function baseClass(
  overrides: Partial<InputClassification> = {},
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

test("SunnyShutter brand pack locks phone + address + Image2 still url", () => {
  const plan = applySunnyShutterBrandPack(
    {
      mode: "none",
      endCardDurationSeconds: 0,
      cta: null,
      brandName: null,
      slogan: null,
      website: null,
      renderStrategy: "no_end_card",
      warnings: [],
    },
    { clientLockProfileId: "sunnyshutter", aspectRatio: "9:16" },
  );
  assert.equal(plan.mode, "auto_end_card");
  assert.equal(plan.endCardDurationSeconds, 3);
  assert.ok(plan.contactLines?.some((line) => line.includes(SUNNYSHUTTER_PHONE)));
  assert.ok(plan.contactLines?.some((line) => /690\s*Progress/i.test(line)));
  assert.match(plan.endCardStillUrl ?? "", /end-card-9x16\.png/);
  assert.equal(sunnyShutterEndCardMissingIssues(plan).length, 0);
});

test("buildBrandPackagingPlan forces SunnyShutter end card even when mode=none", () => {
  const plan = buildBrandPackagingPlan({
    request: baseRequest({ selectedBrandEndingMode: "none" }),
    classification: baseClass({ needsBrandPackaging: false }),
    classifiedAssets: [],
  });
  assert.equal(plan.mode, "auto_end_card");
  assert.ok(plan.contactLines?.join(" ").includes(SUNNYSHUTTER_PHONE));
  assert.match(plan.cta ?? "", /FREE In-Home Quote/i);
});

test("other brands are not forced onto SunnyShutter contacts", () => {
  const plan = buildBrandPackagingPlan({
    request: baseRequest({
      brandKit: {
        brandName: "Acme Blinds",
        logoUrl: "https://example.com/acme.png",
        slogan: null,
        website: null,
      },
      cta: "Tap to shop",
    }),
    classification: baseClass(),
    classifiedAssets: [],
  });
  assert.equal(plan.mode, "auto_end_card");
  assert.equal(plan.cta, "Tap to shop");
  assert.equal(plan.contactLines ?? null, null);
  assert.equal(plan.endCardStillUrl ?? null, null);
});

test("sunnyShutterEndCardMissingIssues flags empty packaging", () => {
  const issues = sunnyShutterEndCardMissingIssues({
    mode: "none",
    endCardDurationSeconds: 0,
    renderStrategy: "no_end_card",
    warnings: [],
  });
  assert.ok(issues.some((i) => i.code === "sunnyshutter_end_card_required"));
});
