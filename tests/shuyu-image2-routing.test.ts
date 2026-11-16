import assert from "node:assert/strict";
import test from "node:test";
import { generateFrameDeterministically } from "../src/lib/video-generation/storyboard-gacha";

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
});
