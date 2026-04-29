import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAdEditTimeline,
  parseDirectorOutput,
  parseReviewerOutput,
} from "../src/lib/schemas/ad-edit-plan";

const validTimeline = {
  clips: [
    {
      footageShotId: "shot_1",
      rawAssetId: "asset_1",
      sourceUrl: "https://example.com/clip.mp4",
      startMs: 0,
      endMs: 3000,
      durationMs: 3000,
      role: "hook",
      rationale: "Strong opening proof.",
    },
  ],
  captions: [{ startMs: 0, endMs: 2500, text: "Real local pet store" }],
  overlays: [{ startMs: 0, endMs: 2500, text: "Save this spot", position: "bottom" }],
  render: {
    strategy: "ffmpeg_concat",
    aspectRatio: "9:16",
    fallback: "manifest",
    reviewerRetryThreshold: 0.65,
  },
};

test("AdEditPlan timeline validation accepts the shared typed structure", () => {
  const timeline = parseAdEditTimeline(validTimeline);
  assert.equal(timeline.clips.length, 1);
  assert.equal(timeline.clips[0].role, "hook");
});

test("AdEditPlan timeline validation rejects malformed clip timing", () => {
  assert.throws(
    () =>
      parseAdEditTimeline({
        ...validTimeline,
        clips: [{ ...validTimeline.clips[0], endMs: 0 }],
      }),
    /endMs must be greater/,
  );
});

test("DirectorAgent output parsing rejects malformed LLM JSON", () => {
  assert.throws(
    () =>
      parseDirectorOutput({
        title: "Bad output",
        objective: "Missing clips",
        duration_ms: 15000,
        timeline: { clips: [] },
      }),
    /DirectorAgent 输出 JSON 无效/,
  );
});

test("ReviewerAgent output parsing clamps the expected route enum", () => {
  assert.throws(
    () =>
      parseReviewerOutput({
        scores: {
          hook: 0.8,
          pacing: 0.8,
          visual_match: 0.8,
          offer_clarity: 0.8,
          technical_quality: 0.8,
        },
        summary: "Looks good.",
        feedback: [],
        route: "ship_it",
      }),
    /ReviewerAgent 输出 JSON 无效/,
  );
});
