import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  Prisma,
  ProviderSubmissionState,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";
import { db } from "../src/lib/db";
import { planSegments } from "../src/lib/duration/segment-planner";
import { __test__ as directorTest } from "../src/lib/services/director-service";
import {
  retryFailedVideoJob,
  __test__ as videoTest,
} from "../src/lib/services/video-service";
import { HISTORICAL_DISPATCH_CUTOFF } from "../src/lib/services/historical-dispatch-quarantine";
import { parseDirectorPlan } from "../src/lib/schemas/director-plan";

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

function installRealMode(t: TestContext) {
  const keys = ["VIDEO_PROVIDER", "VIDEO_ENGINE_MOCK", "VERCEL_ENV"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.VIDEO_PROVIDER = "byteplus";
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.VERCEL_ENV = "preview";
  t.after(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    videoTest.__setStatusFetcherForTests(null);
    videoTest.__setSubmitterForTests(null);
  });
}

function directorPlan() {
  return parseDirectorPlan(
    directorTest.mockDirectorPlan({
      targetDurationSec: 15,
      segmentSlots: planSegments(15),
      clientBrief: { businessName: "Acme", productName: "Acme Pro" },
      productInput: {},
      targetCountry: "US",
      targetLanguage: "en-US",
      targetPlatform: "tiktok",
      angle: {
        title: "Product proof",
        hook: "Show the real product",
        narrative: null,
        type: "OPTIMIZATION",
        explorationTheme: null,
        localeNotes: null,
      },
    }),
  );
}

function failedAcceptedJob() {
  return {
    id: "job-retry-safe",
    status: VideoJobStatus.FAILED,
    provider: VideoProvider.SEEDANCE_T2V,
    videoRouteSnapshot: "byteplus_international",
    videoModelSnapshot: "dreamina-seedance-2-0-260128",
    videoProviderAdapterSnapshot: "byteplus",
    externalJobId: "provider-original",
    submissionState: ProviderSubmissionState.ACCEPTED,
    providerRequestKey: "job-retry-safe:attempt:1",
    submitAttempts: 1,
    retryCount: 0,
    videoBriefId: "brief-retry-safe",
    segmentIndex: 0,
    finalVideoId: "final-retry-safe",
    errorMessage: "provider failed",
    createdAt: new Date(HISTORICAL_DISPATCH_CUTOFF.getTime() + 60_000),
    dispatchQuarantineDecision: null,
  };
}

test("RF-003: retry status lookup timeout makes acknowledgement unknown and submits zero new jobs", async (t) => {
  installRealMode(t);
  const row = failedAcceptedJob() as Record<string, unknown>;
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findUnique: async () => ({ ...row }),
    updateMany: async (args: { data: Record<string, unknown> }) => {
      Object.assign(row, args.data);
      return { count: 1 };
    },
  });
  videoTest.__setStatusFetcherForTests(async () => {
    throw new Error("status timeout");
  });
  let submitCalls = 0;
  videoTest.__setSubmitterForTests(async () => {
    submitCalls += 1;
    return { jobId: "must-not-exist" };
  });

  await assert.rejects(
    () => retryFailedVideoJob(String(row.id)),
    /禁止重新提交|避免重复计费/,
  );
  assert.equal(submitCalls, 0);
  assert.equal(row.submissionState, ProviderSubmissionState.ACK_UNKNOWN);
  assert.match(String(row.userSafeError), /避免重复计费/);
});

test("RF-003: concurrent manual retries use CAS and create exactly one provider job", async (t) => {
  installRealMode(t);
  const row = failedAcceptedJob() as Record<string, unknown>;
  const plan = directorPlan();

  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findUnique: async () => ({ ...row, videoBrief: {} }),
    updateMany: async (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      if (
        args.where.status &&
        args.where.status !== row.status
      ) {
        return { count: 0 };
      }
      if (
        args.where.submissionState &&
        args.where.submissionState !== row.submissionState
      ) {
        return { count: 0 };
      }
      const next = { ...args.data };
      if (
        next.submitAttempts &&
        typeof next.submitAttempts === "object" &&
        "increment" in (next.submitAttempts as object)
      ) {
        next.submitAttempts =
          Number(row.submitAttempts ?? 0) +
          Number((next.submitAttempts as { increment: number }).increment);
      }
      Object.assign(row, next);
      return { count: 1 };
    },
  });
  patch(t, db.videoBrief as unknown as Record<string, unknown>, {
    findUnique: async () => ({
      aspectRatio: "9:16",
      directorPlan: plan,
      referenceImageUrls: [],
    }),
  });
  patch(t, db.finalVideo as unknown as Record<string, unknown>, {
    update: async () => ({}),
  });
  videoTest.__setStatusFetcherForTests(async () => ({
    jobId: "provider-original",
    status: "failed",
    rawProviderStatus: "failed",
  }));
  let submitCalls = 0;
  videoTest.__setSubmitterForTests(async () => {
    submitCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { jobId: "provider-retry" };
  });

  const results = await Promise.allSettled([
    retryFailedVideoJob(String(row.id)),
    retryFailedVideoJob(String(row.id)),
  ]);

  assert.equal(submitCalls, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(row.submissionState, ProviderSubmissionState.ACCEPTED);
  assert.equal(row.externalJobId, "provider-retry");
});

test("RF-003: logical segment key makes repeated initial dispatch submit once", async (t) => {
  installRealMode(t);
  const plan = directorPlan();
  let stored: Record<string, unknown> | null = null;
  let createCalls = 0;
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    create: async (args: { data: Record<string, unknown> }) => {
      createCalls += 1;
      if (stored) {
        throw new Prisma.PrismaClientKnownRequestError("duplicate logical key", {
          code: "P2002",
          clientVersion: "6.19.3",
          meta: { target: ["logicalJobKey"] },
        });
      }
      stored = { ...args.data };
      return { ...stored };
    },
    findUnique: async () => (stored ? { ...stored } : null),
    updateMany: async (args: { data: Record<string, unknown> }) => {
      if (!stored) return { count: 0 };
      Object.assign(stored, args.data);
      return { count: 1 };
    },
  });
  let submitCalls = 0;
  videoTest.__setSubmitterForTests(async () => {
    submitCalls += 1;
    return { jobId: "provider-first" };
  });

  const args = {
    briefId: "brief-logical",
    finalVideoId: "final-logical",
    aspectRatio: "9:16",
    segment: plan.segmentPlan[0],
    segmentCount: 1,
    referenceImageUrls: [],
    routeSnapshot: {
      videoRouteSnapshot: "byteplus_international" as const,
      videoModelSnapshot: "dreamina-seedance-2-0-260128",
      videoProviderAdapterSnapshot: "byteplus" as const,
    },
  };
  const first = await videoTest.submitSegmentJob(args);
  const replay = await videoTest.submitSegmentJob(args);

  assert.equal(createCalls, 2);
  assert.equal(submitCalls, 1);
  assert.equal(first?.id, replay?.id);
  const storedRow = stored as Record<string, unknown> | null;
  assert.ok(storedRow);
  assert.equal(storedRow.submissionState, ProviderSubmissionState.ACCEPTED);
});
