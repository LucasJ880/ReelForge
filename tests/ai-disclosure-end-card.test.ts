import assert from "node:assert/strict";
import test from "node:test";
import { buildBrandPackagingPlan } from "../src/lib/video-generation/brand-packaging";

test("AI disclosure end card can be enabled independently of customer branding", () => {
  const previous = process.env.AI_DISCLOSURE_END_CARD_ENABLED;
  process.env.AI_DISCLOSURE_END_CARD_ENABLED = "true";
  try {
    const plan = buildBrandPackagingPlan({
      request: { selectedDuration: 15, selectedBrandEndingMode: "none", attachments: [], prompt: "test", selectedAspectRatio: "9:16" } as never,
      classification: { needsBrandPackaging: false } as never,
      classifiedAssets: [],
    });
    assert.equal(plan.mode, "auto_end_card");
    assert.equal(plan.brandName, "AI Generated · Aivora");
    assert.equal(plan.renderStrategy, "render_ffmpeg_overlay");
  } finally {
    if (previous == null) delete process.env.AI_DISCLOSURE_END_CARD_ENABLED;
    else process.env.AI_DISCLOSURE_END_CARD_ENABLED = previous;
  }
});
