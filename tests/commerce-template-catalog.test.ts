import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMERCE_TEMPLATE_RECIPES,
  COMMERCE_TEMPLATE_SLUGS,
  commerceTemplateSummary,
} from "../src/lib/video-generation/commerce-template-catalog";
import {
  COMMERCE_TEMPLATE_SEEDS,
  renderCommerceTemplate,
} from "../src/lib/video-generation/generic-commerce-template";

const EXPECTED_SLUGS = [
  "commerce-aesthetic-mood",
  "commerce-ugc-testimonial",
  "commerce-demo-first-reveal",
  "commerce-single-feature-proof",
  "commerce-unboxing-transform",
  "commerce-value-proof",
  "commerce-problem-solution",
  "commerce-hard-sell-presenter",
] as const;

test("commerce catalog exposes the canonical eight stable slugs", () => {
  assert.deepEqual(COMMERCE_TEMPLATE_SLUGS, EXPECTED_SLUGS);
  assert.equal(COMMERCE_TEMPLATE_RECIPES.length, 8);
  assert.equal(COMMERCE_TEMPLATE_SEEDS.length, 8);
  assert.equal(new Set(COMMERCE_TEMPLATE_SLUGS).size, 8);
});

test("every recipe has hook, proof, CTA, summary, and product-safe copy", () => {
  for (const recipe of COMMERCE_TEMPLATE_RECIPES) {
    assert.ok(recipe.hook.trim());
    assert.ok(recipe.proof.trim());
    assert.ok(recipe.cta.trim());
    assert.ok(commerceTemplateSummary(recipe.slug)?.trim());
    assert.doesNotMatch(JSON.stringify(recipe), /SunnyShutter|louver|shutter/i);
  }
});

test("rendered commerce prompts are deterministic, bounded, and product-agnostic", () => {
  for (const seed of COMMERCE_TEMPLATE_SEEDS) {
    const first = renderCommerceTemplate(seed.slug, {
      productName: "TrailPack organizer",
      imageUrls: [
        "https://assets.example.test/trailpack/front.jpg",
        "https://assets.example.test/trailpack/open.jpg",
      ],
    });
    const second = renderCommerceTemplate(seed.slug, {
      productName: "TrailPack organizer",
      imageUrls: [
        "https://assets.example.test/trailpack/front.jpg",
        "https://assets.example.test/trailpack/open.jpg",
      ],
    });
    assert.equal(first, second);
    assert.match(first, /TrailPack organizer/);
    assert.match(first, /visual truth/i);
    assert.match(first, /Never invent/i);
    assert.doesNotMatch(first, /SunnyShutter|louver|plantation shutter/i);
    assert.ok(first.length >= 700 && first.length < 5_000);
  }
});
