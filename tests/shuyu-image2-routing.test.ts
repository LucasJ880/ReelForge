import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveImagePlanCandidates } from "../src/lib/video-generation/sunnyshutter-shade-pipeline";
import { generateFrameDeterministically } from "../src/lib/video-generation/storyboard-gacha";

test("strict Image 2 candidates fail closed when live prices contain only Gemini", async () => {
  await assert.rejects(
    () =>
      resolveImagePlanCandidates({
        env: { SHUYU_API_KEY: "configured" },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              object: "list",
              data: [
                {
                  plan_id: "image-plan-03",
                  kind: "image",
                  model: "gemini-2.5-pro-image",
                  unit: "generation",
                  resolution: "1K",
                  sale_points: 24,
                  display_name: "Gemini Pro · 1K",
                  capabilities: {
                    aspect_ratios: ["9:16"],
                    input_images_max: 4,
                    quality: "1K",
                  },
                  status: "available",
                },
              ],
            }),
            { status: 200 },
          ),
      }),
    /Image 2.*unavailable/i,
  );
});

test("preserves the audited provider resolution when an Image 2 plan ID differs from legacy heuristics", async () => {
  const candidates = await resolveImagePlanCandidates({
    env: { SHUYU_API_KEY: "configured" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            {
              plan_id: "image-plan-02",
              kind: "image",
              model: "gpt-image-2",
              unit: "generation",
              // image-plan-02 historically inferred 2K; the audited provider
              // metadata is authoritative and must be retained end-to-end.
              resolution: "4K",
              sale_points: 48,
              display_name: "GPT Image 2 · 4K",
              capabilities: {
                aspect_ratios: ["9:16"],
                input_images_max: 4,
                quality: "4K",
              },
              status: "available",
            },
          ],
        }),
        { status: 200 },
      ),
  });

  assert.deepEqual(candidates, [
    {
      planId: "image-plan-02",
      model: "gpt-image-2",
      resolution: "4K",
      points: 48,
      family: "gpt-image-2",
    },
  ]);
});

test("public Shuyu storyboard selection is deterministic after partial candidate failures and has no platform judge", async () => {
  const picked = await generateFrameDeterministically({
    generateOnce: async (candidateIndex) => {
      if (candidateIndex === 0) throw new Error("busy");
      return `https://example.test/candidate-${candidateIndex}.png`;
    },
    candidateCount: 3,
    label: "deterministic-selection",
  });

  assert.deepEqual(picked.candidateUrls, [
    "https://example.test/candidate-1.png",
    "https://example.test/candidate-2.png",
  ]);
  assert.equal(picked.imageUrl, "https://example.test/candidate-1.png");
  assert.deepEqual(picked.judge, {
    chosenIndex: 0,
    checked: false,
    note: "deterministic first successful Shuyu candidate",
  });

  const [lockedPipeline, shadePipeline] = await Promise.all([
    readFile("src/lib/video-generation/sunnyshutter-image2-pipeline.ts", "utf8"),
    readFile("src/lib/video-generation/sunnyshutter-shade-pipeline.ts", "utf8"),
  ]);
  assert.doesNotMatch(lockedPipeline, /generateFrameWithGacha|analyzeImages/);
  assert.doesNotMatch(shadePipeline, /generateFrameWithGacha|analyzeImages/);
});
