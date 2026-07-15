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
    if (url.endsWith("/prices")) {
      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            {
              plan_id: "video-standard-720p-second",
              kind: "video",
              model: "studio-video",
              unit: "second",
              resolution: "720P",
              sale_points: 104,
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

  const reconciled = await reconcileVideoJob(String(persisted.id));
  assert.equal(reconciled?.status, VideoJobStatus.RUNNING);
  assert.equal(reconciled?.lastProviderStatus, "processing");
  assert.ok(calls.some((call) => call.url.endsWith("/tasks/shuyu-task-opaque")));
});
