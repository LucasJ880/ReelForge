import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildProductImagePrompt,
  PRODUCT_IMAGE_PRESETS,
  PRODUCT_IMAGE_PROMPT_VERSION,
} from "../src/lib/services/product-image-service";
import {
  detectMediaMime,
  validateMediaMagicBytes,
} from "../src/lib/upload/media-file-validation";
import { DEFAULT_IMAGE_MODEL, generateImages } from "../src/lib/providers/openai-image";

test("legacy direct image provider remains mockable for historical non-public callers", async () => {
  assert.equal(DEFAULT_IMAGE_MODEL, "gpt-image-2");
  const result = await generateImages({
    prompt: "a faithful product photo",
    n: 1,
    forceMock: true,
  });
  assert.equal(result.fromMock, true);
  assert.equal(result.modelUsed, "mock");
  assert.equal(result.usage, null);
  assert.match(result.urls[0], /^\/template-previews\//);
});

test("optimize prompt locks product identity instead of redesigning it", () => {
  const prompt = buildProductImagePrompt({
    hasReference: true,
    description: "clean white background and softer shadow",
    preset: "white_studio",
    aspectRatio: "4:5",
    resultCount: 1,
  });
  assert.match(prompt, /sole visual source of truth/i);
  assert.match(prompt, /exact product identity/i);
  assert.match(prompt, /geometry, proportions, color, material, packaging, logo/i);
  assert.match(prompt, /Never redesign or replace the product/i);
  assert.match(prompt, /warped geometry/i);
  assert.match(prompt, /4:5/);
  assert.equal(PRODUCT_IMAGE_PROMPT_VERSION, "product-image-shuyu-v2");
});

test("generate prompt forbids invented branding, claims and common product hallucinations", () => {
  const prompt = buildProductImagePrompt({
    hasReference: false,
    description: "an unbranded matte black travel mug",
    preset: "social",
    aspectRatio: "9:16",
    resultCount: 2,
  });
  assert.match(prompt, /do not invent brand identity/i);
  assert.match(prompt, /regulated performance claims/i);
  assert.match(prompt, /invented logos/i);
  assert.match(prompt, /duplicate parts/i);
  assert.equal(Object.keys(PRODUCT_IMAGE_PRESETS).length, 5);
});

test("magic-byte validation accepts supported real signatures and rejects spoofed images", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(detectMediaMime(png), "image/png");
  assert.deepEqual(validateMediaMagicBytes(png, "image/png"), {
    ok: true,
    detected: "image/png",
  });
  const spoof = new TextEncoder().encode("<script>alert(1)</script>");
  assert.equal(validateMediaMagicBytes(spoof, "image/png").ok, false);
});

test("shared upload validator accepts ISO media container for MP4 video and M4A audio", () => {
  const ftyp = Uint8Array.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
  ]);
  assert.equal(validateMediaMagicBytes(ftyp, "video/mp4").ok, true);
  assert.equal(validateMediaMagicBytes(ftyp, "audio/x-m4a").ok, true);
  assert.equal(validateMediaMagicBytes(ftyp, "image/png").ok, false);
});

test("product-image route contract has auth, owner idempotency, rate limit and owned source assets", async () => {
  const route = await readFile("src/app/api/product-images/route.ts", "utf8");
  assert.match(route, /requireAuth\(\)/);
  assert.match(route, /userId_idempotencyKey/);
  assert.match(route, /assertAuthenticatedActionRateLimit/);
  assert.match(route, /resolveOwnedImageAssets/);
  assert.doesNotMatch(route, /reviewMediaOrThrow/);
  assert.match(route, /sourceAssetId/);
  assert.match(route, /resultCount/);
});

test("video handoff loads product images with owner-scoped lookup", async () => {
  const [single, batch] = await Promise.all([
    readFile("src/app/(platform)/app/create/page.tsx", "utf8"),
    readFile("src/app/(platform)/app/batches/new/page.tsx", "utf8"),
  ]);
  for (const page of [single, batch]) {
    assert.match(page, /findProductImageResultForUser/);
    assert.match(page, /session\.user\.id/);
    assert.match(page, /productImageResultId/);
  }
  assert.match(single, /result\.assetId/);
  assert.match(single, /assetId: result\.assetId/);
  assert.match(batch, /result\.assetId/);
  assert.doesNotMatch(single, /product_image_\$\{job\.id\}/);
  assert.doesNotMatch(batch, /product-image-\$\{job\.id\}/);
  assert.match(single, /inferredRole: "product_image"/);
  assert.match(batch, /initialImages/);
});

test("customer UI exposes one optional-reference Shuyu workbench and video handoffs", async () => {
  const [ui, copy] = await Promise.all([
    readFile("src/components/product-images/product-image-studio.tsx", "utf8"),
    readFile("src/i18n/platform-copy.ts", "utf8"),
  ]);
  assert.match(ui, /Shuyu Image 2/);
  assert.match(ui, /sourceAssetId/);
  assert.match(ui, /resultCount/);
  assert.match(ui, /copy\.useSingle/);
  assert.match(ui, /copy\.useBatch/);
  assert.match(ui, /outputAssetId: string \| null/);
  assert.match(ui, /productImageResultId/);
  assert.match(copy, /优化实拍图/);
  assert.match(copy, /生成产品图/);
  assert.match(copy, /用于单条视频/);
  assert.match(copy, /用于批量视频/);
  assert.match(ui, /download/);
  assert.doesNotMatch(ui, /shuyu_api_key|sk_live_|ARK_API_KEY/);
});
