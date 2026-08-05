import assert from "node:assert/strict";
import test from "node:test";
import { buildBrandPackagingPlan } from "../src/lib/video-generation/brand-packaging";
import {
  SUNNYSHUTTER_LOGO_OVERLAY_PLACEMENT,
  SUNNYSHUTTER_PHONE,
  applySunnyShutterBrandPack,
  applySunnyShutterLogoOverlayLock,
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

test("SunnyShutter contact end frame locks phone + website + address + still url when opted in", () => {
  const plan = applySunnyShutterBrandPack(
    {
      mode: "auto_end_card",
      logoAssetId: null,
      endCardDurationSeconds: 2,
      cta: "user cta (ignored)",
      brandName: "SUNNY Shutters",
      slogan: null,
      website: null,
      renderStrategy: "render_ffmpeg_overlay",
      warnings: [],
    },
    { clientLockProfileId: "sunnyshutter", aspectRatio: "9:16" },
  );
  assert.equal(plan.mode, "auto_end_card");
  assert.equal(plan.endCardDurationSeconds, 3);
  assert.ok(plan.contactLines?.some((line) => line.includes(SUNNYSHUTTER_PHONE)));
  assert.ok(plan.contactLines?.some((line) => /690\s*Progress/i.test(line)));
  assert.equal(plan.website, "sunnyshutter.ca");
  assert.match(plan.endCardStillUrl ?? "", /end-card-9x16\.png/);
  /// 0805：不再向计划注入角标 placement（角标平台停用）
  assert.equal(plan.logoOverlayPlacement ?? null, null);
  assert.equal(sunnyShutterEndCardMissingIssues(plan).length, 0);
});

test("SunnyShutter per-video opt-out is respected by the brand pack lock (0805)", () => {
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
  assert.equal(plan.mode, "none");
  assert.equal(plan.renderStrategy, "no_end_card");
});

test("SunnyShutter corner watermark is disabled platform-wide (0805 imprint decision)", () => {
  /// 印上式 logo 时代：角标对 SunnyShutter 一律 enabled=false，哪怕显式开。
  assert.equal(SUNNYSHUTTER_LOGO_OVERLAY_PLACEMENT, "top-left");

  const forced = applySunnyShutterLogoOverlayLock(
    { enabled: true, placement: "bottom-right" },
    { clientLockProfileId: "sunnyshutter" },
  );
  assert.equal(forced?.enabled, false);

  const other = applySunnyShutterLogoOverlayLock(
    { enabled: true, placement: "bottom-right" },
    { brandName: "Acme Blinds" },
  );
  assert.equal(other?.enabled, true);
  assert.equal(other?.placement, "bottom-right");
});

test("buildBrandPackagingPlan respects SunnyShutter per-video opt-out", () => {
  const plan = buildBrandPackagingPlan({
    request: baseRequest({ selectedBrandEndingMode: "none" }),
    classification: baseClass({ needsBrandPackaging: false }),
    classifiedAssets: [],
  });
  assert.equal(plan.mode, "none");
  assert.equal(plan.renderStrategy, "no_end_card");
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

test("contact end frame off is no longer a defect; on with missing contacts still is", () => {
  /// 0805：帧可选 —— mode none 不再报 required。
  const offIssues = sunnyShutterEndCardMissingIssues({
    mode: "none",
    endCardDurationSeconds: 0,
    renderStrategy: "no_end_card",
    warnings: [],
  });
  assert.equal(offIssues.length, 0);

  /// 开着但联系方式缺失仍然拦截。
  const onIssues = sunnyShutterEndCardMissingIssues({
    mode: "auto_end_card",
    endCardDurationSeconds: 3,
    cta: "Book now",
    brandName: "SUNNY Shutters",
    contactLines: ["missing everything"],
    renderStrategy: "render_ffmpeg_overlay",
    warnings: [],
  });
  assert.ok(onIssues.some((i) => i.code === "sunnyshutter_end_card_missing_phone"));
  assert.ok(onIssues.some((i) => i.code === "sunnyshutter_end_card_missing_address"));
});
