import assert from "node:assert/strict";
import test from "node:test";
import { ProviderSubmissionState, VideoJobStatus, VideoProvider } from "@prisma/client";
import { db } from "../src/lib/db";
import { __test__ as batchTest } from "../src/lib/services/batch-service";
import type { VideoProvider as VideoProviderAdapter } from "../src/lib/video-generation/providers/types";

/**
 * round 1025 · A1b 2.3：批量提交的参考图顺序。
 *
 * prompt 在建批次时写好「input_images[1..k]」指实拍产品图；此前提交时故事板帧
 * 排在前面，槽位编号实际指向 AI 帧，遇到 4 图套餐时实拍图还会被整组挤掉。
 * 现在实拍在前、故事板帧在后；按套餐截断由适配器负责（见 shuyu-reference-limit）。
 *
 * monkey-patch Prisma 与视频适配器，不触真实 DB、不调供应商、零计费。
 */

function patch(t: import("node:test").TestContext, model: Record<string, unknown>, patches: Record<string, unknown>) {
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = model[key];
    model[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) model[key] = originals[key];
  });
}

const fakeAdapter = {
  id: "fake",
  displayName: "fake",
  manualRetryBillingRisk: "none",
  isConfigured: () => true,
  isMockMode: () => true,
} as unknown as VideoProviderAdapter;

test("2.3 参考图：实拍产品图排在最前，故事板帧在后——提示词槽位 1..k 指向实拍图", async (t) => {
  batchTest.__setVideoProviderFactoryForTests(() => ({
    ...fakeAdapter,
    createVideoJob: async (options: Record<string, unknown>) => {
      captured.push(options);
      return { providerJobId: "ext-1", providerId: "fake" };
    },
  }) as unknown as VideoProviderAdapter);
  t.after(() => batchTest.__setVideoProviderFactoryForTests(null));
  const captured: Array<Record<string, unknown>> = [];
  const frames = [0, 1, 2, 3].map((ordinal) => ({
    ordinal,
    status: "SUCCEEDED",
    outputAsset: { userId: "user-1", url: `https://cdn.example.test/frame-${ordinal}.jpg` },
  }));
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findUnique: async () => ({
      id: "run-1",
      userId: "user-1",
      status: "APPROVED",
      durationSec: 15,
      frames,
    }),
  });
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    updateMany: async () => ({ count: 1 }),
  });
  const log = console.log;
  console.log = () => undefined;
  t.after(() => {
    console.log = log;
  });

  await batchTest.submitClaimedJob({
    id: "job-ref-order",
    claimOwner: "owner-1",
    status: VideoJobStatus.RUNNING,
    submissionState: ProviderSubmissionState.NOT_STARTED,
    submitAttempts: 0,
    retryCount: 0,
    provider: VideoProvider.MOCK,
    videoRouteSnapshot: "buddy",
    videoModelSnapshot: null,
    videoProviderAdapterSnapshot: null,
    batchJobId: "batch-ref",
    batchIndex: 0,
    seed: 7,
    promptText: "Use input_images[1], input_images[2] as the product truth.",
    negativePrompt: null,
    createdAt: new Date(),
    dispatchQuarantineDecision: null,
    assignedAssets: {
      index: 0,
      seed: 7,
      assets: [
        { id: "photo-a", url: "https://cdn.example.test/photo-a.jpg" },
        { id: "photo-b", url: "https://cdn.example.test/photo-b.jpg" },
      ],
    },
    templateSnapshot: {
      lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "720p" },
    },
  } as never);

  assert.equal(captured.length, 1);
  assert.deepEqual(
    (captured[0].referenceImages as Array<{ url: string }>).map((image) => image.url),
    [
      "https://cdn.example.test/photo-a.jpg",
      "https://cdn.example.test/photo-b.jpg",
      "https://cdn.example.test/frame-0.jpg",
      "https://cdn.example.test/frame-1.jpg",
      "https://cdn.example.test/frame-2.jpg",
      "https://cdn.example.test/frame-3.jpg",
    ],
  );
});
