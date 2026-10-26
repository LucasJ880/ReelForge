import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { StyleTemplateStatus, type StyleTemplate } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  __resetAppEnvForTests,
  VideoGenerationRuntimeUnavailableError,
} from "../src/lib/config/env";
import { __testVideoPlans__ } from "../src/lib/providers/shuyu";
import {
  BatchProviderInputError,
  createBatchJob,
} from "../src/lib/services/batch-service";
import { createVideoRouteSnapshot } from "../src/lib/video-generation/video-route-registry";
import { getVideoRouteSnapshotRuntimeAvailability } from "../src/lib/video-generation/video-route-selection";
import { __resetShuyuRuntimeProbeForTests } from "../src/lib/video-generation/shuyu-runtime";

/**
 * P03-A1 · final 档(1080P)在批量入口的闸门。
 *
 * 真机 /prices 形态(1026 六档),fetch 整体打桩、db 只打桩到读模板为止:
 * 零网络、零库、零供应商提交。batch-service 本身不改——客户显式传 final planId 由
 * resolveShuyuVideoPlan 的 allowFinal 闸门拒绝;价目表只剩 final 由 runtime 探针判停机。
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

function marketPrices(onlyFinal = false) {
  const plans = [
    { ...PLAN_BASE, plan_id: "video-plan-01", unit: "generation", resolution: "720P", sale_points: 700 },
    { ...PLAN_BASE, plan_id: "video-plan-03", unit: "second", resolution: "720P", sale_points: 88 },
    { ...PLAN_BASE, plan_id: "video-plan-07", unit: "second", resolution: "480P", sale_points: 68 },
    { ...PLAN_BASE, plan_id: "video-plan-13", unit: "second", resolution: "1080P", sale_points: 240 },
    { ...PLAN_BASE, plan_id: "video-plan-15", unit: "second", resolution: "1080P", sale_points: 240 },
  ];
  return onlyFinal ? plans.filter((plan) => plan.resolution === "1080P") : plans;
}

const TEMPLATE: StyleTemplate = {
  id: "tpl_tier_gate",
  slug: "tier-gate",
  version: 1,
  name: "Tier Gate",
  nameZh: "分档闸门",
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
  userId: "tier-gate-user",
  templateId: TEMPLATE.id,
  templateVersion: TEMPLATE.version,
  images: [{ id: "img-1", url: "https://cdn.example.test/product.jpg" }],
  requestedCount: 2,
  idempotencyKey: "tier-gate-idempotency-key",
  videoRouteId: "buddy",
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

/// 非生产、真实引擎、客户线路 = buddy;SHUYU_ALLOW_FINAL_TIER 明确不设。
function realBuddyEnv(t: TestContext) {
  const values: Record<string, string | undefined> = {
    VERCEL_ENV: "preview",
    VIDEO_PROVIDER: "byteplus",
    VIDEO_ENGINE_MOCK: "false",
    AIVORA_DRY_RUN: "false",
    SHUYU_API_KEY: "test-only",
    SHUYU_ALLOW_FINAL_TIER: undefined,
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

/// 整体接管 globalThis.fetch:batch-service 内部的 /prices、/account/balance 探针都走它;
/// 任何 POST /videos/generations 都被记下来(期望恒为零)。
function stubShuyuFetch(t: TestContext, plans: ReturnType<typeof marketPrices>) {
  const submissions: Array<Record<string, unknown>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      return new Response(
        JSON.stringify({
          object: "service_health",
          status: "operational",
          capabilities: { image: "available", video: "available" },
          checked_at: "2026-10-26T02:00:00.000Z",
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/prices")) {
      return new Response(JSON.stringify({ object: "list", data: plans }), { status: 200 });
    }
    if (url.endsWith("/account/balance")) {
      return new Response(
        JSON.stringify({ object: "balance", available_points: 100_000, unit: "points" }),
        { status: 200 },
      );
    }
    if (url.endsWith("/videos/generations")) {
      submissions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ task_id: "task_must_not_happen" }), { status: 201 });
    }
    throw new Error(`unexpected network call in tier-gate test: ${url}`);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  return submissions;
}

function stubBatchReads(t: TestContext) {
  const touched = { transactions: 0 };
  patch(t, db.batchJob as unknown as Record<string, unknown>, {
    findUnique: async () => null,
  });
  patch(t, db.styleTemplate as unknown as Record<string, unknown>, {
    findFirst: async () => TEMPLATE,
  });
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async () => {
      touched.transactions += 1;
      throw new Error("tier gate must reject before any batch is created");
    },
  });
  return touched;
}

test("客户显式传 1080P planId:createBatchJob 抛 BatchProviderInputError(422),零提交、零事务", async (t) => {
  realBuddyEnv(t);
  const submissions = stubShuyuFetch(t, marketPrices());
  const touched = stubBatchReads(t);

  await assert.rejects(
    () => createBatchJob({ ...INPUT, videoPlanId: "video-plan-13" }),
    (error: unknown) =>
      error instanceof BatchProviderInputError &&
      error.httpStatus === 422 &&
      /已下架或暂不可用/.test(error.message),
  );
  assert.equal(submissions.length, 0, "createShuyuVideoTask 零调用");
  assert.equal(touched.transactions, 0, "不建批次");

  /// 同一夹具下 draft planId 走得通:闸门拦的是档位,不是「显式选套餐」本身。
  /// (走到建批次事务前就被我们的桩拦下 —— 说明套餐校验与可用性都通过了。)
  await assert.rejects(
    () => createBatchJob({ ...INPUT, idempotencyKey: "tier-gate-draft-key", videoPlanId: "video-plan-03" }),
    /must reject before any batch is created/,
  );
  assert.equal(touched.transactions, 1);
  assert.equal(submissions.length, 0);
});

test("价目表只剩 1080P:runtime 可用性 = price_contract_mismatch,createBatchJob 被拒且不建批次", async (t) => {
  realBuddyEnv(t);
  const submissions = stubShuyuFetch(t, marketPrices(true));
  const touched = stubBatchReads(t);

  /// 直接问 runtime(显式 fetchImpl,不走缓存):只剩 final 档 = 契约未就位。
  const availability = await getVideoRouteSnapshotRuntimeAvailability({
    snapshot: createVideoRouteSnapshot("buddy"),
    env: { SHUYU_API_KEY: "test-only" },
    fetchImpl: globalThis.fetch,
    shuyuRequiredPoints: 700,
  });
  assert.deepEqual(availability, {
    available: false,
    funded: true,
    reason: "price_contract_mismatch",
  });

  /// 批量入口:默认解析在 draft 内取不到套餐 → 没有成本快照;随后可用性探针判停机,
  /// 以 VideoGenerationRuntimeUnavailableError(shuyu_unavailable)拒绝,不是建出一个无价批次。
  await assert.rejects(
    () => createBatchJob(INPUT),
    (error: unknown) =>
      error instanceof VideoGenerationRuntimeUnavailableError &&
      error.reason === "shuyu_unavailable",
  );
  assert.equal(submissions.length, 0);
  assert.equal(touched.transactions, 0);
});
