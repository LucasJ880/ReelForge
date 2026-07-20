import assert from "node:assert/strict";
import test from "node:test";
import {
  BATCH_STYLE_TEMPLATE_SEEDS,
  renderBatchTemplatePrompt,
} from "../src/lib/video-generation/batch-style-templates";
import {
  SUNNYSHUTTER_COMMERCE_CLIENT_LOCK,
  SUNNYSHUTTER_COMMERCE_PLOT_VARIANTS,
  SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY,
  SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS,
  isSunnyShutterCommerceTemplateSlug,
  pickSunnyShutterCommerceVariant,
} from "../src/lib/video-generation/sunnyshutter-commerce-template";
import { findUnsafeShutterPromptViolations } from "../src/lib/video-generation/shutter-shot-policy";

test("SunnyShutter commerce family: 5 plot variants, unique slugs, wired into BATCH seeds", () => {
  assert.equal(SUNNYSHUTTER_COMMERCE_PLOT_VARIANTS.length, 5);
  assert.equal(SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS.length, 5);
  assert.equal(SUNNYSHUTTER_COMMERCE_CLIENT_LOCK, "sunnyshutter");

  const slugs = SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS.map((t) => t.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.ok(slugs.every((slug) => slug.startsWith(`${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-`)));

  for (const seed of SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS) {
    assert.ok(
      BATCH_STYLE_TEMPLATE_SEEDS.some((row) => row.slug === seed.slug),
      `${seed.slug} missing from BATCH_STYLE_TEMPLATE_SEEDS`,
    );
    assert.equal(seed.category, "SunnyShutter电商");
    assert.equal(seed.lockedParams.duration, 15);
    assert.equal(seed.lockedParams.aspectRatio, "9:16");
  }
});

test("SunnyShutter commerce skeletons lock sales narrative + safe motions; no suicide shots", () => {
  for (const seed of SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS) {
    assert.match(seed.promptSkeleton, /0-3s HOOK/i);
    assert.match(seed.promptSkeleton, /CONFLICT|CONTRAST|RESONANCE/i);
    assert.match(seed.promptSkeleton, /RETURN TO PRODUCT/i);
    assert.match(seed.promptSkeleton, /sales \/ CTA ecommerce/i);
    assert.match(seed.promptSkeleton, /PRODUCT MECHANICS PRECONDITIONS/);
    assert.match(seed.promptSkeleton, /\{IMAGE_REFS\}/);
    assert.match(seed.promptSkeleton, /\{PRODUCT_NAME\}/);
    assert.match(seed.promptSkeleton, /visual truth/i);
    assert.equal(findUnsafeShutterPromptViolations(seed.promptSkeleton).length, 0);

    const filled = renderBatchTemplatePrompt({
      promptSkeleton: seed.promptSkeleton,
      productName: "Custom plantation shutters",
      imageUrls: [
        "https://example.com/a.jpg",
        "https://example.com/b.jpg",
      ],
    });
    assert.match(filled, /Image 1: https:\/\/example.com\/a\.jpg/);
    assert.equal(findUnsafeShutterPromptViolations(filled).length, 0);
  }
});

test("pickSunnyShutterCommerceVariant rotates deterministically for a 10-video batch", () => {
  const picked = Array.from({ length: 10 }, (_, i) =>
    pickSunnyShutterCommerceVariant(i + 1),
  );
  assert.equal(picked[0]!.id, SUNNYSHUTTER_COMMERCE_PLOT_VARIANTS[0]!.id);
  assert.equal(picked[5]!.id, SUNNYSHUTTER_COMMERCE_PLOT_VARIANTS[0]!.id);
  assert.equal(new Set(picked.map((v) => v.id)).size, 5);
  assert.ok(isSunnyShutterCommerceTemplateSlug(picked[0]!.slug));
  assert.equal(isSunnyShutterCommerceTemplateSlug("slow-360-orbit"), false);
});
