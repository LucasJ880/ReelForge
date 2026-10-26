import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  ProviderSubmissionState,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";
import { db } from "../src/lib/db";
import {
  __test__ as videoServiceTest,
  reconcileVideoJob,
} from "../src/lib/services/video-service";
import { createVideoRouteSnapshot } from "../src/lib/video-generation/video-route-registry";
import { __resetShuyuRuntimeProbeForTests } from "../src/lib/video-generation/shuyu-runtime";
import { __testVideoPlans__ } from "../src/lib/providers/shuyu";

function installEnv(t: TestContext) {
  const keys = [
    "SHUYU_API_KEY",
    "shuyu_api_key",
    "VIDEO_PROVIDER",
    "VIDEO_ENGINE_MOCK",
    "VERCEL_ENV",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.SHUYU_API_KEY = "lifecycle-secret";
  delete process.env.shuyu_api_key;
  process.env.VIDEO_PROVIDER = "byteplus";
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.VERCEL_ENV = "preview";
  __resetShuyuRuntimeProbeForTests();
  t.after(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    __resetShuyuRuntimeProbeForTests();
  });
}

test("direct service submits and polls Shuyu from the persisted route snapshot", async (t) => {
  installEnv(t);
  let row: Record<string, unknown> | null = null;
  const model = db.videoJob as unknown as Record<string, unknown>;
  const originals = {
    create: model.create,
    updateMany: model.updateMany,
    update: model.update,
    findUnique: model.findUnique,
  };
  model.create = async (args: { data: Record<string, unknown> }) => {
    row = {
      ...args.data,
      createdAt: new Date(),
      pollErrors: 0,
      retryCount: 0,
      dispatchQuarantineDecision: null,
    };
    return { ...row };
  };
  model.updateMany = async (args: { data: Record<string, unknown> }) => {
    if (!row) return { count: 0 };
    Object.assign(row, args.data);
    return { count: 1 };
  };
  model.update = async (args: { data: Record<string, unknown> }) => {
    if (!row) throw new Error("missing row");
    Object.assign(row, args.data);
    return { ...row };
  };
  model.findUnique = async () => (row ? { ...row } : null);
  t.after(() => {
    Object.assign(model, originals);
  });

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/health")) {
      return new Response(
        JSON.stringify({
          object: "service_health",
          status: "operational",
          capabilities: { image: "available", video: "available" },
          checked_at: "2026-07-19T02:00:00.000Z",
        }),
        { status: 200 },
      );
    }
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
    if (url.endsWith("/account/balance")) {
      return new Response(
        JSON.stringify({
          object: "balance",
          available_points: 10_000,
          unit: "points",
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/videos/generations")) {
      return new Response(JSON.stringify({ task_id: "shuyu-task-opaque" }), {
        status: 201,
      });
    }
    if (url.endsWith("/tasks/shuyu-task-opaque")) {
      return new Response(
        JSON.stringify({
          task_id: "shuyu-task-opaque",
          status: "processing",
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected URL ${url}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const snapshot = createVideoRouteSnapshot("buddy");
  const submitted = await videoServiceTest.submitSegmentJob({
    briefId: "brief-shuyu",
    finalVideoId: "final-shuyu",
    aspectRatio: "9:16",
    segment: {
      segmentIndex: 0,
      fromSec: 0,
      toSec: 5,
      durationSec: 5,
      role: "hook",
      seedancePrompt: "Show the real product",
    },
    segmentCount: 1,
    referenceImageUrls: ["https://example.com/product.jpg"],
    generateAudio: true,
    routeSnapshot: snapshot,
  } as never);

  assert.equal(submitted.submissionState, ProviderSubmissionState.ACCEPTED);
  assert.equal(submitted.externalJobId, "shuyu-task-opaque");
  const persisted = row as unknown as Record<string, unknown>;
  assert.ok(persisted);
  assert.equal(persisted.videoRouteSnapshot, "buddy");
  assert.equal(persisted.videoModelSnapshot, "studio-video");
  assert.equal(persisted.videoProviderAdapterSnapshot, "shuyu");
  assert.equal(persisted.provider, VideoProvider.SEEDANCE_T2V);
  const post = calls.find((call) => call.url.endsWith("/videos/generations"));
  assert.ok(post);
  assert.equal(
    new Headers(post.init?.headers).get("idempotency-key"),
    persisted.providerRequestKey,
  );
  /// Shuyu 代理不接受 generate_audio（0728 真机：带上会整条被拒），但省略
  /// 字段时会按 prompt 生成原生口播；因此只省略开关，不能改走外部 TTS。
  assert.ok(
    !("generate_audio" in JSON.parse(String(post.init?.body))),
    "generate_audio 不得出现在 Shuyu 请求体中",
  );

  const reconciled = await reconcileVideoJob(String(persisted.id));
  assert.equal(reconciled?.status, VideoJobStatus.RUNNING);
  assert.equal(reconciled?.lastProviderStatus, "processing");
  assert.ok(calls.some((call) => call.url.endsWith("/tasks/shuyu-task-opaque")));
});

/// 审计可通过的 720P 视频套餐（与上面的 video-plan-02 同形，只换 ID 与积分）
function auditedVideoPlan(planId: string, salePoints: number) {
  return {
    plan_id: planId,
    kind: "video",
    model: "studio-video",
    unit: "generation",
    resolution: "720P",
    sale_points: salePoints,
    display_name: `Seedance 2.0 · 720P · ${planId}`,
    capabilities: {
      aspect_ratios: ["9:16", "16:9", "1:1"],
      input_images_max: 9,
      modes: ["frames2video", "image2video", "text2video"],
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      quality: "720P",
    },
    status: "available",
  };
}

test("P03-B: 提交级降级后，行上落的是实际受理的套餐与积分，不是创建时按默认套餐的估价", async (t) => {
  installEnv(t);
  /// 上一个用例把单套餐清单放进了 60s 缓存；这里要两档套餐才能演示降级。
  __testVideoPlans__.resetVideoPlanCache();
  t.after(() => __testVideoPlans__.resetVideoPlanCache());

  let row: Record<string, unknown> | null = null;
  let createdWith: Record<string, unknown> | null = null;
  const acceptWrites: Array<Record<string, unknown>> = [];
  const model = db.videoJob as unknown as Record<string, unknown>;
  const originals = {
    create: model.create,
    updateMany: model.updateMany,
    update: model.update,
    findUnique: model.findUnique,
  };
  model.create = async (args: { data: Record<string, unknown> }) => {
    createdWith = { ...args.data };
    row = {
      ...args.data,
      createdAt: new Date(),
      pollErrors: 0,
      retryCount: 0,
      dispatchQuarantineDecision: null,
    };
    return { ...row };
  };
  model.updateMany = async (args: { data: Record<string, unknown> }) => {
    if (!row) return { count: 0 };
    if (args.data.submissionState === ProviderSubmissionState.ACCEPTED) {
      acceptWrites.push({ ...args.data });
    }
    Object.assign(row, args.data);
    return { count: 1 };
  };
  model.update = async (args: { data: Record<string, unknown> }) => {
    if (!row) throw new Error("missing row");
    Object.assign(row, args.data);
    return { ...row };
  };
  model.findUnique = async () => (row ? { ...row } : null);
  t.after(() => {
    Object.assign(model, originals);
  });

  const submittedPlanIds: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      return new Response(
        JSON.stringify({
          object: "service_health",
          status: "operational",
          capabilities: { image: "available", video: "available" },
          checked_at: "2026-08-04T02:00:00.000Z",
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/prices")) {
      /// 默认档（最便宜的 720P）900 分；下一档 1200 分。
      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            auditedVideoPlan("video-plan-degrade-next", 1200),
            auditedVideoPlan("video-plan-degrade-default", 900),
          ],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/account/balance")) {
      return new Response(
        JSON.stringify({ object: "balance", available_points: 10_000, unit: "points" }),
        { status: 200 },
      );
    }
    if (url.endsWith("/videos/generations")) {
      const body = JSON.parse(String(init?.body)) as { plan_id?: string };
      submittedPlanIds.push(String(body.plan_id));
      if (body.plan_id === "video-plan-degrade-default") {
        /// 0804 真机形态：/prices 说 available，提交时却被拒 → 适配器换下一档
        return new Response(
          JSON.stringify({
            error: {
              type: "invalid_request_error",
              message: "The requested video option is unavailable",
            },
          }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify({ task_id: "shuyu-task-degraded" }), {
        status: 201,
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const submitted = await videoServiceTest.submitSegmentJob({
    briefId: "brief-shuyu-degrade",
    finalVideoId: "final-shuyu-degrade",
    aspectRatio: "9:16",
    segment: {
      segmentIndex: 0,
      fromSec: 0,
      toSec: 5,
      durationSec: 5,
      role: "hook",
      seedancePrompt: "Show the real product",
    },
    segmentCount: 1,
    referenceImageUrls: ["https://example.com/product.jpg"],
    generateAudio: false,
    routeSnapshot: createVideoRouteSnapshot("buddy"),
  } as never);

  assert.equal(submitted.submissionState, ProviderSubmissionState.ACCEPTED);
  assert.equal(submitted.externalJobId, "shuyu-task-degraded");
  assert.deepEqual(
    submittedPlanIds,
    ["video-plan-degrade-default", "video-plan-degrade-next"],
    "默认档被拒后按顺位换到下一档",
  );

  /// 创建行时按默认套餐估价 900；受理回写成实际使用的 1200 与对应套餐 ID。
  const created = createdWith as unknown as Record<string, unknown>;
  assert.ok(created);
  assert.equal(created.providerUnitPoints, 900);
  assert.ok(!("providerPlanId" in created), "创建时还不知道实际套餐");
  assert.equal(acceptWrites.length, 1);
  assert.equal(acceptWrites[0].providerPlanId, "video-plan-degrade-next");
  assert.equal(acceptWrites[0].providerUnitPoints, 1200);
  const persisted = row as unknown as Record<string, unknown>;
  assert.equal(persisted.providerPlanId, "video-plan-degrade-next");
  assert.equal(persisted.providerUnitPoints, 1200);
});
