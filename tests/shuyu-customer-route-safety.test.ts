import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  publicVideoPlanOptionSchema,
  publicVideoRouteOptionsResponseSchema,
} from "../src/lib/contracts/video-route-options";
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

test("routes API:final 档(1080P)只对内部员工返回;客户清单只剩 draft;显示名按档位出", async () => {
  /// P03-A1:1080P 客户定价未定。客户面 GET /api/video-generation/routes 不得返回
  /// tier="final" 的套餐;员工判定与 requireOperator 同口径(isInternalRole)。
  const source = await readFile("src/app/api/video-generation/routes/route.ts", "utf8");
  assert.match(source, /isInternalRole\(guard\.session\.user\.role\)/);
  assert.match(source, /auditedPlans\.filter\(\(plan\) => plan\.tier === "draft"\)/);
  assert.match(source, /tier: plan\.tier/);
  assert.doesNotMatch(source, /Seedance 720P"/, "显示名不再写死 720P");
  /// 默认档仍取清单首位(排序保证 draft 的 720P 在前),六处默认成本口径之一。
  assert.match(source, /const defaultPlan = plans\[0\]/);

  /// 公开契约:1080P/final 可表达(给员工看),未知档位与 4K 一律拒绝。
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
  const availabilityIndex = source.indexOf(
    "await getVideoRouteSnapshotRuntimeAvailability",
  );
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
  const availabilityIndex = batchSource.indexOf(
    "await getVideoRouteSnapshotRuntimeAvailability",
  );
  assert.equal(
    batchSource.match(/await getVideoRouteSnapshotRuntimeAvailability/g)?.length,
    1,
  );
  assert.ok(replayIndex < availabilityIndex);
  const transactionIndex = batchSource.indexOf("return await db.$transaction");
  assert.ok(replayIndex > 0 && replayIndex < availabilityIndex);
  assert.ok(availabilityIndex < transactionIndex);
  assert.match(batchSource, /合作方线路只接受 HTTPS 图片地址/);
  assert.match(batchSource, /mergedPrompt\.length > 5_000/);
});
