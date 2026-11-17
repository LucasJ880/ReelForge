import assert from "node:assert/strict";
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
  assert.equal(PRODUCT_IMAGE_PROMPT_VERSION, "product-image-shuyu-v3");
  /// 未开印 logo 时不得出现印制指令
  assert.doesNotMatch(prompt, /reference image 2/i);
  assert.doesNotMatch(prompt, /imprint/i);
});

test("brand-logo prompt imprints reference image 2 with factory-branding fidelity", () => {
  const prompt = buildProductImagePrompt({
    hasReference: true,
    hasBrandLogo: true,
    description: "warm bedroom scene, keep the fabric drape natural",
    preset: "lifestyle",
    aspectRatio: "9:16",
    resultCount: 1,
  });
  assert.match(prompt, /reference image 1 is the product photograph/i);
  assert.match(prompt, /reference image 2 is the official brand logo/i);
  assert.match(prompt, /imprint the exact logo from reference image 2/i);
  assert.match(prompt, /identical letterforms, spelling, colors, and proportions/i);
  assert.match(prompt, /never redesign, restyle, retype, or translate/i);
  assert.match(prompt, /perspective, curvature, material texture/i);
  assert.match(prompt, /beyond the supplied brand logo/i);
  /// 印 logo 时约束改述，不再出现「invented logos」原句
  assert.doesNotMatch(prompt, /invented logos/i);
});

test("brand-logo flag without a product reference never emits imprint directives", () => {
  const prompt = buildProductImagePrompt({
    hasReference: false,
    hasBrandLogo: true,
    description: "an unbranded matte black travel mug",
    preset: "white_studio",
    aspectRatio: "1:1",
    resultCount: 1,
  });
  assert.doesNotMatch(prompt, /reference image 2/i);
  assert.doesNotMatch(prompt, /imprint/i);
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
