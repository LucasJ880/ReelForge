import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_SHOT_MOTIONS,
  PRODUCT_MECHANICS_PRECONDITIONS,
  findUnsafeShutterPromptViolations,
  isAllowedShotMotion,
  renderSafeShutterPrompt,
  type ShotMotion,
} from "../src/lib/video-generation/shutter-shot-policy";

test("allowed shot motions are a closed enum", () => {
  assert.deepEqual([...ALLOWED_SHOT_MOTIONS].sort(), [
    "louver_tilt_no_hands",
    "panel_hinge_open",
    "presenter_point_only",
    "static_product",
  ]);
  assert.equal(isAllowedShotMotion("static_product"), true);
  assert.equal(isAllowedShotMotion("hand_on_tilt_bar"), false);
});

test("renderSafeShutterPrompt rejects unknown motions", () => {
  assert.throws(
    () =>
      renderSafeShutterPrompt({
        motion: "hand_on_tilt_bar" as ShotMotion,
        productName: "plantation shutters",
        beats: ["hold on the shutter wall"],
      }),
    /not an allowed ShotMotion/,
  );
});

test("renderSafeShutterPrompt always injects mechanics preconditions and lock blocks", () => {
  const prompt = renderSafeShutterPrompt({
    motion: "panel_hinge_open",
    productName: "custom plantation shutters",
    beats: [
      "0-5s: wide room hold on the shutter wall",
      "5-12s: one panel swings open on side hinges",
      "12-15s: hold on the open view",
    ],
    characterLock:
      "one Canadian consultant, mid-30s, auburn hair, navy blazer over white top",
    voiceLock: "warm spoken Canadian English, quiet room ambience, no music",
    microExpressionLock: "soft genuine smile, no exaggerated faces",
  });

  assert.match(prompt, /PRODUCT MECHANICS PRECONDITIONS/);
  assert.match(prompt, /PRODUCT IDENTITY LOCK/);
  assert.match(prompt, /PLOT LOCK/);
  assert.match(prompt, /CHARACTER LOCK/);
  assert.match(prompt, /VOICE\/TONE LOCK/);
  assert.match(prompt, /MICRO-EXPRESSION LOCK/);
  assert.match(prompt, /panel swings open on side hinges/);
  assert.ok(prompt.includes(PRODUCT_MECHANICS_PRECONDITIONS.trim()));
  assert.equal(findUnsafeShutterPromptViolations(prompt).length, 0);
});

test("unsafe detector blocks hand-on-tilt-bar and related suicide shots", () => {
  const violations = findUnsafeShutterPromptViolations(
    [
      "Close-up of her hand gripping the thin vertical tilt bar",
      "she twists the louvers with her fingers",
      "extreme macro of dense louvers while fingers adjust one slat",
    ].join("\n"),
  );
  const codes = violations.map((v) => v.code);
  assert.ok(codes.includes("hand_on_tilt_bar"));
  assert.ok(codes.includes("finger_adjust_louver"));
});

test("safe rendered prompts stay dispatchable across all motions", () => {
  for (const motion of ALLOWED_SHOT_MOTIONS) {
    const prompt = renderSafeShutterPrompt({
      motion,
      productName: "white plantation shutters",
      beats: [`demonstrate ${motion} safely in medium/wide shots`],
    });
    assert.equal(
      findUnsafeShutterPromptViolations(prompt).length,
      0,
      `motion ${motion} produced unsafe prompt`,
    );
  }
});
