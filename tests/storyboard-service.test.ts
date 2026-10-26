import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { db } from "../src/lib/db";
import { parseStoryboardArtifact } from "../src/lib/video-generation/storyboard-lock";
import {
  __test__ as storyboardServiceTest,
  buildStoryboardFramePlans,
  canRegenerateStoryboardFrame,
  reconcileStoryboardRun,
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

test("storyboard regeneration fails closed unless the billing outcome is knowable", () => {
  // 任务号已知的 ACK_UNKNOWN：真实状态可查，由 reconcile 处置，禁止抢先重生成。
  assert.equal(canRegenerateStoryboardFrame({
    status: "FAILED",
    submissionState: "ACK_UNKNOWN",
    lastProviderStatus: null,
    externalTaskId: "shuyu-task-1",
  }), false);
  // 任务号未知的 ACK_UNKNOWN：无按键反查接口，显式计费的新 attempt 是唯一出路
  //（0804 真机复现的悬死根因——此前该态永久冻结，单帧拖死整个 run）。
  assert.equal(canRegenerateStoryboardFrame({
    status: "FAILED",
    submissionState: "ACK_UNKNOWN",
    lastProviderStatus: null,
    externalTaskId: null,
  }), true);
  assert.equal(canRegenerateStoryboardFrame({
    status: "FAILED",
    submissionState: "ACCEPTED",
    lastProviderStatus: "refund_error",
    externalTaskId: "shuyu-task-2",
  }), false);
  assert.equal(canRegenerateStoryboardFrame({
    status: "FAILED",
    submissionState: "ACCEPTED",
    lastProviderStatus: "failed",
    externalTaskId: "shuyu-task-3",
  }), false);
  assert.equal(canRegenerateStoryboardFrame({
    status: "FAILED",
    submissionState: "REJECTED",
    lastProviderStatus: null,
    externalTaskId: null,
  }), true);
  assert.equal(canRegenerateStoryboardFrame({
    status: "FAILED",
    submissionState: "ACCEPTED",
    lastProviderStatus: "refunded",
    externalTaskId: "shuyu-task-4",
  }), true);
  assert.equal(canRegenerateStoryboardFrame({
    status: "SUCCEEDED",
    submissionState: "ACCEPTED",
    lastProviderStatus: "success",
    externalTaskId: "shuyu-task-5",
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
    externalTaskId: null,
    submittedAt: null,
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
      // 任务号已知的 ACK_UNKNOWN 冻结（reconcile 处置）；任务号未知的可重生成。
      fakeFrame({ id: "f2", ordinal: 2, status: "FAILED", submissionState: "ACK_UNKNOWN", externalTaskId: "shuyu-task-f2" }),
      fakeFrame({ id: "f3", ordinal: 3, status: "FAILED", submissionState: "ACK_UNKNOWN", externalTaskId: null }),
    ],
  } as never);
  assert.deepEqual(
    view.frames.map((frame) => frame.canRegenerate),
    [true, true, false, true],
  );
});

test("reconcile revives an ACK_UNKNOWN frame with a known task id instead of resubmitting", async (t) => {
  const runModel = db.storyboardRun as unknown as Record<string, unknown>;
  const frameModel = db.storyboardFrame as unknown as Record<string, unknown>;
  const originals = {
    runFindFirst: runModel.findFirst,
    runUpdateMany: runModel.updateMany,
    frameFindUnique: frameModel.findUnique,
    frameUpdateMany: frameModel.updateMany,
  };
  t.after(() => {
    runModel.findFirst = originals.runFindFirst;
    runModel.updateMany = originals.runUpdateMany;
    frameModel.findUnique = originals.frameFindUnique;
    frameModel.updateMany = originals.frameUpdateMany;
  });
  const submitCalls: unknown[] = [];
  storyboardServiceTest.__setRuntimeDependenciesForTests({
    submitTask: (async (input: unknown) => {
      submitCalls.push(input);
      throw new Error("no submission may happen while reconciling ACK_UNKNOWN");
    }) as never,
  });
  t.after(() => storyboardServiceTest.__setRuntimeDependenciesForTests(null));

  const run = {
    id: "run-revive",
    userId: "owner-1",
    status: "FAILED",
    approvalPolicy: "AUTO",
    durationSec: 15,
    aspectRatio: "9:16",
    approvedAt: null,
    errorCode: "FRAME_FAILED",
    errorMessage: "stale",
    inputImageUrls: [],
    frames: [
      fakeFrame({ id: "f0", ordinal: 0, status: "SUCCEEDED", submissionState: "ACCEPTED", outputUrl: "https://assets.example.test/0.png" }),
      fakeFrame({
        id: "f1",
        ordinal: 1,
        status: "FAILED",
        submissionState: "ACK_UNKNOWN",
        externalTaskId: "shuyu-ext-1",
        errorCode: "SUBMISSION_ACK_UNKNOWN",
      }),
      fakeFrame({ id: "f2", ordinal: 2, status: "QUEUED" }),
      fakeFrame({ id: "f3", ordinal: 3, status: "QUEUED" }),
    ],
  } as Record<string, unknown>;

  const frameWrites: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const runWrites: Array<Record<string, unknown>> = [];
  runModel.findFirst = async () => ({ ...run });
  runModel.updateMany = async (args: { data: Record<string, unknown> }) => {
    runWrites.push(args.data);
    return { count: 1 };
  };
  frameModel.updateMany = async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    frameWrites.push(args);
    // 复活 CAS 放行；随后的租约领取 CAS 拒绝，让本测试停在复活边界。
    if (args.data.status === "PROCESSING" && args.data.submissionState === "ACCEPTED") {
      return { count: 1 };
    }
    return { count: 0 };
  };
  frameModel.findUnique = async () => null; // 队列帧的推进在本测试中截断

  await reconcileStoryboardRun("run-revive");

  const revive = frameWrites.find(
    (write) =>
      write.where.id === "f1" &&
      write.data.status === "PROCESSING" &&
      write.data.submissionState === "ACCEPTED",
  );
  assert.ok(revive, "the ACK_UNKNOWN frame with a task id revives into the harvest track");
  assert.equal(revive!.data.errorCode, null);
  assert.ok(
    !frameWrites.some((write) => write.where.id === "f1" && write.data.submissionState === "SUBMITTING"),
    "reviving must never resubmit the frame (billing-safe: status query only)",
  );
  assert.equal(submitCalls.length, 0, "no provider submission may occur during reconciliation");
  assert.ok(
    runWrites.some((data) => data.status === "GENERATING"),
    "the prematurely FAILED run heals so polling keeps driving it",
  );
});

test("a frame stuck in SUBMITTING beyond the window is finalized as ACK_UNKNOWN", async (t) => {
  const runModel = db.storyboardRun as unknown as Record<string, unknown>;
  const frameModel = db.storyboardFrame as unknown as Record<string, unknown>;
  const originals = {
    runFindFirst: runModel.findFirst,
    runUpdateMany: runModel.updateMany,
    frameFindUnique: frameModel.findUnique,
    frameUpdateMany: frameModel.updateMany,
  };
  t.after(() => {
    runModel.findFirst = originals.runFindFirst;
    runModel.updateMany = originals.runUpdateMany;
    frameModel.findUnique = originals.frameFindUnique;
    frameModel.updateMany = originals.frameUpdateMany;
  });

  const run = {
    id: "run-stall",
    userId: "owner-1",
    status: "GENERATING",
    approvalPolicy: "AUTO",
    durationSec: 15,
    aspectRatio: "9:16",
    approvedAt: null,
    errorCode: null,
    errorMessage: null,
    inputImageUrls: [],
    frames: [
      fakeFrame({
        id: "f0",
        ordinal: 0,
        status: "PROCESSING",
        submissionState: "SUBMITTING",
        submittedAt: new Date(Date.now() - 11 * 60_000),
      }),
      fakeFrame({
        id: "f1",
        ordinal: 1,
        status: "PROCESSING",
        submissionState: "SUBMITTING",
        submittedAt: new Date(),
      }),
      fakeFrame({ id: "f2", ordinal: 2, status: "QUEUED" }),
      fakeFrame({ id: "f3", ordinal: 3, status: "QUEUED" }),
    ],
  } as Record<string, unknown>;

  const frameWrites: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  runModel.findFirst = async () => ({ ...run });
  runModel.updateMany = async () => ({ count: 0 });
  frameModel.updateMany = async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    frameWrites.push(args);
    return { count: 1 };
  };
  frameModel.findUnique = async () => null;

  await reconcileStoryboardRun("run-stall");

  const finalized = frameWrites.filter(
    (write) => write.data.submissionState === "ACK_UNKNOWN" && write.data.status === "FAILED",
  );
  assert.equal(finalized.length, 1, "only the stalled frame is finalized");
  assert.equal(finalized[0].where.id, "f0");
  assert.equal(finalized[0].data.errorCode, "SUBMISSION_ACK_UNKNOWN");
  assert.ok(
    !frameWrites.some((write) => write.where.id === "f1" && write.data.status === "FAILED"),
    "a freshly submitting frame stays untouched",
  );
});

function submissionHarnessFrame(): Record<string, unknown> {
  return {
    id: "frame-sub",
    ordinal: 0,
    attempt: 1,
    isCurrent: true,
    beat: "beat",
    prompt: "prompt",
    status: "QUEUED",
    submissionState: "NOT_STARTED",
    providerRequestKey: "rk-sub-1",
    planId: null,
    modelSnapshot: null,
    resolutionSnapshot: null,
    pointsSnapshot: null,
    outputAsset: null,
    storyboardRun: {
      id: "run-sub",
      userId: "owner-1",
      aspectRatio: "9:16",
      inputImageUrls: [],
      frames: [],
    },
  };
}

test("a persistence blip after provider acknowledgement is retried, not declared ACK_UNKNOWN", async (t) => {
  const frameModel = db.storyboardFrame as unknown as Record<string, unknown>;
  const originals = {
    findUnique: frameModel.findUnique,
    updateMany: frameModel.updateMany,
  };
  t.after(() => Object.assign(frameModel, originals));
  storyboardServiceTest.__setRuntimeDependenciesForTests({
    submitTask: (async () => ({
      requestKey: "rk-sub-1",
      externalTaskId: "shuyu-ext-9",
      planSnapshot: { planId: "p", model: "gpt-image-2", resolution: "2K", points: 32, family: "gpt-image-2" },
    })) as never,
  });
  t.after(() => storyboardServiceTest.__setRuntimeDependenciesForTests(null));

  frameModel.findUnique = async () => submissionHarnessFrame();
  const writes: Array<{ data: Record<string, unknown> }> = [];
  let acceptAttempts = 0;
  frameModel.updateMany = async (args: { data: Record<string, unknown> }) => {
    writes.push(args);
    if (args.data.submissionState === "SUBMITTING") return { count: 1 };
    if (args.data.submissionState === "ACCEPTED") {
      acceptAttempts += 1;
      if (acceptAttempts === 1) throw new Error("transient db blip");
      return { count: 1 };
    }
    return { count: 1 };
  };

  await storyboardServiceTest.submitStoryboardFrame("frame-sub");

  assert.equal(acceptAttempts, 2, "the acknowledged task id is persisted on a second attempt");
  const accepted = writes.filter((write) => write.data.submissionState === "ACCEPTED");
  assert.ok(accepted.every((write) => write.data.externalTaskId === "shuyu-ext-9"));
  assert.ok(
    !writes.some((write) => write.data.status === "FAILED"),
    "an acknowledged submission must not be classified as failed",
  );
});

test("when persistence keeps failing after acknowledgement, the task id survives on the ACK_UNKNOWN row", async (t) => {
  const frameModel = db.storyboardFrame as unknown as Record<string, unknown>;
  const originals = {
    findUnique: frameModel.findUnique,
    updateMany: frameModel.updateMany,
  };
  t.after(() => Object.assign(frameModel, originals));
  storyboardServiceTest.__setRuntimeDependenciesForTests({
    submitTask: (async () => ({
      requestKey: "rk-sub-1",
      externalTaskId: "shuyu-ext-9",
      planSnapshot: { planId: "p", model: "gpt-image-2", resolution: "2K", points: 32, family: "gpt-image-2" },
    })) as never,
  });
  t.after(() => storyboardServiceTest.__setRuntimeDependenciesForTests(null));

  frameModel.findUnique = async () => submissionHarnessFrame();
  const failureWrites: Array<Record<string, unknown>> = [];
  frameModel.updateMany = async (args: { data: Record<string, unknown> }) => {
    if (args.data.submissionState === "SUBMITTING") return { count: 1 };
    if (args.data.submissionState === "ACCEPTED") throw new Error("db down");
    if (args.data.status === "FAILED") {
      failureWrites.push(args.data);
      return { count: 1 };
    }
    return { count: 0 };
  };

  await storyboardServiceTest.submitStoryboardFrame("frame-sub");

  assert.equal(failureWrites.length, 1);
  assert.equal(failureWrites[0].submissionState, "ACK_UNKNOWN");
  assert.equal(
    failureWrites[0].externalTaskId,
    "shuyu-ext-9",
    "a known task id is never discarded—reconcile uses it to recover the frame",
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

// ---------------------------------------------------------------------------
// P02-D(s) · 主播参考图：落 personAssetIds 列、不进 inputImageUrls、幂等键向后兼容
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import { __setMediaAssetRepositoryForTests } from "../src/lib/services/media-asset-service";
import {
  createStoryboardRun,
  requireApprovedStoryboardVideoInputsForBrief,
  StoryboardRequestError,
} from "../src/lib/video-generation/storyboard-service";

const CREATE_INPUT = {
  userId: "owner-1",
  idempotencyKey: "idem-person-1",
  prompt: "Show the shade lowering over a sunny window at breakfast time",
  durationSec: 15,
  aspectRatio: "9:16" as const,
  sourceAssetIds: ["prod-1"],
};

test("P02-D(s)：没有主播图时 requestHash 与改动前的公式一字不差；有主播图才进 hash", () => {
  const urls = ["https://assets.example.test/prod-1.jpg"];
  const legacy = createHash("sha256")
    .update(JSON.stringify({
      prompt: CREATE_INPUT.prompt.trim(),
      durationSec: CREATE_INPUT.durationSec,
      aspectRatio: CREATE_INPUT.aspectRatio,
      sourceAssetIds: ["prod-1"],
      assetUrls: urls,
      approvalPolicy: "MANUAL",
      purpose: "single-video-storyboard",
    }))
    .digest("hex");
  assert.equal(storyboardServiceTest.requestHash(CREATE_INPUT, urls), legacy);
  assert.equal(storyboardServiceTest.requestHash(CREATE_INPUT, urls, []), legacy);
  assert.equal(
    storyboardServiceTest.requestHash({ ...CREATE_INPUT, personAssetIds: [] }, urls, []),
    legacy,
  );
  const withPerson = storyboardServiceTest.requestHash(CREATE_INPUT, urls, ["p-2", "p-1"]);
  assert.notEqual(withPerson, legacy);
  // 顺序无关
  assert.equal(storyboardServiceTest.requestHash(CREATE_INPUT, urls, ["p-1", "p-2"]), withPerson);
});

function mediaRecord(id: string, mimeType = "image/jpeg") {
  return {
    id,
    userId: "owner-1",
    workspaceId: null,
    storageKey: `uploads/${id}.bin`,
    url: `https://assets.example.test/${id}.jpg`,
    mimeType,
    byteSize: 1,
    sha256: id,
    width: 1080,
    height: 1920,
  };
}

function createHarness(t: TestContext, records: ReturnType<typeof mediaRecord>[]) {
  __setMediaAssetRepositoryForTests({
    create: async () => { throw new Error("no uploads in this test"); },
    findMany: async ({ where }) =>
      records.filter((record) => where.id.in.includes(record.id) && record.userId === where.userId) as never,
  });
  t.after(() => __setMediaAssetRepositoryForTests(null));
  const runModel = db.storyboardRun as unknown as Record<string, unknown>;
  const originals = { findUnique: runModel.findUnique, create: runModel.create, findFirst: runModel.findFirst };
  t.after(() => Object.assign(runModel, originals));
  const creates: Array<Record<string, unknown>> = [];
  let created: Record<string, unknown> | null = null;
  runModel.findUnique = async () => null;
  runModel.create = async (args: { data: Record<string, unknown> }) => {
    creates.push(args.data);
    // 帧留空：不触发首帧提交（提交路径在 P02-B 单独测）。
    created = { ...args.data, frames: [], approvedAt: null, errorCode: null, errorMessage: null };
    return created;
  };
  runModel.findFirst = async () => created;
  return { creates };
}

test("P02-D(s)：主播参考图落 personAssetIds 列；inputAssetIds / inputImageUrls 只放商家实拍", async (t) => {
  const h = createHarness(t, [mediaRecord("prod-1"), mediaRecord("person-1"), mediaRecord("person-2")]);
  const view = await createStoryboardRun({ ...CREATE_INPUT, personAssetIds: ["person-1", "person-2", "person-1"] });
  assert.equal(view.status, "GENERATING");
  assert.equal(h.creates.length, 1);
  const data = h.creates[0];
  assert.deepEqual(data.personAssetIds, ["person-1", "person-2"], "去重后落列");
  assert.deepEqual(data.inputAssetIds, ["prod-1"]);
  assert.deepEqual(data.inputImageUrls, ["https://assets.example.test/prod-1.jpg"], "主播图 URL 不混进实拍列");
});

test("P02-D(s)：主播参考图校验——同图不能兼任商品图、最多 4 张、必须是图片、必须归本人", async (t) => {
  createHarness(t, [mediaRecord("prod-1"), mediaRecord("person-1"), mediaRecord("clip-1", "video/mp4")]);
  const rejects = async (personAssetIds: string[], code: string, status = 400) => {
    await assert.rejects(
      createStoryboardRun({ ...CREATE_INPUT, personAssetIds }),
      (error: unknown) =>
        error instanceof StoryboardRequestError && error.code === code && error.status === status,
      `expected ${code} for ${JSON.stringify(personAssetIds)}`,
    );
  };
  await rejects(["prod-1"], "VALIDATION_FAILED");
  await rejects(["a", "b", "c", "d", "e"], "VALIDATION_FAILED");
  await rejects(["clip-1"], "VALIDATION_FAILED");
  await rejects(["someone-elses"], "NOT_FOUND", 404);
});

test("P02-D(s)：派发取参考图时主播图不算实拍——productPhotoCount 只数 inputImageUrls", async (t) => {
  const runModel = db.storyboardRun as unknown as Record<string, unknown>;
  const original = runModel.findUnique;
  t.after(() => { runModel.findUnique = original; });
  const frameUrls = [0, 1, 2, 3].map((i) => `https://assets.example.test/frame-${i}.png`);
  runModel.findUnique = async () => ({
    id: "run-approved",
    userId: "owner-1",
    status: "APPROVED",
    durationSec: 15,
    aspectRatio: "9:16",
    sourcePrompt: "story",
    inputAssetIds: ["prod-1", "prod-2"],
    inputImageUrls: ["https://assets.example.test/prod-1.jpg", "https://assets.example.test/prod-2.jpg"],
    personAssetIds: ["person-1"],
    anchorCutoutUrls: [],
    frames: frameUrls.map((url, ordinal) => fakeFrame({
      id: `f${ordinal}`,
      ordinal,
      status: "SUCCEEDED",
      outputUrl: url,
      outputAsset: { userId: "owner-1", url },
    })),
  });
  const inputs = await requireApprovedStoryboardVideoInputsForBrief("brief-1");
  assert.equal(inputs.productPhotoCount, 2);
  assert.deepEqual(inputs.references, [
    "https://assets.example.test/prod-1.jpg",
    "https://assets.example.test/prod-2.jpg",
    ...frameUrls,
  ]);
  assert.ok(inputs.references.every((url) => !/person/.test(url)));
});

// ---------------------------------------------------------------------------
// P02-B · 故事板入参纯函数：每帧 ≤5、实拍保底 3、主播图只进首帧、前帧只留 1 张放最后，
// REFERENCE ROLES 序号与真正提交的图片出自同一个函数
// ---------------------------------------------------------------------------
import {
  applyStoryboardReferenceRoles,
  composeStoryboardFrameInputImages,
  STORYBOARD_PRESENTER_LOCK,
  storyboardReferenceRolesLine,
} from "../src/lib/video-generation/storyboard-frame-inputs";

const PRODUCTS = [1, 2, 3, 4, 5].map((i) => `https://assets.example.test/prod-${i}.jpg`);
const FRAMES = [0, 1, 2, 3].map((i) => `https://assets.example.test/frame-${i}.png`);
const PRESENTER = "https://assets.example.test/presenter.jpg";

test("P02-B：每帧入参 ≤5；商家 5 张实拍时第 2 帧起仍有 ≥3 张实拍，前帧只留 1 张且在最后", () => {
  for (const priorCount of [0, 1, 2, 3]) {
    const composed = composeStoryboardFrameInputImages({
      productImages: PRODUCTS,
      anchorCutouts: [],
      personImages: [PRESENTER],
      priorFrames: FRAMES.slice(0, priorCount),
    });
    assert.ok(composed.length <= 5, `frame with ${priorCount} priors has ${composed.length} inputs`);
    const products = composed.filter((image) => image.role === "product");
    assert.ok(products.length >= 3, `frame with ${priorCount} priors keeps ${products.length} product photos`);
    assert.deepEqual(composed.slice(0, products.length).map((image) => image.role), products.map(() => "product"), "实拍排最前");
    const priors = composed.filter((image) => image.role === "prior_frame");
    if (priorCount === 0) {
      assert.equal(priors.length, 0);
    } else {
      assert.equal(priors.length, 1, "只留 1 张前帧");
      assert.equal(composed[composed.length - 1].url, FRAMES[priorCount - 1], "最近一张前帧放最后");
    }
  }
});

test("P02-B：主播参考图只进首帧且最多 1 张；有前帧的帧不带主播图", () => {
  const first = composeStoryboardFrameInputImages({
    productImages: PRODUCTS.slice(0, 2),
    personImages: [PRESENTER, "https://assets.example.test/presenter-2.jpg"],
    priorFrames: [],
  });
  assert.deepEqual(first.map((image) => image.role), ["product", "product", "person"]);
  assert.equal(first[2].url, PRESENTER);

  const second = composeStoryboardFrameInputImages({
    productImages: PRODUCTS.slice(0, 2),
    personImages: [PRESENTER],
    priorFrames: [FRAMES[0]],
  });
  assert.deepEqual(second.map((image) => image.role), ["product", "product", "prior_frame"]);

  // 5 张实拍 + 主播图：首帧 = 3 张保底 + 主播 + 1 张补位实拍，总数 5
  const crowded = composeStoryboardFrameInputImages({ productImages: PRODUCTS, personImages: [PRESENTER], priorFrames: [] });
  assert.equal(crowded.length, 5);
  assert.deepEqual(crowded.map((image) => image.role), ["product", "product", "product", "product", "person"]);
});

test("P02-B：切片接口就位（排在实拍之后、主播之前）；去重与 max 生效；纯文字起稿为空", () => {
  const cutout = "https://assets.example.test/cutout.png";
  const withCutout = composeStoryboardFrameInputImages({
    productImages: [PRODUCTS[0], PRODUCTS[0]],
    anchorCutouts: [cutout, PRODUCTS[0]],
    personImages: [PRESENTER],
    priorFrames: [],
  });
  assert.deepEqual(withCutout.map((image) => image.role), ["product", "anchor_cutout", "person"]);
  const capped = composeStoryboardFrameInputImages({ productImages: PRODUCTS, priorFrames: [FRAMES[0]], max: 4 });
  assert.deepEqual(capped.map((image) => image.url), [PRODUCTS[0], PRODUCTS[1], PRODUCTS[2], FRAMES[0]]);
  // 上限只够 3 张时实拍保底优先于前帧（产品身份 > 连续性）
  const tight = composeStoryboardFrameInputImages({ productImages: PRODUCTS, priorFrames: [FRAMES[0]], max: 3 });
  assert.deepEqual(tight.map((image) => image.url), [PRODUCTS[0], PRODUCTS[1], PRODUCTS[2]]);
  assert.deepEqual(composeStoryboardFrameInputImages({ productImages: [], priorFrames: [] }), []);
  assert.equal(storyboardReferenceRolesLine([]), null);
});

test("P02-B：REFERENCE ROLES 序号与入参顺序一致；applyStoryboardReferenceRoles 幂等、插在 PRODUCT IDENTITY LOCK 之前", () => {
  const composed = composeStoryboardFrameInputImages({
    productImages: PRODUCTS.slice(0, 2),
    personImages: [PRESENTER],
    priorFrames: [],
  });
  const line = storyboardReferenceRolesLine(composed)!;
  assert.match(line, /^REFERENCE ROLES: image 1 = real photo of the merchant's product[^;]*; image 2 = real photo[^;]*; image 3 = presenter reference photo[^.]*\.$/);

  const base = ["THIS FRAME 1/4: hook.", "SINGLE SHOT LOCK: one shot.", "PRODUCT IDENTITY LOCK: keep it.", "CONTINUITY LOCK: keep it."].join("\n");
  const once = applyStoryboardReferenceRoles(base, composed);
  const lines = once.split("\n");
  assert.equal(lines[2], line);
  assert.equal(lines[3], STORYBOARD_PRESENTER_LOCK);
  assert.equal(lines[4], "PRODUCT IDENTITY LOCK: keep it.");
  assert.equal(applyStoryboardReferenceRoles(once, composed), once, "同一布局二次应用不变");

  // 布局变了（第 2 帧：没有主播、多了前帧）→ 只替换这两行，其余原样
  const next = applyStoryboardReferenceRoles(
    once,
    composeStoryboardFrameInputImages({ productImages: PRODUCTS.slice(0, 2), personImages: [PRESENTER], priorFrames: [FRAMES[0]] }),
  );
  assert.doesNotMatch(next, /PRESENTER LOCK/);
  assert.match(next, /^REFERENCE ROLES: image 1 = [^;]*; image 2 = [^;]*; image 3 = previous approved storyboard keyframe/m);
  assert.equal(next.split("\n").filter((l) => l.startsWith("REFERENCE ROLES:")).length, 1);
});

test("P02-B：buildStoryboardFramePlans 每帧带 REFERENCE ROLES，首帧有主播图时带 PRESENTER LOCK；纯文字起稿不写", () => {
  const plans = buildStoryboardFramePlans({
    prompt: "Show the shade lowering over a sunny window",
    durationSec: 15,
    aspectRatio: "9:16",
    productImageCount: 2,
    personImageCount: 1,
  });
  assert.match(plans[0].prompt, /^REFERENCE ROLES: image 1 = real photo[^;]*; image 2 = real photo[^;]*; image 3 = presenter reference photo/m);
  assert.ok(plans[0].prompt.includes(STORYBOARD_PRESENTER_LOCK));
  for (const plan of plans.slice(1)) {
    assert.match(plan.prompt, /^REFERENCE ROLES: image 1 = real photo[^;]*; image 2 = real photo[^;]*; image 3 = previous approved storyboard keyframe/m);
    assert.doesNotMatch(plan.prompt, /PRESENTER LOCK/);
  }
  // 行序：REFERENCE ROLES 紧贴在 PRODUCT IDENTITY LOCK 之前；开头三行不变
  const lines = plans[0].prompt.split("\n");
  assert.match(lines[0], /single continuous camera shot/);
  assert.match(lines[1], /^THIS FRAME 1\/4: /);
  assert.match(lines[2], /^STORY CONTEXT \(continuity only/);
  const rolesAt = lines.findIndex((l) => l.startsWith("REFERENCE ROLES:"));
  assert.ok(lines[rolesAt + 1] === STORYBOARD_PRESENTER_LOCK && lines[rolesAt + 2].startsWith("PRODUCT IDENTITY LOCK:"));

  // 纯文字起稿：首帧没有任何参考图 → 不写 REFERENCE ROLES；后续帧只有前帧一张 → 只标前帧
  const textOnly = buildStoryboardFramePlans({ prompt: "story", durationSec: 15, aspectRatio: "9:16" });
  assert.doesNotMatch(textOnly[0].prompt, /REFERENCE ROLES|PRESENTER LOCK/);
  for (const plan of textOnly.slice(1)) {
    assert.match(plan.prompt, /^REFERENCE ROLES: image 1 = previous approved storyboard keyframe[^.]*\.$/m);
    assert.doesNotMatch(plan.prompt, /PRESENTER LOCK/);
  }
});

function inputsHarness(
  t: TestContext,
  frame: Record<string, unknown>,
  personAssets: Array<{ id: string; url: string }> | null,
) {
  const frameModel = db.storyboardFrame as unknown as Record<string, unknown>;
  const assetModel = db.mediaAsset as unknown as Record<string, unknown>;
  const originals = { findUnique: frameModel.findUnique, updateMany: frameModel.updateMany, assetFindMany: assetModel.findMany };
  t.after(() => {
    frameModel.findUnique = originals.findUnique;
    frameModel.updateMany = originals.updateMany;
    assetModel.findMany = originals.assetFindMany;
  });
  const submitted: Array<Record<string, unknown>> = [];
  storyboardServiceTest.__setRuntimeDependenciesForTests({
    submitTask: (async (input: Record<string, unknown>) => {
      submitted.push(input);
      return {
        requestKey: input.requestKey,
        externalTaskId: "shuyu-ext-inputs",
        planSnapshot: { planId: "p", model: "gpt-image-2", resolution: "2K", points: 32, family: "gpt-image-2" },
      };
    }) as never,
  });
  t.after(() => storyboardServiceTest.__setRuntimeDependenciesForTests(null));
  frameModel.findUnique = async () => frame;
  const writes: Array<{ data: Record<string, unknown> }> = [];
  frameModel.updateMany = async (args: { data: Record<string, unknown> }) => {
    writes.push(args);
    return { count: 1 };
  };
  let assetQueries = 0;
  assetModel.findMany = async () => {
    assetQueries += 1;
    if (!personAssets) throw new Error("person assets must not be queried for this frame");
    return personAssets;
  };
  return { submitted, writes, assetQueries: () => assetQueries };
}

test("P02-B：首帧提交 = 实拍 + 主播图（按 personAssetIds 列解析），提示词的 REFERENCE ROLES 与之对齐、无需回写", async (t) => {
  const [plan] = buildStoryboardFramePlans({
    prompt: "story", durationSec: 15, aspectRatio: "9:16", productImageCount: 2, personImageCount: 1,
  });
  const h = inputsHarness(t, {
    ...submissionHarnessFrame(),
    prompt: plan.prompt,
    storyboardRun: {
      id: "run-sub", userId: "owner-1", aspectRatio: "9:16",
      inputImageUrls: PRODUCTS.slice(0, 2), personAssetIds: ["person-1"], anchorCutoutUrls: [], frames: [],
    },
  }, [{ id: "person-1", url: PRESENTER }]);

  await storyboardServiceTest.submitStoryboardFrame("frame-sub");

  assert.equal(h.submitted.length, 1);
  assert.deepEqual(h.submitted[0].inputImages, [PRODUCTS[0], PRODUCTS[1], PRESENTER]);
  assert.equal(h.submitted[0].prompt, plan.prompt, "预演布局与真实布局一致 → 提示词原样");
  assert.ok(!h.writes.some((write) => "prompt" in write.data), "布局一致时不回写提示词");
  assert.equal(h.assetQueries(), 1);
});

test("P02-B：第 3 帧提交 = 实拍 + 最近 1 张前帧放最后；不带主播图、不查主播素材", async (t) => {
  const plans = buildStoryboardFramePlans({
    prompt: "story", durationSec: 15, aspectRatio: "9:16", productImageCount: 5, personImageCount: 1,
  });
  const h = inputsHarness(t, {
    ...submissionHarnessFrame(),
    ordinal: 2,
    prompt: plans[2].prompt,
    storyboardRun: {
      id: "run-sub", userId: "owner-1", aspectRatio: "9:16",
      inputImageUrls: PRODUCTS, personAssetIds: ["person-1"], anchorCutoutUrls: [],
      frames: [
        fakeFrame({ id: "f0", ordinal: 0, status: "SUCCEEDED", outputUrl: FRAMES[0] }),
        fakeFrame({ id: "f1", ordinal: 1, status: "SUCCEEDED", outputUrl: FRAMES[1] }),
      ],
    },
  }, null);

  await storyboardServiceTest.submitStoryboardFrame("frame-sub");

  assert.deepEqual(h.submitted[0].inputImages, [PRODUCTS[0], PRODUCTS[1], PRODUCTS[2], PRODUCTS[3], FRAMES[1]]);
  assert.equal(h.submitted[0].prompt, plans[2].prompt);
  assert.equal(h.assetQueries(), 0);
});

test("P02-B：前帧全部失败时按真实入参重算 REFERENCE ROLES（当作首帧：带主播图）并回写提示词；重试快照补 inputImagesMax=5", async (t) => {
  const plans = buildStoryboardFramePlans({
    prompt: "story", durationSec: 15, aspectRatio: "9:16", productImageCount: 1, personImageCount: 1,
  });
  const h = inputsHarness(t, {
    ...submissionHarnessFrame(),
    ordinal: 1,
    prompt: plans[1].prompt,
    planId: "plan-2k", modelSnapshot: "gpt-image-2", resolutionSnapshot: "2K", pointsSnapshot: 48,
    storyboardRun: {
      id: "run-sub", userId: "owner-1", aspectRatio: "9:16",
      inputImageUrls: [PRODUCTS[0]], personAssetIds: ["person-1"], anchorCutoutUrls: [],
      frames: [fakeFrame({ id: "f0", ordinal: 0, status: "FAILED", outputUrl: null })],
    },
  }, [{ id: "person-1", url: PRESENTER }]);

  await storyboardServiceTest.submitStoryboardFrame("frame-sub");

  const sent = h.submitted[0];
  assert.deepEqual(sent.inputImages, [PRODUCTS[0], PRESENTER]);
  assert.match(sent.prompt as string, /^REFERENCE ROLES: image 1 = real photo[^;]*; image 2 = presenter reference photo/m);
  assert.ok((sent.prompt as string).includes(STORYBOARD_PRESENTER_LOCK));
  assert.notEqual(sent.prompt, plans[1].prompt);
  const promptWrite = h.writes.find((write) => "prompt" in write.data);
  assert.ok(promptWrite, "真实布局与预演不同时回写提示词");
  assert.equal(promptWrite!.data.prompt, sent.prompt);
  assert.deepEqual(sent.planSnapshot, {
    planId: "plan-2k", model: "gpt-image-2", resolution: "2K", points: 48, family: "gpt-image-2", inputImagesMax: 5,
  });
});
