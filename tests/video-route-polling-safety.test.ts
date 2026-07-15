import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  ProviderSubmissionState,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";
import { db } from "../src/lib/db";
import {
  reconcileVideoJob,
  retryFailedVideoJob,
} from "../src/lib/services/video-service";
import { HISTORICAL_DISPATCH_CUTOFF } from "../src/lib/services/historical-dispatch-quarantine";
import { __resetAppEnvForTests } from "../src/lib/config/env";
import { __resetContentReviewProviderForTests } from "../src/lib/content-review";
import { planSegments } from "../src/lib/duration/segment-planner";
import { __test__ as directorTest } from "../src/lib/services/director-service";
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

test("historical real job without a route snapshot fails closed before provider polling", async (t) => {
  const previousEnv = {
    VIDEO_PROVIDER: process.env.VIDEO_PROVIDER,
    VIDEO_ENGINE_MOCK: process.env.VIDEO_ENGINE_MOCK,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
  process.env.VIDEO_PROVIDER = "byteplus";
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.VERCEL_ENV = "preview";
  t.after(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const row: Record<string, unknown> = {
    id: "historical-route-unknown",
    videoBriefId: "brief-history",
    batchJobId: null,
    provider: VideoProvider.SEEDANCE_T2V,
    externalJobId: "provider-job-must-not-be-polled",
    status: VideoJobStatus.RUNNING,
    submissionState: ProviderSubmissionState.ACCEPTED,
    videoRouteSnapshot: null,
    videoModelSnapshot: null,
    videoProviderAdapterSnapshot: null,
    pollErrors: 0,
    timeoutAt: new Date(Date.now() + 60_000),
    createdAt: new Date(HISTORICAL_DISPATCH_CUTOFF.getTime() + 60_000),
    dispatchQuarantineDecision: null,
  };
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findUnique: async () => ({ ...row }),
    updateMany: async (args: { data: Record<string, unknown> }) => {
      Object.assign(row, args.data);
      return { count: 1 };
    },
  });

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("must not call provider");
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await reconcileVideoJob(String(row.id));
  assert.equal(fetchCalls, 0);
  assert.equal(result?.status, VideoJobStatus.FAILED);
  assert.equal(row.submissionErrorClass, "historical_route_snapshot_missing");
  assert.match(String(row.userSafeError), /停止自动查询|管理员对账/);
});

test("polling reconstructs the persisted route after the global default switches", async (t) => {
  const envKeys = [
    "VIDEO_PROVIDER",
    "VIDEO_ENGINE_MOCK",
    "VERCEL_ENV",
    "SEEDANCE_RUNTIME_PROFILE",
    "ARK_BASE_URL",
    "ARK_API_KEY",
    "BYTEPLUS_ARK_API_KEY",
  ] as const;
  const previousEnv = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );
  process.env.VIDEO_PROVIDER = "byteplus";
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.VERCEL_ENV = "preview";
  process.env.SEEDANCE_RUNTIME_PROFILE = "volcengine_cn_legacy";
  process.env.ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
  process.env.ARK_API_KEY = "legacy-test-key";
  process.env.BYTEPLUS_ARK_API_KEY = "international-test-key";
  __resetAppEnvForTests();
  t.after(() => {
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    __resetAppEnvForTests();
  });

  const row: Record<string, unknown> = {
    id: "route-pinned-poll",
    videoBriefId: "brief-route-pinned-poll",
    batchJobId: null,
    provider: VideoProvider.SEEDANCE_T2V,
    externalJobId: "international-provider-job",
    status: VideoJobStatus.RUNNING,
    submissionState: ProviderSubmissionState.ACCEPTED,
    videoRouteSnapshot: "byteplus_international",
    videoModelSnapshot: "dreamina-seedance-2-0-260128",
    videoProviderAdapterSnapshot: "byteplus",
    pollErrors: 0,
    timeoutAt: new Date(Date.now() + 60_000),
    createdAt: new Date(HISTORICAL_DISPATCH_CUTOFF.getTime() + 60_000),
    dispatchQuarantineDecision: null,
  };
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findUnique: async () => ({ ...row }),
    update: async (args: { data: Record<string, unknown> }) => {
      Object.assign(row, args.data);
      return { ...row };
    },
  });

  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = (async (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      authorization: headers.get("Authorization"),
    });
    return new Response(JSON.stringify({ status: "running", progress: 12 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await reconcileVideoJob(String(row.id));
  assert.equal(result?.status, VideoJobStatus.RUNNING);
  assert.equal(result?.lastProgress, 12);
  assert.deepEqual(requests, [
    {
      url: "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/international-provider-job",
      authorization: "Bearer international-test-key",
    },
  ]);
});

test("retry reconstructs the persisted route after the global default switches", async (t) => {
  const envKeys = [
    "VIDEO_PROVIDER",
    "VIDEO_ENGINE_MOCK",
    "VERCEL_ENV",
    "SEEDANCE_RUNTIME_PROFILE",
    "ARK_BASE_URL",
    "ARK_API_KEY",
    "BYTEPLUS_ARK_API_KEY",
    "CONTENT_REVIEW_ENABLED",
  ] as const;
  const previousEnv = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );
  process.env.VIDEO_PROVIDER = "byteplus";
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.VERCEL_ENV = "preview";
  process.env.SEEDANCE_RUNTIME_PROFILE = "volcengine_cn_legacy";
  process.env.ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
  process.env.ARK_API_KEY = "legacy-test-key";
  process.env.BYTEPLUS_ARK_API_KEY = "international-test-key";
  process.env.CONTENT_REVIEW_ENABLED = "false";
  __resetAppEnvForTests();
  __resetContentReviewProviderForTests();
  t.after(() => {
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    __resetAppEnvForTests();
    __resetContentReviewProviderForTests();
  });

  const plan = parseDirectorPlan(
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
  const row: Record<string, unknown> = {
    id: "route-pinned-retry",
    videoBriefId: "brief-route-pinned",
    status: VideoJobStatus.FAILED,
    provider: VideoProvider.SEEDANCE_T2V,
    externalJobId: null,
    submissionState: ProviderSubmissionState.REJECTED,
    providerRequestKey: "route-pinned-retry:attempt:1",
    submitAttempts: 1,
    retryCount: 0,
    segmentIndex: 0,
    finalVideoId: "final-route-pinned",
    errorMessage: "preflight rejected",
    createdAt: new Date(HISTORICAL_DISPATCH_CUTOFF.getTime() + 60_000),
    dispatchQuarantineDecision: null,
    videoRouteSnapshot: "byteplus_international",
    videoModelSnapshot: "dreamina-seedance-2-0-260128",
    videoProviderAdapterSnapshot: "byteplus",
  };
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findUnique: async () => ({ ...row, videoBrief: {} }),
    updateMany: async (args: { data: Record<string, unknown> }) => {
      const data = { ...args.data };
      if (
        data.submitAttempts &&
        typeof data.submitAttempts === "object" &&
        "increment" in data.submitAttempts
      ) {
        data.submitAttempts =
          Number(row.submitAttempts) +
          Number((data.submitAttempts as { increment: number }).increment);
      }
      Object.assign(row, data);
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

  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify({ id: "provider-retry-route-pinned" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await retryFailedVideoJob(String(row.id));
  assert.equal(result.status, VideoJobStatus.RUNNING);
  assert.equal(requestedUrls.length, 1);
  assert.match(
    requestedUrls[0],
    /^https:\/\/ark\.ap-southeast\.bytepluses\.com\/api\/v3\//,
  );
  assert.doesNotMatch(requestedUrls[0], /cn-beijing/);
  assert.equal(row.videoRouteSnapshot, "byteplus_international");
});
