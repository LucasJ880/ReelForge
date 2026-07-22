import assert from "node:assert/strict";
import test from "node:test";

import { parseStoryboardArtifact } from "../src/lib/video-generation/storyboard-lock";
import {
  buildStoryboardFramePlans,
  canRegenerateStoryboardFrame,
  storyboardFrameCountForDuration,
  storyboardRunView,
} from "../src/lib/video-generation/storyboard-service";

test("a 15 second video plans four ordered Shuyu Image 2 frames", () => {
  assert.equal(storyboardFrameCountForDuration(15), 4);
  const plans = buildStoryboardFramePlans({
    prompt: "Show how the real product solves the customer's problem",
    durationSec: 15,
    aspectRatio: "9:16",
  });
  assert.equal(plans.length, 4);
  assert.deepEqual(plans.map((frame) => frame.ordinal), [0, 1, 2, 3]);
  assert.ok(plans.every((frame) => /PRODUCT IDENTITY LOCK/.test(frame.prompt)));
});

test("storyboard regeneration fails closed unless creation was rejected or refunded", () => {
  assert.equal(canRegenerateStoryboardFrame({
    status: "FAILED",
    submissionState: "ACK_UNKNOWN",
    lastProviderStatus: null,
  }), false);
  assert.equal(canRegenerateStoryboardFrame({
    status: "FAILED",
    submissionState: "ACCEPTED",
    lastProviderStatus: "refund_error",
  }), false);
  assert.equal(canRegenerateStoryboardFrame({
    status: "FAILED",
    submissionState: "ACCEPTED",
    lastProviderStatus: "failed",
  }), false);
  assert.equal(canRegenerateStoryboardFrame({
    status: "FAILED",
    submissionState: "REJECTED",
    lastProviderStatus: null,
  }), true);
  assert.equal(canRegenerateStoryboardFrame({
    status: "FAILED",
    submissionState: "ACCEPTED",
    lastProviderStatus: "refunded",
  }), true);
  assert.equal(canRegenerateStoryboardFrame({
    status: "SUCCEEDED",
    submissionState: "ACCEPTED",
    lastProviderStatus: "success",
  }), true);
});

test("canonical parser accepts a Shuyu Image 2 storyboard", () => {
  const parsed = parseStoryboardArtifact({
    source: "shuyu_image2",
    model: "gpt-image-2",
    purpose: "single-video-storyboard",
    frames: Array.from({ length: 4 }, (_, order) => ({
      id: `frame-${order}`,
      order,
      imageUrl: `https://assets.example.test/frame-${order}.png`,
    })),
  });
  assert.equal(parsed.source, "shuyu_image2");
  assert.equal(parsed.frames.length, 4);
});

test("manual storyboard waits for approval while auto policy approves", () => {
  const frames = Array.from({ length: 4 }, (_, ordinal) => ({
    id: `frame-${ordinal}`,
    ordinal,
    attempt: 1,
    isCurrent: true,
    beat: `beat-${ordinal}`,
    prompt: `prompt-${ordinal}`,
    status: "SUCCEEDED",
    outputUrl: `https://assets.example.test/${ordinal}.png`,
    errorCode: null,
    errorMessage: null,
  }));
  const manual = storyboardRunView({
    id: "manual-run",
    userId: "owner-1",
    approvalPolicy: "MANUAL",
    status: "AWAITING_APPROVAL",
    durationSec: 15,
    aspectRatio: "9:16",
    approvedAt: null,
    errorCode: null,
    errorMessage: null,
    frames,
  } as never);
  const automatic = storyboardRunView({
    ...manual,
    id: "auto-run",
    approvalPolicy: "AUTO",
    status: "APPROVED",
    approvedAt: new Date(),
    frames,
  } as never);
  assert.equal(manual.status, "AWAITING_APPROVAL");
  assert.equal(manual.canApprove, true);
  assert.equal(automatic.status, "APPROVED");
  assert.equal(automatic.canApprove, false);
});
