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

/// 首发 8 个 slug 是既有批次的 FK 溯源锚点，永远不许改名或移位。
const LEGACY_EIGHT_SLUGS = [
  "commerce-aesthetic-mood",
  "commerce-ugc-testimonial",
  "commerce-demo-first-reveal",
  "commerce-single-feature-proof",
  "commerce-unboxing-transform",
  "commerce-value-proof",
  "commerce-problem-solution",
  "commerce-hard-sell-presenter",
] as const;

/// 2026-08-03 扩容批次（来源映射见 docs/roadmap/2026-08-03-template-library-expansion.md）。
const EXPANSION_SLUGS = [
  "commerce-talking-head-review",
  "commerce-podcast-authority",
  "commerce-founder-story",
  "commerce-street-interview",
  "commerce-hook-face-demo",
  "commerce-triple-proof",
  "commerce-creator-reaction",
  "commerce-before-after-match",
  "commerce-360-hero-orbit",
  "commerce-variant-lineup",
  "commerce-whats-in-box",
  "commerce-in-hand-scale",
  "commerce-macro-texture-asmr",
  "commerce-dark-luxury-light",
  "commerce-morning-routine",
  "commerce-pov-immersive",
  "commerce-dual-context",
  "commerce-pet-companion",
  "commerce-home-space-styling",
  "commerce-fashion-lookbook",
  "commerce-beauty-texture",
  "commerce-food-sizzle",
  "commerce-tech-feature-focus",
  "commerce-outdoor-rugged",
  "commerce-travel-pack-flow",
  "commerce-gift-unwrap",
] as const;

const EXPECTED_SLUGS = [...LEGACY_EIGHT_SLUGS, ...EXPANSION_SLUGS] as const;

test("commerce catalog exposes the canonical stable slugs (8 legacy + 26 expansion; seamless-loop 两轮真机未过循环点验收,0804 砍除)", () => {
  assert.deepEqual(COMMERCE_TEMPLATE_SLUGS, EXPECTED_SLUGS);
  assert.deepEqual(COMMERCE_TEMPLATE_SLUGS.slice(0, 8), LEGACY_EIGHT_SLUGS);
  assert.equal(COMMERCE_TEMPLATE_RECIPES.length, 34);
  assert.equal(COMMERCE_TEMPLATE_SEEDS.length, 34);
  assert.equal(new Set(COMMERCE_TEMPLATE_SLUGS).size, 34);
  assert.ok(
    COMMERCE_TEMPLATE_RECIPES.length >= 30,
    "模板体量必须保持同行水位（30+）",
  );
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
