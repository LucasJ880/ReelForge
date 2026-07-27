import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERIC_SHOT_MOTIONS,
  renderSafeCommercePrompt,
} from "../src/lib/video-generation/generic-shot-policy";
import {
  renderSafeShutterPrompt,
  renderSafeShutterPromptAdapter,
} from "../src/lib/video-generation/shutter-shot-policy";

test("generic shot policy exposes only product-agnostic motions", () => {
  assert.deepEqual(GENERIC_SHOT_MOTIONS, [
    "static_product",
    "reveal_transition",
    "operate_demo",
    "presenter_point",
  ]);
});

test("generic policy rejects mechanics not supported by the product profile", () => {
  assert.throws(
    () =>
      renderSafeCommercePrompt({
        motion: "operate_demo",
        productName: "travel organizer",
        productProfile: {
          productType: "soft-goods organizer",
          identityLocks: ["Preserve the exact pocket count and zipper layout."],
          demonstrableActions: [],
          revealTransitions: ["closed-to-open cut"],
        },
        operation: "rotate a hidden motor control",
        beats: ["Show the motorized operation."],
      }),
    /demonstrable action/i,
  );
});

test("generic policy produces a bounded product-truth prompt", () => {
  const prompt = renderSafeCommercePrompt({
    motion: "operate_demo",
    productName: "TrailPack organizer",
    productProfile: {
      productType: "soft-goods organizer",
      identityLocks: [
        "Preserve the exact pocket count, zipper layout, color, and proportions.",
      ],
      demonstrableActions: ["open the main zipper", "place one shirt inside"],
      revealTransitions: ["closed-to-open match cut"],
    },
    operation: "open the main zipper",
    beats: ["0-3s: show the closed organizer.", "3-8s: open the main zipper."],
  });
  assert.match(prompt, /PRODUCT TRUTH LOCK/);
  assert.match(prompt, /open the main zipper/);
  assert.match(prompt, /no on-screen text/i);
  assert.ok(prompt.length < 5_000);
});

test("SunnyShutter adapter preserves the legacy prompt exactly", () => {
  const fixture = {
    motion: "panel_hinge_open" as const,
    productName: "custom plantation shutters",
    beats: [
      "0-5s: wide room hold on the shutter wall",
      "5-12s: one panel swings open on side hinges",
    ],
  };
  assert.equal(
    renderSafeShutterPromptAdapter(fixture),
    renderSafeShutterPrompt(fixture),
  );
});
