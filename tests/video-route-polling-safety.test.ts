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
import { __testVideoPlans__, SHUYU_API_BASE_URL } from "../src/lib/providers/shuyu";
import { __resetShuyuRuntimeProbeForTests } from "../src/lib/video-generation/shuyu-runtime";
import { SegmentRedoRejectedError } from "../src/lib/video-generation/segment-redo";
import { planSegments } from "../src/lib/duration/segment-planner";
import { mockDirectorPlan } from "./helpers/director-plan-fixture";
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
  process.env.VIDEO_PROVIDER = "shuyu";
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

/// 生产 2026-11-17 的实际形状：直连线路的旧变量都还留在环境里，出片的只有 Shuyu
const LEFTOVER_ENV_KEYS = [
  "VIDEO_PROVIDER",
  "VIDEO_ENGINE_MOCK",
  "VERCEL_ENV",
  "SEEDANCE_RUNTIME_PROFILE",
  "ARK_BASE_URL",
  "ARK_API_KEY",
  "BYTEPLUS_ARK_API_KEY",
  "SHUYU_API_KEY",
  "shuyu_api_key",
] as const;

function installLeftoverDirectEnv(t: TestContext) {
  const previousEnv = Object.fromEntries(
    LEFTOVER_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  process.env.VIDEO_PROVIDER = "byteplus";
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.VERCEL_ENV = "preview";
  process.env.SEEDANCE_RUNTIME_PROFILE = "volcengine_cn_legacy";
  process.env.ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
  process.env.ARK_API_KEY = "legacy-test-key";
  process.env.BYTEPLUS_ARK_API_KEY = "international-test-key";
  process.env.SHUYU_API_KEY = "shuyu-test-key";
  delete process.env.shuyu_api_key;
  __resetAppEnvForTests();
  __resetShuyuRuntimeProbeForTests();
  __testVideoPlans__.resetVideoPlanCache();
  t.after(() => {
    for (const key of LEFTOVER_ENV_KEYS) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    __resetAppEnvForTests();
    __resetShuyuRuntimeProbeForTests();
    __testVideoPlans__.resetVideoPlanCache();
  });
}

const BUDDY_ROUTE = {
  videoRouteSnapshot: "buddy",
  videoModelSnapshot: "studio-video",
  videoProviderAdapterSnapshot: "shuyu",
};

test("polling follows the persisted buddy route: one Shuyu status request with the Shuyu key, nothing to the leftover direct endpoints", async (t) => {
  installLeftoverDirectEnv(t);

  const row: Record<string, unknown> = {
    id: "route-pinned-poll",
    videoBriefId: "brief-route-pinned-poll",
    batchJobId: null,
    provider: VideoProvider.SEEDANCE_T2V,
    externalJobId: "shuyu-provider-job",
    status: VideoJobStatus.RUNNING,
    submissionState: ProviderSubmissionState.ACCEPTED,
    ...BUDDY_ROUTE,
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
    return new Response(
      JSON.stringify({ task_id: "shuyu-provider-job", status: "processing" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await reconcileVideoJob(String(row.id));
  assert.equal(result?.status, VideoJobStatus.RUNNING);
  assert.equal(result?.lastProviderStatus, "processing");
  assert.deepEqual(requests, [
    {
      url: `${SHUYU_API_BASE_URL}/tasks/shuyu-provider-job`,
      authorization: "Bearer shuyu-test-key",
    },
  ]);
});

for (const retired of [
  { videoRouteSnapshot: "byteplus_international", videoModelSnapshot: "dreamina-seedance-2-0-260128", videoProviderAdapterSnapshot: "byteplus" },
  { videoRouteSnapshot: "volcengine_cn_legacy", videoModelSnapshot: "doubao-seedance-2-0-260128", videoProviderAdapterSnapshot: "byteplus" },
]) {
  test(`in-flight job pinned to retired ${retired.videoRouteSnapshot}: polling never calls any provider (leftover credentials included) and converges to FAILED after the poll-error threshold`, async (t) => {
    installLeftoverDirectEnv(t);

    const row: Record<string, unknown> = {
      id: "retired-route-poll",
      videoBriefId: "brief-retired-route-poll",
      batchJobId: null,
      provider: VideoProvider.SEEDANCE_T2V,
      externalJobId: "cgt-20260720-direct-job",
      status: VideoJobStatus.RUNNING,
      submissionState: ProviderSubmissionState.ACCEPTED,
      ...retired,
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
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("must not call any provider for a retired route");
    }) as typeof fetch;
    t.after(() => {
      globalThis.fetch = originalFetch;
    });

    /// 默认阈值 3：前两轮只记一次轮询异常、仍在 RUNNING；第三轮落成失败，给客户一句能看懂的话
    for (const expected of [VideoJobStatus.RUNNING, VideoJobStatus.RUNNING, VideoJobStatus.FAILED]) {
      const result = await reconcileVideoJob(String(row.id));
      assert.equal(result?.status, expected);
    }
    assert.equal(fetchCalls, 0);
    assert.equal(row.pollErrors, 3);
    assert.match(String(row.errorMessage), /已下线/);
    assert.match(String(row.userSafeError), /暂时无法获取生成进度/);
    assert.equal(row.videoRouteSnapshot, retired.videoRouteSnapshot, "线路快照不被改写");
  });
}

function retryFixtures(t: TestContext, route: Record<string, string>) {
  const plan = parseDirectorPlan(
    mockDirectorPlan({
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
    ...route,
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
  return row;
}

test("retry follows the persisted buddy route: the resubmission goes to Shuyu only, never to the leftover direct endpoints", async (t) => {
  installLeftoverDirectEnv(t);
  const row = retryFixtures(t, BUDDY_ROUTE);

  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; authorization: string | null }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    if (url.endsWith("/prices")) {
      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            {
              plan_id: "video-plan-02",
              kind: "video",
              model: "studio-video",
              unit: "generation",
              resolution: "720P",
              sale_points: 900,
              display_name: "Seedance 2.0 · 720P",
              capabilities: {
                aspect_ratios: ["9:16", "16:9", "1:1"],
                input_images_max: 9,
                modes: ["frames2video", "image2video", "text2video"],
                durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
                quality: "720P",
              },
              status: "available",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/videos/generations")) {
      return new Response(JSON.stringify({ task_id: "provider-retry-route-pinned" }), { status: 201 });
    }
    throw new Error(`unexpected URL ${url}`);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await retryFailedVideoJob(String(row.id));
  assert.equal(result.status, VideoJobStatus.RUNNING);
  assert.equal(row.externalJobId, "provider-retry-route-pinned");
  assert.equal(row.videoRouteSnapshot, "buddy");
  const submissions = requests.filter((request) => request.method === "POST");
  assert.deepEqual(submissions, [
    {
      url: `${SHUYU_API_BASE_URL}/videos/generations`,
      method: "POST",
      authorization: "Bearer shuyu-test-key",
    },
  ]);
  for (const request of requests) {
    assert.ok(request.url.startsWith(`${SHUYU_API_BASE_URL}/`), request.url);
    assert.doesNotMatch(request.url, /bytepluses|volces/);
    assert.equal(request.authorization, "Bearer shuyu-test-key");
  }
});

test("retry of a job pinned to a retired direct route is refused with the typed rejection before any provider request or row write", async (t) => {
  installLeftoverDirectEnv(t);
  const row = retryFixtures(t, {
    videoRouteSnapshot: "byteplus_international",
    videoModelSnapshot: "dreamina-seedance-2-0-260128",
    videoProviderAdapterSnapshot: "byteplus",
  });
  const before = { ...row };

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("must not call any provider for a retired route");
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => retryFailedVideoJob(String(row.id)),
    (error: unknown) => error instanceof SegmentRedoRejectedError && error.code === "INVALID_STATE",
  );
  assert.equal(fetchCalls, 0);
  assert.deepEqual(row, before, "被拒的重试不改这一行");
});
