import assert from "node:assert/strict";
import test from "node:test";
import {
  generateFrameDeterministically,
  genericJudgeSystem,
} from "../src/lib/video-generation/storyboard-gacha";

test("generic judge rubric contains no window-covering assumptions", () => {
  const rubric = genericJudgeSystem();
  assert.match(rubric, /product identity/i);
  assert.match(rubric, /intended action/i);
  assert.match(rubric, /human anatomy/i);
  assert.doesNotMatch(rubric, /louver|shutter|window covering|pull chain/i);
});

test("public Shuyu selection remains deterministic and free of judge calls", async () => {
  let calls = 0;
  const selected = await generateFrameDeterministically({
    candidateCount: 3,
    generateOnce: async (index) => {
      calls += 1;
      if (index === 0) throw new Error("first failed");
      return `https://assets.example.test/candidate-${index}.jpg`;
    },
  });
  assert.equal(calls, 3);
  assert.equal(
    selected.imageUrl,
    "https://assets.example.test/candidate-1.jpg",
  );
  assert.equal(selected.judge.checked, false);
  assert.match(selected.judge.note, /deterministic first successful Shuyu/);
});
