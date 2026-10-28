import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../src/lib/db";
import { __test__ as storyboardServiceTest } from "../src/lib/video-generation/storyboard-service";
import { RUNWAY_STORYBOARD_PLAN_ID } from "../src/lib/video-generation/runway-storyboard-images";
import { runwayImageRatio } from "../src/lib/providers/runway";

/**
 * 故事板分镜出图走 Runway（2026-10-28 晚，灰度名单先用）：提交前记 planId，之后轮询 / 取图 / 失败文案都按它分流；
 * 记过 Shuyu 套餐的帧永远走 Shuyu。数据库与供应商都用替身——真机验收要部署后用灰度账号跑。
 */

type Writes = Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;

function stubFrameModel(t: TestContext) {
  const model = db.storyboardFrame as unknown as Record<string, unknown>;
  const dbAny = db as unknown as Record<string, unknown>;
  const originals = {
    findUnique: model.findUnique,
    findFirst: model.findFirst,
    updateMany: model.updateMany,
    transaction: dbAny.$transaction,
  };
  t.after(() => {
    model.findUnique = originals.findUnique;
    model.findFirst = originals.findFirst;
    model.updateMany = originals.updateMany;
    dbAny.$transaction = originals.transaction;
    storyboardServiceTest.__setRuntimeDependenciesForTests(null);
  });
  return { model, dbAny };
}

function queuedFrame(overrides: Record<string, unknown> = {}) {
  return {
    id: "frame-1",
    ordinal: 1,
    attempt: 1,
    isCurrent: true,
    status: "QUEUED",
    submissionState: "NOT_STARTED",
    providerRequestKey: "req-key-1",
    prompt: "Create ONE photorealistic commercial storyboard keyframe.",
    inputImageUrls: ["https://blob.example/product.png"],
    planId: null,
    modelSnapshot: null,
    resolutionSnapshot: null,
    pointsSnapshot: null,
    externalTaskId: null,
    outputAsset: null,
    storyboardRunId: "run-1",
    storyboardRun: {
      id: "run-1",
      userId: "owner-1",
      status: "GENERATING",
      aspectRatio: "9:16",
      inputImageUrls: ["https://blob.example/product.png"],
      frames: [],
    },
    ...overrides,
  };
}

test("画幅：GPT Image 2 竖屏用 1088:1920（SDK 没有 1080:1920）", () => {
  assert.equal(runwayImageRatio("9:16"), "1088:1920");
  assert.equal(runwayImageRatio("16:9"), "1920:1088");
  assert.equal(runwayImageRatio("1:1"), "1920:1920");
  assert.equal(runwayImageRatio("4:5"), null);
});

test("灰度账号的新分镜：先记 Runway 再提交，任务号落库；Shuyu 一次都不调", async (t) => {
  const { model } = stubFrameModel(t);
  const writes: Writes = [];
  model.findUnique = async () => queuedFrame();
  model.updateMany = async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    writes.push(args);
    return { count: 1 };
  };
  const runwayCalls: unknown[] = [];
  storyboardServiceTest.__setRuntimeDependenciesForTests({
    runwayForOwner: async (userId: string) => userId === "owner-1",
    runwaySubmitImage: (async (input: unknown) => {
      runwayCalls.push(input);
      return { externalTaskId: "rw-task-1", estimatedCredits: 5 };
    }) as never,
    submitTask: (async () => {
      throw new Error("Shuyu must not be called for a Runway frame");
    }) as never,
  });

  await storyboardServiceTest.submitStoryboardFrame("frame-1");

  assert.equal(runwayCalls.length, 1);
  assert.deepEqual(runwayCalls[0], {
    prompt: "Create ONE photorealistic commercial storyboard keyframe.",
    aspectRatio: "9:16",
    inputImages: ["https://blob.example/product.png"],
  });
  const marked = writes.find((write) => write.data.planId === RUNWAY_STORYBOARD_PLAN_ID);
  assert.ok(marked, "planId 先记成 Runway");
  const accepted = writes.find((write) => write.data.externalTaskId === "rw-task-1");
  assert.ok(accepted);
  assert.equal(accepted.data.submissionState, "ACCEPTED");
  assert.ok(writes.indexOf(marked) < writes.indexOf(accepted), "记供应商发生在提交之前");
});

test("记过 Shuyu 套餐的帧（重试 / 恢复）永远走 Shuyu，不看灰度", async (t) => {
  const { model } = stubFrameModel(t);
  model.findUnique = async () => queuedFrame({
    planId: "shuyu-plan-1",
    modelSnapshot: "gpt-image-2",
    resolutionSnapshot: "2K",
    pointsSnapshot: 40,
  });
  model.updateMany = async () => ({ count: 1 });
  let ownerChecked = false;
  let shuyuCalled = false;
  storyboardServiceTest.__setRuntimeDependenciesForTests({
    runwayForOwner: async () => {
      ownerChecked = true;
      return true;
    },
    runwaySubmitImage: (async () => {
      throw new Error("Runway must not be called for a Shuyu frame");
    }) as never,
    submitTask: (async () => {
      shuyuCalled = true;
      return { externalTaskId: "shuyu-task-1" };
    }) as never,
  });

  await storyboardServiceTest.submitStoryboardFrame("frame-1");
  assert.equal(shuyuCalled, true);
  assert.equal(ownerChecked, false);
});

test("Runway 明确拒绝（4xx）：这一帧失败、写清原因、可重画，不走「退款待核对」那套话", async (t) => {
  const { model } = stubFrameModel(t);
  const writes: Writes = [];
  model.findUnique = async () => queuedFrame();
  model.updateMany = async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    writes.push(args);
    return { count: 1 };
  };
  const { runwaySubmissionError } = await import("../src/lib/video-generation/providers/runway-video-provider");
  const { RunwayApiError } = await import("../src/lib/providers/runway");
  storyboardServiceTest.__setRuntimeDependenciesForTests({
    runwayForOwner: async () => true,
    runwaySubmitImage: (async () => {
      throw runwaySubmissionError(new RunwayApiError("Runway 400：Invalid reference image", 400, false));
    }) as never,
  });

  await storyboardServiceTest.submitStoryboardFrame("frame-1");
  const failed = writes.find((write) => write.data.status === "FAILED");
  assert.ok(failed);
  assert.equal(failed.data.submissionState, "REJECTED");
  assert.match(String(failed.data.errorMessage), /^Runway 拒绝了该分镜任务（.*Invalid reference image.*），可重新生成这一帧。$/);
});

function processingRunwayFrame() {
  return {
    ...queuedFrame({
      status: "PROCESSING",
      submissionState: "ACCEPTED",
      externalTaskId: "rw-task-1",
      planId: RUNWAY_STORYBOARD_PLAN_ID,
      modelSnapshot: "gpt_image_2",
      resolutionSnapshot: "2K",
      pointsSnapshot: 0,
    }),
  };
}

test("Runway 帧轮询成功：按 Runway 取图、转存进自己的存储，成帧", async (t) => {
  const { model, dbAny } = stubFrameModel(t);
  const writes: Writes = [];
  model.updateMany = async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    writes.push(args);
    return { count: 1 };
  };
  model.findFirst = async () => processingRunwayFrame();
  dbAny.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn({ storyboardFrame: { updateMany: model.updateMany } });
  const uploads: Array<{ key: string; contentType: string }> = [];
  storyboardServiceTest.__setRuntimeDependenciesForTests({
    runwayPollImage: (async () => ({ status: "succeeded", rawStatus: "SUCCEEDED", outputUrls: ["https://dnznrvs05pmza.cloudfront.net/out.png"] })) as never,
    runwayFetchOutput: (async () => ({ bytes: Buffer.from("png-bytes"), mimeType: "image/png" })) as never,
    pollTask: (async () => {
      throw new Error("Shuyu poll must not be called for a Runway frame");
    }) as never,
    fetchOutput: (async () => {
      throw new Error("Shuyu fetch must not be called for a Runway frame");
    }) as never,
    storage: (() => ({
      isConfigured: () => true,
      uploadBuffer: async (_bucket: string, _bytes: Buffer, options: { key: string; contentType: string }) => {
        uploads.push({ key: options.key, contentType: options.contentType });
        return { key: options.key, url: `https://blob.example/${options.key}`, absolute: true };
      },
      deleteObject: async () => undefined,
    })) as never,
    createAsset: (async (input: { url: string }) => ({ id: "asset-1", url: input.url })) as never,
  });

  await storyboardServiceTest.reconcileStoryboardFrame("frame-1");
  assert.equal(uploads.length, 1);
  assert.match(uploads[0]!.key, /^storyboards\/owner-1\/run-1\/frame-1-attempt-1-.+\.png$/);
  const done = writes.find((write) => write.data.status === "SUCCEEDED");
  assert.ok(done);
  assert.equal(done.data.outputAssetId, "asset-1");
});

test("Runway 帧轮询失败：这一帧失败，写 Runway 给的原因，不说「退款状态尚未确认」", async (t) => {
  const { model } = stubFrameModel(t);
  const writes: Writes = [];
  model.updateMany = async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    writes.push(args);
    return { count: 1 };
  };
  model.findFirst = async () => processingRunwayFrame();
  storyboardServiceTest.__setRuntimeDependenciesForTests({
    runwayPollImage: (async () => ({ status: "failed", rawStatus: "FAILED", outputUrls: [], failure: "Content moderated（SAFETY.INPUT.TEXT）" })) as never,
  });

  await storyboardServiceTest.reconcileStoryboardFrame("frame-1");
  const failed = writes.find((write) => write.data.status === "FAILED");
  assert.ok(failed);
  assert.equal(failed.data.errorCode, "PROVIDER_FAILED");
  assert.equal(failed.data.errorMessage, "分镜出图失败（Content moderated（SAFETY.INPUT.TEXT）），可重新生成这一帧。");
});
