import assert from "node:assert/strict";
import test from "node:test";
import { buildRenderFallbackManifest } from "../src/lib/services/ad-render-service";

test("renderer fallback manifest captures reason and timeline", () => {
  const timeline = {
    clips: [
      {
        footageShotId: "shot_1",
        rawAssetId: "asset_1",
        sourceUrl: "https://example.com/clip.mp4",
        startMs: 0,
        endMs: 3000,
        durationMs: 3000,
        role: "hook",
        rationale: "Opening hook",
      },
    ],
  };

  const manifest = buildRenderFallbackManifest({
    planId: "plan_1",
    title: "Fallback demo",
    reason: "ENABLE_FFMPEG_RENDER 未开启",
    timeline,
  });

  assert.equal(manifest.kind, "aivora_ad_edit_plan_manifest");
  assert.equal(manifest.planId, "plan_1");
  assert.match(manifest.fallbackReason, /ENABLE_FFMPEG_RENDER/);
  assert.deepEqual(manifest.timeline, timeline);
});
