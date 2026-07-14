import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  ProviderSubmissionState,
  VideoJobStatus,
  VideoProvider,
  type VideoJob,
} from "@prisma/client";
import { db } from "../src/lib/db";
import { __test__ as batchTest, retryFailedBatchJob } from "../src/lib/services/batch-service";
import type {
  CreateVideoJobOptions,
  VideoProvider as VideoProviderAdapter,
} from "../src/lib/video-generation/providers/types";

function patch(
  t: TestContext,
  target: Record<string, unknown>,
  values: Record<string, unknown>,
) {
  const originals: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = target[key];
    target[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) target[key] = value;
  });
}

function claimedJob(overrides: Partial<VideoJob> = {}) {
  return {
    id: "job-billing-safe",
    provider: VideoProvider.SEEDANCE_I2V,
    status: VideoJobStatus.RUNNING,
    submissionState: ProviderSubmissionState.NOT_STARTED,
    submitAttempts: 0,
    retryCount: 0,
    promptText: "show the product",
    negativePrompt: "morphing",
    assignedAssets: { assets: [{ id: "asset-1", url: "https://example.test/p.jpg" }], seed: 7 },
    templateSnapshot: {
      lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p" },
    },
    seed: 7,
    batchJobId: "batch-1",
    batchIndex: 0,
    createdAt: new Date("2026-07-13T20:00:00.000Z"),
    dispatchQuarantineDecision: null,
    claimOwner: "worker-1",
    ...overrides,
  } as unknown as VideoJob & { claimOwner: string };
}

function provider(
  create: (options: CreateVideoJobOptions) => Promise<{ providerJobId: string; providerId: string }>,
): VideoProviderAdapter {
  return {
    id: "byteplus",
    displayName: "Billing safety fixture",
    isConfigured: () => true,
    isMockMode: () => false,
    createVideoJob: create,
    getVideoJobStatus: async () => {
      throw new Error("unused");
    },
    cancelVideoJob: async () => ({ supported: false }),
    getGeneratedVideoUrl: () => null,
    normalizeProviderStatus: () => "unknown",
  };
}

function installProvider(t: TestContext, adapter: VideoProviderAdapter) {
  process.env.VIDEO_PROVIDER = "mock";
  process.env.VERCEL_ENV = "preview";
  batchTest.__setVideoProviderFactoryForTests(() => adapter);
  t.after(() => {
    batchTest.__setVideoProviderFactoryForTests(null);
    delete process.env.VIDEO_PROVIDER;
    delete process.env.VERCEL_ENV;
  });
}

test("RF-003: provider timeout becomes ACK_UNKNOWN and is never auto-requeued", async (t) => {
  let providerCalls = 0;
  installProvider(
    t,
    provider(async () => {
      providerCalls += 1;
      throw new Error("request timed out after upload");
    }),
  );

  const updates: Array<Record<string, unknown>> = [];
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    updateMany: async (args: { data: Record<string, unknown> }) => {
      updates.push(args.data);
      return { count: 1 };
    },
  });

  await batchTest.submitClaimedJob(claimedJob());

  assert.equal(providerCalls, 1);
  assert.equal(updates[0].submissionState, ProviderSubmissionState.SUBMITTING);
  assert.equal(updates[1].submissionState, ProviderSubmissionState.ACK_UNKNOWN);
  assert.equal(updates[1].status, VideoJobStatus.FAILED);
  assert.equal(updates[1].availableAt, null);
  assert.match(String(updates[1].userSafeError), /避免重复计费/);
});

test("RF-003: provider acknowledgement followed by DB persistence loss fails closed", async (t) => {
  let providerCalls = 0;
  installProvider(
    t,
    provider(async (options) => {
      providerCalls += 1;
      assert.equal(options.providerRequestKey, "job-billing-safe:attempt:1");
      return { providerJobId: "accepted-but-not-saved", providerId: "byteplus" };
    }),
  );

  const updates: Array<Record<string, unknown>> = [];
  let write = 0;
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    updateMany: async (args: { data: Record<string, unknown> }) => {
      updates.push(args.data);
      write += 1;
      return { count: write === 2 ? 0 : 1 };
    },
  });

  await batchTest.submitClaimedJob(claimedJob());

  assert.equal(providerCalls, 1);
  assert.equal(updates[2].submissionState, ProviderSubmissionState.ACK_UNKNOWN);
  assert.equal(updates[2].status, VideoJobStatus.FAILED);
  assert.match(String(updates[2].submissionErrorClass), /persistence/);
});

test("RF-003: expired lease requeues only before submission; SUBMITTING is quarantined", async (t) => {
  const model = db.videoJob as unknown as Record<string, unknown>;
  const writes: Array<Record<string, unknown>> = [];
  patch(t, model, {
    findMany: async () => [
      { id: "not-started", submissionState: ProviderSubmissionState.NOT_STARTED },
      { id: "submitting", submissionState: ProviderSubmissionState.SUBMITTING },
    ],
    updateMany: async (args: { data: Record<string, unknown> }) => {
      writes.push(args.data);
      return { count: 1 };
    },
  });

  const recovered = await batchTest.recoverExpiredLeases("batch-1", new Date());
  assert.equal(recovered, 2);
  assert.equal(writes[0].status, VideoJobStatus.QUEUED);
  assert.equal(writes[0].submissionState, ProviderSubmissionState.NOT_STARTED);
  assert.equal(writes[1].status, VideoJobStatus.FAILED);
  assert.equal(writes[1].submissionState, ProviderSubmissionState.ACK_UNKNOWN);
});

test("RF-003: a batch ACK_UNKNOWN failure cannot be manually reset for paid resubmission", async (t) => {
  let updateCalls = 0;
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findFirst: async () => ({
      submissionState: ProviderSubmissionState.ACK_UNKNOWN,
      externalJobId: null,
      lastProviderStatus: null,
      errorMessage: "ack unknown",
    }),
    updateMany: async () => {
      updateCalls += 1;
      return { count: 1 };
    },
  });

  const retried = await retryFailedBatchJob("batch-1", "job-1");
  assert.equal(retried, false);
  assert.equal(updateCalls, 0);
});
