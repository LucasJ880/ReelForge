import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  publicVideoPlanOptionSchema,
  publicVideoRouteOptionsResponseSchema,
} from "../src/lib/contracts/video-route-options";
import { __testVideoPlans__ } from "../src/lib/providers/shuyu";
import { loadPublicVideoRouteOptions } from "../src/lib/services/video-route-options-service";
import { createVideoRouteSnapshot } from "../src/lib/video-generation/video-route-registry";
import {
  getVideoRouteSnapshotRuntimeAvailability,
  selectVideoRouteSnapshot,
} from "../src/lib/video-generation/video-route-selection";

test("ordinary authenticated customer can persist the audited Shuyu snapshot", () => {
  const snapshot = selectVideoRouteSnapshot({
    requestedRouteId: "buddy",
    isInternalStaff: false,
    env: {
      VIDEO_PROVIDER: "byteplus",
      VIDEO_ENGINE_MOCK: "false",
      SEEDANCE_RUNTIME_PROFILE: "volcengine_cn_legacy",
    },
  });
  assert.deepEqual(snapshot, {
    videoRouteSnapshot: "buddy",
    videoModelSnapshot: "studio-video",
    videoProviderAdapterSnapshot: "shuyu",
  });
});

test("customer-facing dispatch routes never grant staff a legacy provider override", async () => {
  const [singleRoute, batchRoute] = await Promise.all([
    readFile("src/app/api/video-generation/dispatch/route.ts", "utf8"),
    readFile("src/app/api/batches/route.ts", "utf8"),
  ]);
  assert.match(singleRoute, /selectVideoRouteSnapshot\(\{[\s\S]{0,320}isInternalStaff:\s*false/);
  assert.match(batchRoute, /createBatchJob\(\{[\s\S]{0,520}isInternalStaff:\s*false/);
  assert.doesNotMatch(singleRoute, /mayOverrideVideoRoute/);
});

test("zero Shuyu balance is unavailable before submission and exposes no raw balance", async () => {
  const availability = await getVideoRouteSnapshotRuntimeAvailability({
    snapshot: createVideoRouteSnapshot("buddy"),
    env: { SHUYU_API_KEY: "configured" },
    shuyuRequiredPoints: 1_560,
    fetchImpl: async (input) =>
      String(input).endsWith("/health")
        ? new Response(
            JSON.stringify({
              object: "service_health",
              status: "operational",
              capabilities: { image: "available", video: "available" },
              checked_at: "2026-07-19T02:00:00.000Z",
            }),
            { status: 200 },
          )
        : String(input).endsWith("/prices")
        ? new Response(
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
          )
        : new Response(
            JSON.stringify({
              object: "balance",
              available_points: 0,
              unit: "points",
            }),
            { status: 200 },
          ),
  });
  assert.deepEqual(availability, {
    available: false,
    funded: false,
    reason: "insufficient_balance",
  });

  const publicPayload = publicVideoRouteOptionsResponseSchema.parse({
    ok: true,
    defaultRouteId: "buddy",
    routes: [
      {
        id: "buddy",
        provider: "shuyu",
        displayName: "合作方 Shuyu · Seedance 720P",
        model: "studio-video",
        resolution: "720P",
        configured: true,
        funded: false,
        available: false,
        unavailableReason: "insufficient_balance",
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(publicPayload), /available_points|balance_points/);

  assert.throws(() =>
    publicVideoRouteOptionsResponseSchema.parse({
    ...publicPayload,
    routes: [
      ...publicPayload.routes,
      {
        id: "byteplus_international",
        provider: "direct",
        displayName: "BytePlus Seedance 直连",
        model: "dreamina-seedance-2-0-260128",
        resolution: null,
        configured: false,
        funded: null,
        available: false,
        unavailableReason: "not_configured",
      },
    ],
    }),
  );
});

/// 1026 实价六档:720P 700/条(默认)、720P 88/秒、720P 104/秒、480P 68/秒、1080P 240/秒 ×2(final)。
function marketPrices(filter: (plan: { resolution: string }) => boolean = () => true) {
  const base = {
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
  return [
    { ...base, plan_id: "video-plan-15", unit: "second", resolution: "1080P", sale_points: 240 },
    { ...base, plan_id: "video-plan-01", unit: "generation", resolution: "720P", sale_points: 700 },
    { ...base, plan_id: "video-plan-03", unit: "second", resolution: "720P", sale_points: 88 },
    { ...base, plan_id: "video-plan-04", unit: "second", resolution: "720P", sale_points: 104 },
    { ...base, plan_id: "video-plan-07", unit: "second", resolution: "480P", sale_points: 68 },
    { ...base, plan_id: "video-plan-13", unit: "second", resolution: "1080P", sale_points: 240 },
  ].filter(filter);
}

function shuyuFetch(plans: ReturnType<typeof marketPrices>, availablePoints: number): typeof fetch {
  return async (input) => {
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
    assert.ok(url.endsWith("/account/balance"), `routes API 只读 health / prices / balance,实际 ${url}`);
    return new Response(
      JSON.stringify({ object: "balance", available_points: availablePoints, unit: "points" }),
      { status: 200 },
    );
  };
}

test("routes API:客户只见 draft 档,员工见全部;两边默认档与预检成本都是 720P(1026 六档夹具)", async () => {
  /// 余额 1_000:够 720P 默认档(700)、不够 1080P(3_600)。若预检成本误取 final,这里会变成
  /// insufficient_balance。
  const load = (internalStaff: boolean) =>
    loadPublicVideoRouteOptions({
      internalStaff,
      env: { SHUYU_API_KEY: "test-only" },
      fetchImpl: shuyuFetch(marketPrices(), 1_000),
    });
  __testVideoPlans__.resetVideoPlanCache();
  try {
    const customer = await load(false);
    const customerRoute = customer.routes[0];
    assert.equal(customerRoute.available, true);
    assert.equal(customerRoute.unavailableReason, null);
    assert.equal(customerRoute.displayName, "Aivora 视频通道 · Seedance 720P");
    assert.equal(customerRoute.resolution, "720P");
    assert.deepEqual(
      customerRoute.plans.map((plan) => plan.planId),
      ["video-plan-01", "video-plan-03", "video-plan-04", "video-plan-07"],
      "客户清单只剩 draft 档,顺序 720P → 480P",
    );
    assert.ok(customerRoute.plans.every((plan) => plan.tier === "draft"));
    assert.ok(!JSON.stringify(customer).includes("1080P"), "客户 payload 里不得出现 1080P");
    assert.deepEqual(
      customerRoute.plans.filter((plan) => plan.isDefault).map((plan) => plan.planId),
      ["video-plan-01"],
    );

    __testVideoPlans__.resetVideoPlanCache();
    const staff = await load(true);
    const staffRoute = staff.routes[0];
    assert.equal(staffRoute.available, true, "员工的预检成本同样按 720P 默认档算");
    assert.equal(staffRoute.displayName, "Aivora 视频通道 · Seedance 720P");
    assert.equal(staffRoute.resolution, "720P");
    assert.deepEqual(
      staffRoute.plans.map((plan) => [plan.planId, plan.tier]),
      [
        ["video-plan-01", "draft"],
        ["video-plan-03", "draft"],
        ["video-plan-04", "draft"],
        ["video-plan-07", "draft"],
        ["video-plan-13", "final"],
        ["video-plan-15", "final"],
      ],
    );
    assert.deepEqual(
      staffRoute.plans.filter((plan) => plan.isDefault).map((plan) => plan.planId),
      ["video-plan-01"],
      "final 档即使对员工可见也不是默认",
    );
    const staffFinal = staffRoute.plans.find((plan) => plan.planId === "video-plan-13");
    assert.equal(staffFinal?.pointsPer15s, 3_600);
  } finally {
    __testVideoPlans__.resetVideoPlanCache();
  }
});

test("routes API:价目表只剩 1080P 时,客户清单为空、员工无默认档,线路 price_contract_mismatch", async () => {
  __testVideoPlans__.resetVideoPlanCache();
  try {
    const onlyFinal = marketPrices((plan) => plan.resolution === "1080P");
    const customer = await loadPublicVideoRouteOptions({
      internalStaff: false,
      env: { SHUYU_API_KEY: "test-only" },
      fetchImpl: shuyuFetch(onlyFinal, 100_000),
    });
    assert.deepEqual(customer.routes[0].plans, []);
    assert.equal(customer.routes[0].available, false);
    assert.equal(customer.routes[0].unavailableReason, "price_contract_mismatch");

    __testVideoPlans__.resetVideoPlanCache();
    const staff = await loadPublicVideoRouteOptions({
      internalStaff: true,
      env: { SHUYU_API_KEY: "test-only" },
      fetchImpl: shuyuFetch(onlyFinal, 100_000),
    });
    assert.equal(staff.routes[0].available, false);
    assert.equal(staff.routes[0].unavailableReason, "price_contract_mismatch");
    assert.deepEqual(staff.routes[0].plans.map((plan) => plan.tier), ["final", "final"]);
    assert.ok(staff.routes[0].plans.every((plan) => plan.isDefault === false), "没有 draft 就没有默认档");
  } finally {
    __testVideoPlans__.resetVideoPlanCache();
  }
});

test("routes API 路由层只做鉴权:员工判定与 requireOperator 同口径,业务委托 service", async () => {
  const source = await readFile("src/app/api/video-generation/routes/route.ts", "utf8");
  assert.match(source, /isInternalRole\(guard\.session\.user\.role\)/);
  assert.match(source, /loadPublicVideoRouteOptions\(/);
  assert.doesNotMatch(source, /Seedance 720P"/, "显示名不再写死 720P");

  /// 公开契约:1080P/final 可表达(给员工看),未知档位与 4K 一律拒绝;
  /// 单价按 resolution × unit 调审计同一张表。
  const finalOption = publicVideoPlanOptionSchema.parse({
    planId: "video-plan-13",
    displayName: "视频-Seedance2.0-1080P-推荐1",
    resolution: "1080P",
    tier: "final",
    billingUnit: "second",
    unitSalePoints: 240,
    pointsPer15s: 3_600,
    isDefault: false,
  });
  assert.equal(finalOption.tier, "final");
  assert.throws(() => publicVideoPlanOptionSchema.parse({ ...finalOption, tier: "premium" }));
  assert.throws(() => publicVideoPlanOptionSchema.parse({ ...finalOption, resolution: "4K" }));
  assert.throws(
    () => publicVideoPlanOptionSchema.parse({ ...finalOption, unitSalePoints: 500 }),
    /outside the audited range for 1080P/,
  );
  assert.throws(() =>
    publicVideoPlanOptionSchema.parse({
      ...finalOption,
      resolution: "720P",
      tier: "draft",
      billingUnit: "generation",
      unitSalePoints: 5_000,
    }),
  );
  /// tier 可选:旧客户端/旧 payload 缺失时仍能解析。
  const { tier: _omitted, ...withoutTier } = finalOption;
  void _omitted;
  assert.equal(publicVideoPlanOptionSchema.parse(withoutTier).tier, undefined);
});

test("direct dispatch replays before provider checks and checks the whole batch before quota", async () => {
  const source = await readFile(
    "src/app/api/video-generation/dispatch/route.ts",
    "utf8",
  );
  const availabilityIndex = source.indexOf("await resolveRouteWithFailover");
  const claimIndex = source.indexOf("await claimVideoDispatchRequest");
  const quotaIndex = source.indexOf("await assertQuotaBatchForSession");
  assert.ok(availabilityIndex > 0);
  assert.ok(claimIndex < availabilityIndex);
  assert.ok(quotaIndex > availabilityIndex);
  const availabilityBlock = source.slice(availabilityIndex, quotaIndex);
  assert.match(
    availabilityBlock,
    /code:\s*"SERVICE_UNAVAILABLE"[\s\S]*?action:\s*"retry"/,
  );
  /// 0803 起单支计价由 /prices 实时解析;预检仍必须按 batchCount 放大,
  /// 且单支价必须来自审计套餐解析,不允许退回固定常量。
  assert.match(source, /batchCount\s*\*\s*buddyPerVideoPoints/);
  assert.match(source, /resolveShuyuVideoPlan\(/);
  assert.doesNotMatch(
    source,
    /batchCount\s*\*\s*SHUYU_VIDEO_POINTS_PER_GENERATION/,
  );
  assert.doesNotMatch(source, /切换火山线路|切换线路/);
  assert.match(availabilityBlock, /稍后重试；若持续发生，请联系支持/);
});

test("Shuyu adapters preserve content review and batch provider preflight boundaries", async () => {
  const [providerSource, batchSource] = await Promise.all([
    readFile(
      "src/lib/video-generation/providers/shuyu-video-provider.ts",
      "utf8",
    ),
    readFile("src/lib/services/batch-service.ts", "utf8"),
  ]);
  const reviewIndex = providerSource.indexOf("await reviewTextOrThrow");
  const submitIndex = providerSource.indexOf("await createShuyuVideoTask");
  assert.ok(reviewIndex > 0 && reviewIndex < submitIndex);

  const replayIndex = batchSource.indexOf("if (existing)");
  const availabilityIndex = batchSource.indexOf("await resolveRouteWithFailover");
  assert.equal(batchSource.match(/await resolveRouteWithFailover/g)?.length, 1);
  assert.match(batchSource, /allowFailover:\s*false/);
  assert.ok(replayIndex < availabilityIndex);
  const transactionIndex = batchSource.indexOf("return await db.$transaction");
  assert.ok(replayIndex > 0 && replayIndex < availabilityIndex);
  assert.ok(availabilityIndex < transactionIndex);
  assert.match(batchSource, /合作方线路只接受 HTTPS 图片地址/);
  assert.match(batchSource, /mergedPrompt\.length > 5_000/);
});
