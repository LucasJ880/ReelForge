import assert from "node:assert/strict";
import test from "node:test";
import { buildVideoSegments, __test__ as promptIntel } from "../src/lib/video-generation/prompt-intelligence";
import { planUnifiedSegments } from "../src/lib/video-generation/segment-planner-adapter";
import { buildStoryboardFramePlans } from "../src/lib/video-generation/storyboard-service";
import type { VisualReferenceAnalysis } from "../src/lib/video-generation/visual-reference-analysis";
import type { CreativeBrief, InputClassification, UploadedAsset } from "../src/types/video-generation";

/**
 * 2026-10-28 商品主体轮 P0：品牌跟着商品走。商品自己印的 logo / 标签必须照原样保留；提示词只禁「额外添加」的字和 logo。
 * 任何一处回到一刀切的「no logo / no brand text / no readable text」，模型都会把保温杯上自己印的 logo 抹掉或糊掉
 *（Shuyu 把负面拼成「Negative constraints: …」直接给模型读）。
 */

const BLANKET_BANS = ["no logo", "no logos", "no brand text", "no readable text"];
const items = (negative: string) => negative.split(",").map((item) => item.trim().toLowerCase());
const assertNoBlanketBans = (negative: string) => {
  for (const ban of BLANKET_BANS) assert.ok(!items(negative).includes(ban), `负面里还有一刀切的「${ban}」`);
};

test("默认负面：不再一刀切禁 logo 与可读文字，只禁额外添加，并点名保留商品印字", () => {
  const negative = promptIntel.DEFAULT_NEGATIVE_PROMPT;
  assertNoBlanketBans(negative);
  assert.match(negative, /no logo added and no brand text added \(keep any logo or label printed on the product exactly as in the reference photos\)/);
  assert.match(negative, /no invented or misspelled lettering/);
  assert.match(negative, /no subtitles, no captions, no on-screen text$/);
});

test("LLM 照旧规则写的负面：剔掉一刀切禁字项、补守卫、同项去重，且幂等", () => {
  const llm = "blurry, no logo, no brand text, No URLs, no readable text, no QR codes, no subtitles,";
  const out = promptIntel.appendBrandGuard(llm);
  assertNoBlanketBans(out);
  assert.ok(items(out).includes("blurry"));
  assert.equal(items(out).filter((item) => item === "no urls").length, 1);
  assert.equal(items(out).filter((item) => item === "no subtitles").length, 1);
  assert.match(out, /keep any logo or label printed on the product exactly as in the reference photos/);
  assert.match(out, /no on-screen text/);
  assert.equal(promptIntel.appendBrandGuard(out), out);
  assert.equal(promptIntel.appendBrandGuard(promptIntel.DEFAULT_NEGATIVE_PROMPT), promptIntel.DEFAULT_NEGATIVE_PROMPT);
});

test("给 LLM 的品牌守卫：商品印字是商品的一部分；负面必含项不再是一刀切禁字", () => {
  const rule = promptIntel.SEEDANCE_BRAND_GUARD_RULE;
  assert.match(rule, /printed on the product in the reference photos must stay exactly as photographed/);
  assert.match(rule, /Never ask the model to remove, blur, hide or replace them/);
  assert.doesNotMatch(rule, /MUST include: "no logo, no brand text/);
  assert.match(rule, /Never write a bare "no logo", "no brand text" or "no readable text"/);
});

const brief: CreativeBrief = {
  hook: "A steel travel mug steams on a sunny desk",
  narrative: "Show the mug keeping coffee hot through a busy morning",
  targetAudience: "Commuters 25-40",
  corePainPoint: "Coffee goes cold before the meeting ends",
  emotionalAngle: "Calm and in control",
  keySellingPoints: ["keeps drinks hot for 6 hours"],
  cta: "Tap to shop",
  platformFit: "tiktok 9:16",
  recommendedDurationReason: "15s fits one buying reason",
  angleVariants: [],
};

const classification: InputClassification = {
  userType: "business",
  generationMode: "image_to_video_ad",
  videoGoal: "product_ad",
  targetPlatform: "tiktok",
  needsCTA: true,
  needsBrandPackaging: false,
  needsUserClipInsertion: false,
  confidence: 0.9,
  missingFields: [],
  warnings: [],
};

const productPhoto: UploadedAsset = {
  id: "asset-mug",
  assetId: "asset-mug",
  type: "IMAGE",
  inferredRole: "product_image",
  roleConfidence: 1,
  url: "https://example.com/mug.png",
  mimeType: "image/png",
  fileName: "mug.png",
  width: 1024,
  height: 1024,
  durationSeconds: null,
  userAssignedRole: "product_image",
  suggestedUse: "product",
  warnings: [],
};

/// 白底商品图（不是真实场所），杯身印着品牌字
const productPrintOnWhite: VisualReferenceAnalysis = {
  isRealLocation: false,
  locationDescription: null,
  signageText: "AQUA CUP",
  signageKind: "product_print",
  keyFeatures: [],
  productDescription: "a brushed steel travel mug with a black lid",
  viewsCovered: ["front"],
  photoCount: 1,
};

test("白底商品图上的印字：写进 PRODUCT 行并防复制、放大、抹除；不加「不准脑补房间」", async () => {
  const segments = await buildVideoSegments({
    creativeBrief: brief,
    segmentSlots: planUnifiedSegments({ targetDurationSec: 15, clipPlacement: null, brandPackaging: null }),
    classifiedAssets: [productPhoto],
    classification,
    aspectRatio: "9:16",
    visualRefs: productPrintOnWhite,
  });
  const ai = segments.filter((segment) => segment.type === "ai_generated_clip");
  assert.ok(ai.length > 0);
  for (const segment of ai) {
    assert.match(segment.prompt ?? "", /^PRODUCT[^\n]*The brand mark printed on the product reads exactly "AQUA CUP"[^\n]*never erase it\./m);
    assert.doesNotMatch(segment.prompt ?? "", /REAL LOCATION/);
    assert.doesNotMatch(segment.prompt ?? "", /readable text/);
    const negative = segment.negativePrompt ?? "";
    assertNoBlanketBans(negative);
    assert.match(negative, /duplicated brand mark/);
    assert.doesNotMatch(negative, /invented rooms/);
  }
});

test("真实门店的招牌照旧：只写在 REAL LOCATION 行，负面带「不准脑补房间」", async () => {
  const segments = await buildVideoSegments({
    creativeBrief: brief,
    segmentSlots: planUnifiedSegments({ targetDurationSec: 15, clipPlacement: null, brandPackaging: null }),
    classifiedAssets: [productPhoto],
    classification,
    aspectRatio: "9:16",
    visualRefs: { ...productPrintOnWhite, isRealLocation: true, signageText: "Meow Club", signageKind: "storefront" },
  });
  const segment = segments.find((item) => item.type === "ai_generated_clip");
  assert.ok(segment);
  assert.match(segment.prompt ?? "", /^REAL LOCATION[^\n]*The storefront sign reads exactly "Meow Club"/m);
  assert.doesNotMatch(segment.prompt ?? "", /^PRODUCT[^\n]*Meow Club/m);
  assert.match(segment.negativePrompt ?? "", /invented rooms/);
});

test("故事板出帧：只禁额外添加的字和 logo，商品印字写进身份锁", () => {
  const plans = buildStoryboardFramePlans({
    prompt: "保温杯放在晨光里的书桌上，杯身的字清清楚楚",
    durationSec: 15,
    aspectRatio: "9:16",
  });
  assert.ok(plans.length > 0);
  for (const frame of plans) {
    assert.doesNotMatch(frame.prompt, /No text, subtitles, logos/);
    assert.match(frame.prompt, /a logo or lettering printed on the product itself stays exactly as in the product photos/);
    assert.match(frame.prompt, /^PRODUCT IDENTITY LOCK:[^\n]*printed logo or label/m);
  }
});
