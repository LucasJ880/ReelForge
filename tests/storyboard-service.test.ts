import assert from "node:assert/strict";
import test from "node:test";

import { db } from "../src/lib/db";
import { parseStoryboardArtifact } from "../src/lib/video-generation/storyboard-lock";
import {
  __test__ as storyboardServiceTest,
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

test("short batch clips still receive four continuity-lock frames", () => {
  assert.equal(storyboardFrameCountForDuration(5), 4);
  assert.equal(storyboardFrameCountForDuration(10), 4);
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

function fakeFrame(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "frame-x",
    ordinal: 0,
    attempt: 1,
    isCurrent: true,
    beat: "beat",
    prompt: "prompt",
    status: "QUEUED",
    submissionState: "NOT_STARTED",
    lastProviderStatus: null,
    outputUrl: null,
    outputAsset: null,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

test("a failed frame does not settle the run while siblings are still in flight", async (t) => {
  const runModel = db.storyboardRun as unknown as Record<string, unknown>;
  const frameModel = db.storyboardFrame as unknown as Record<string, unknown>;
  const originals = {
    runFindFirst: runModel.findFirst,
    runUpdateMany: runModel.updateMany,
    frameFindUnique: frameModel.findUnique,
  };
  t.after(() => {
    runModel.findFirst = originals.runFindFirst;
    runModel.updateMany = originals.runUpdateMany;
    frameModel.findUnique = originals.frameFindUnique;
  });

  const run = {
    id: "run-partial",
    userId: "owner-1",
    status: "FAILED", // legacy rows written by the old fail-fast semantics
    approvalPolicy: "MANUAL",
    durationSec: 15,
    aspectRatio: "9:16",
    approvedAt: null,
    errorCode: "SUBMISSION_ACK_UNKNOWN",
    errorMessage: "stale",
    inputImageUrls: [],
    frames: [
      fakeFrame({ id: "f0", ordinal: 0, status: "PROCESSING", submissionState: "ACCEPTED", externalTaskId: "ext-0" }),
      fakeFrame({ id: "f1", ordinal: 1, status: "PROCESSING", submissionState: "ACCEPTED", externalTaskId: "ext-1" }),
      fakeFrame({ id: "f2", ordinal: 2, status: "FAILED", submissionState: "ACK_UNKNOWN", errorCode: "SUBMISSION_ACK_UNKNOWN" }),
      fakeFrame({ id: "f3", ordinal: 3, status: "QUEUED" }),
    ],
  } as Record<string, unknown>;

  const runUpdates: Array<Record<string, unknown>> = [];
  runModel.findFirst = async () => ({ ...run });
  runModel.updateMany = async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    runUpdates.push(args.data);
    if (
      (run.status as string) === "FAILED" &&
      (args.where.status as Record<string, unknown> | string) &&
      args.data.status === "GENERATING"
    ) {
      run.status = "GENERATING";
      return { count: 1 };
    }
    return { count: 0 };
  };
  let submitAttempted: string | null = null;
  frameModel.findUnique = async (args: { where: { id: string } }) => {
    submitAttempted = args.where.id;
    return null; // stop submitStoryboardFrame before any provider work
  };

  await storyboardServiceTest.advanceRun("run-partial");

  assert.ok(
    runUpdates.some((data) => data.status === "GENERATING"),
    "an unsettled run heals back to GENERATING so polling keeps driving it",
  );
  assert.ok(
    !runUpdates.some((data) => data.status === "FAILED"),
    "the run must not settle FAILED while frames are queued or processing",
  );
  assert.equal(submitAttempted, "f3", "the remaining queued frame keeps advancing");
});

test("the run settles FAILED only after every frame reaches a terminal state", async (t) => {
  const runModel = db.storyboardRun as unknown as Record<string, unknown>;
  const originals = { findFirst: runModel.findFirst, updateMany: runModel.updateMany };
  t.after(() => Object.assign(runModel, originals));

  const run = {
    id: "run-settled",
    userId: "owner-1",
    status: "GENERATING",
    approvalPolicy: "MANUAL",
    durationSec: 15,
    aspectRatio: "9:16",
    approvedAt: null,
    errorCode: null,
    errorMessage: null,
    inputImageUrls: [],
    frames: [
      fakeFrame({ id: "f0", ordinal: 0, status: "SUCCEEDED", submissionState: "ACCEPTED", outputUrl: "https://assets.example.test/0.png" }),
      fakeFrame({ id: "f1", ordinal: 1, status: "SUCCEEDED", submissionState: "ACCEPTED", outputUrl: "https://assets.example.test/1.png" }),
      fakeFrame({ id: "f2", ordinal: 2, status: "FAILED", submissionState: "ACK_UNKNOWN", errorCode: "SUBMISSION_ACK_UNKNOWN" }),
      fakeFrame({ id: "f3", ordinal: 3, status: "SUCCEEDED", submissionState: "ACCEPTED", outputUrl: "https://assets.example.test/3.png" }),
    ],
  } as Record<string, unknown>;

  const runUpdates: Array<Record<string, unknown>> = [];
  runModel.findFirst = async () => ({ ...run });
  runModel.updateMany = async (args: { data: Record<string, unknown> }) => {
    runUpdates.push(args.data);
    if (args.data.status === "FAILED") run.status = "FAILED";
    return { count: 1 };
  };

  await storyboardServiceTest.advanceRun("run-settled");

  assert.ok(
    runUpdates.some((data) => data.status === "FAILED" && data.errorCode === "FRAME_FAILED"),
    "a fully terminal run with a failed frame settles FAILED",
  );
});

test("the run view exposes billing-safe per-frame regeneration flags", () => {
  const view = storyboardRunView({
    id: "run-flags",
    userId: "owner-1",
    approvalPolicy: "MANUAL",
    status: "FAILED",
    durationSec: 15,
    aspectRatio: "9:16",
    approvedAt: null,
    errorCode: "FRAME_FAILED",
    errorMessage: "部分分镜需要处理",
    frames: [
      fakeFrame({ id: "f0", ordinal: 0, status: "SUCCEEDED", submissionState: "ACCEPTED", lastProviderStatus: "completed" }),
      fakeFrame({ id: "f1", ordinal: 1, status: "FAILED", submissionState: "REJECTED" }),
      fakeFrame({ id: "f2", ordinal: 2, status: "FAILED", submissionState: "ACK_UNKNOWN" }),
      fakeFrame({ id: "f3", ordinal: 3, status: "FAILED", submissionState: "ACCEPTED", lastProviderStatus: "refunded" }),
    ],
  } as never);
  assert.deepEqual(
    view.frames.map((frame) => frame.canRegenerate),
    [true, true, false, true],
  );
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
