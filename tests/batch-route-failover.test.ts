import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { StyleTemplateStatus, type StyleTemplate } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  __resetAppEnvForTests,
  VideoGenerationRuntimeUnavailableError,
} from "../src/lib/config/env";
import { __testVideoPlans__ } from "../src/lib/providers/shuyu";
import { createBatchJob } from "../src/lib/services/batch-service";
import { createVideoRouteSnapshot } from "../src/lib/video-generation/video-route-registry";
import {
  CUSTOMER_FAILOVER_ROUTE_ID,
  customerFailoverRouteSnapshot,
} from "../src/lib/video-generation/video-route-selection";
import { __resetShuyuRuntimeProbeForTests } from "../src/lib/video-generation/shuyu-runtime";

/**
 * P03-C1 · 批量永不降级。
 *
 * 单条 dispatch 在 Shuyu 不可用时会切到备用线路；批量的线路、计价、快照在建批次时
 * 一次定死，上游不可用就按原原因抛错、零建批次。这里故意把备用线路配齐
 * （ARK_API_KEY），证明「没降级」是 allowFailover:false 的结果，而不是备用线路恰好不可用。
 *
 * fetch 整体打桩、db 打桩：零网络、零库、零供应商提交。
 */

const PLAN_BASE = {
  kind: "video",
  model: "studio-video",
  display_name: "Seedance 2.0",
  capabilities: {
    aspect_ratios: ["9:16", "16:9", "1:1"],
    input_images_max: 9,
    modes: ["text2video", "image2video"],
    durations: [4, 5, 10, 15],
  },
  status: "available",
};

const PLANS = [
  { ...PLAN_BASE, plan_id: "video-plan-01", unit: "generation", resolution: "720P", sale_points: 700 },
  { ...PLAN_BASE, plan_id: "video-plan-03", unit: "second", resolution: "720P", sale_points: 88 },
];

const TEMPLATE: StyleTemplate = {
  id: "tpl_batch_failover",
  slug: "batch-failover",
  version: 1,
  name: "Batch Failover",
  nameZh: "批量不降级",
  category: "测试",
  coverImage: "https://cdn.test/cover.jpg",
  promptSkeleton: "Use {IMAGE_REFS} to film {PRODUCT_NAME}. Camera pushes in.",
  negativePrompt: "label blur, text overlay",
  lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "push in" },
  imagesPerVideo: { min: 1, max: 4 },
  status: StyleTemplateStatus.ACTIVE,
  activatedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const INPUT = {
  userId: "batch-failover-user",
  templateId: TEMPLATE.id,
  templateVersion: TEMPLATE.version,
  images: [{ id: "img-1", url: "https://cdn.example.test/product.jpg" }],
  requestedCount: 2,
  idempotencyKey: "batch-failover-idempotency-key",
};

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

/// 非生产、真实引擎、客户线路 = buddy；备用线路 volcengine_cn_legacy 凭据齐全。
function realEnvWithBackup(t: TestContext) {
  const values: Record<string, string | undefined> = {
    VERCEL_ENV: "preview",
    VIDEO_PROVIDER: "byteplus",
    VIDEO_ENGINE_MOCK: "false",
    AIVORA_DRY_RUN: "false",
    SHUYU_API_KEY: "test-only",
    SHUYU_ALLOW_FINAL_TIER: undefined,
    ARK_API_KEY: "test-ark-key",
    ARK_BASE_URL: undefined,
  };
  const originals = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    originals.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  __resetAppEnvForTests();
  __testVideoPlans__.resetVideoPlanCache();
  __resetShuyuRuntimeProbeForTests();
  t.after(() => {
    for (const [key, value] of originals) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    __resetAppEnvForTests();
    __testVideoPlans__.resetVideoPlanCache();
    __resetShuyuRuntimeProbeForTests();
  });
}

type Upstream = "healthy" | "down" | "broke";

function stubShuyuFetch(t: TestContext, upstream: Upstream) {
  const calls = { submissions: 0, nonShuyu: [] as string[] };
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/videos/generations")) {
      calls.submissions += 1;
      return new Response(JSON.stringify({ task_id: "task_must_not_happen" }), { status: 201 });
    }
    if (url.endsWith("/prices") || url.endsWith("/account/balance")) {
      if (upstream === "down") throw new TypeError("fetch failed");
      if (url.endsWith("/prices")) {
        return new Response(JSON.stringify({ object: "list", data: PLANS }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          object: "balance",
          available_points: upstream === "broke" ? 10 : 100_000,
          unit: "points",
        }),
        { status: 200 },
      );
    }
    calls.nonShuyu.push(url);
    throw new Error(`unexpected network call in batch failover test: ${url}`);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

/// 事务桩：记录建批次与展开行写入的线路快照，不碰真实库。
function stubBatchWrites(t: TestContext) {
  const writes = {
    transactions: 0,
    batchData: [] as Array<Record<string, unknown>>,
    rowData: [] as Array<Record<string, unknown>>,
  };
  const tx = {
    batchJob: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.batchData.push(data);
        return { id: "batch_failover", ...data };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "batch_failover",
        ...writes.batchData[0],
        ...data,
      }),
    },
    videoJob: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        writes.rowData.push(...data);
        return { count: data.length };
      },
    },
  };
  patch(t, db.batchJob as unknown as Record<string, unknown>, {
    findUnique: async () => null,
  });
  patch(t, db.styleTemplate as unknown as Record<string, unknown>, {
    findFirst: async () => TEMPLATE,
  });
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => {
      writes.transactions += 1;
      return fn(tx);
    },
  });
  return writes;
}

const BUDDY_SNAPSHOT = createVideoRouteSnapshot("buddy");

function pickSnapshot(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.keys(BUDDY_SNAPSHOT).map((key) => [key, record[key]]),
  );
}

test("前提：本夹具下备用线路确实可用（否则「没降级」证明不了任何事）", (t) => {
  realEnvWithBackup(t);
  const backup = customerFailoverRouteSnapshot();
  assert.ok(backup);
  assert.equal(backup.videoRouteSnapshot, CUSTOMER_FAILOVER_ROUTE_ID);
});

test("Shuyu 上游不可用：批量按原原因 shuyu_unavailable 拒绝，零建批次、零换线路", async (t) => {
  realEnvWithBackup(t);
  const calls = stubShuyuFetch(t, "down");
  const writes = stubBatchWrites(t);

  await assert.rejects(
    () => createBatchJob({ ...INPUT, videoRouteId: "buddy" }),
    (error: unknown) =>
      error instanceof VideoGenerationRuntimeUnavailableError &&
      error.reason === "shuyu_unavailable",
  );
  assert.equal(writes.transactions, 0, "不建批次");
  assert.equal(writes.batchData.length, 0);
  assert.equal(writes.rowData.length, 0);
  assert.equal(calls.submissions, 0);
  assert.deepEqual(calls.nonShuyu, []);
});

test("Shuyu 余额不足：按 shuyu_insufficient_balance 拒绝，零建批次", async (t) => {
  realEnvWithBackup(t);
  const calls = stubShuyuFetch(t, "broke");
  const writes = stubBatchWrites(t);

  await assert.rejects(
    () => createBatchJob({ ...INPUT, videoRouteId: "buddy" }),
    (error: unknown) =>
      error instanceof VideoGenerationRuntimeUnavailableError &&
      error.reason === "shuyu_insufficient_balance",
  );
  assert.equal(writes.transactions, 0);
  assert.equal(calls.submissions, 0);
});

test("Shuyu 可用：批次与每一行写入的线路快照与原始选择逐字段一致", async (t) => {
  realEnvWithBackup(t);
  const calls = stubShuyuFetch(t, "healthy");
  const writes = stubBatchWrites(t);

  const batch = await createBatchJob({ ...INPUT, videoRouteId: "buddy" });
  assert.equal(batch.id, "batch_failover");
  assert.equal(writes.transactions, 1);
  assert.equal(writes.batchData.length, 1);
  assert.deepEqual(pickSnapshot(writes.batchData[0]!), BUDDY_SNAPSHOT);
  assert.equal(writes.rowData.length, INPUT.requestedCount);
  for (const row of writes.rowData) {
    assert.equal(row.videoRouteSnapshot, "buddy");
  }
  assert.equal(calls.submissions, 0, "建批次不提交供应商");
});
