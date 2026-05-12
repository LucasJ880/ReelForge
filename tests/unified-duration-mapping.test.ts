/**
 * Matrix tests over the 3 supported durations × 3 aspect ratios.
 * Verifies that the supervisor produces a consistent assembly plan
 * (resolution, fps, codec) and that segment count matches duration.
 */
process.env.LLM_FORCE_MOCK = "true";

import assert from "node:assert/strict";
import test from "node:test";
import { buildPlan } from "../src/lib/video-generation/generation-supervisor";
import type {
  AspectRatio,
  UnifiedVideoGenerationRequest,
} from "../src/types/video-generation";
import type { SupportedDurationSec } from "../src/lib/duration/segment-planner";

const DURATIONS: SupportedDurationSec[] = [15, 30, 60];
const RATIOS: AspectRatio[] = ["9:16", "16:9", "1:1"];
const EXPECTED_RES: Record<AspectRatio, string> = {
  "9:16": "1080x1920",
  "16:9": "1920x1080",
  "1:1": "1080x1080",
};
const EXPECTED_END_CARD_SEC: Record<SupportedDurationSec, number> = {
  15: 2,
  30: 3,
  60: 4,
};
const EXPECTED_AI_SEGS: Record<SupportedDurationSec, number> = {
  15: 1,
  30: 2,
  60: 4,
};

function req(
  duration: SupportedDurationSec,
  aspect: AspectRatio,
): UnifiedVideoGenerationRequest {
  return {
    userType: "business",
    rawPrompt:
      "Morning kitchen routine, real user pours water from our reusable bottle. Sunlit counter, calm energy.",
    attachments: [],
    selectedDuration: duration,
    selectedAspectRatio: aspect,
    selectedBrandEndingMode: "auto_end_card",
    cta: "Tap to shop",
    platform: null,
    brandKit: { brandName: "Acme", logoUrl: "https://example.com/logo.png" },
    language: "en",
  };
}

for (const duration of DURATIONS) {
  for (const aspect of RATIOS) {
    test(`[unified-duration-aspect-matrix] ${duration}s × ${aspect}`, async () => {
      const plan = await buildPlan(req(duration, aspect));

      assert.equal(plan.assemblyPlan.aspectRatio, aspect);
      assert.equal(plan.assemblyPlan.targetResolution, EXPECTED_RES[aspect]);
      assert.equal(plan.assemblyPlan.fps, 30);
      assert.equal(plan.assemblyPlan.outputCodec, "h264_aac_mp4");

      /// Segment count: AI segments + 1 brand end card
      const aiSegs = plan.segments.filter((s) => s.type === "ai_generated_clip");
      const endCards = plan.segments.filter((s) => s.type === "brand_end_card");
      assert.equal(aiSegs.length, EXPECTED_AI_SEGS[duration]);
      assert.equal(endCards.length, 1);

      /// End card duration scales with total
      assert.equal(endCards[0].durationSeconds, EXPECTED_END_CARD_SEC[duration]);

      /// Final duration = duration + end card
      assert.equal(
        plan.assemblyPlan.finalDurationSeconds,
        duration + EXPECTED_END_CARD_SEC[duration],
      );

      /// Plan preview breakdown matches
      assert.equal(plan.planPreview.breakdown.aspectRatio, aspect);
      assert.equal(plan.planPreview.breakdown.aiClipCount, EXPECTED_AI_SEGS[duration]);
      assert.equal(plan.planPreview.breakdown.hasBrandEndCard, true);
    });
  }
}
