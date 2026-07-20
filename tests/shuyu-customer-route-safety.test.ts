import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { publicVideoRouteOptionsResponseSchema } from "../src/lib/contracts/video-route-options";
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
    defaultRouteId: "volcengine_cn_legacy",
    routes: [
      {
        id: "volcengine_cn_legacy",
        provider: "direct",
        displayName: "火山 Seedance 直连",
        model: "doubao-seedance-2-0-260128",
        resolution: null,
        configured: true,
        funded: null,
        available: true,
        unavailableReason: null,
      },
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

  const staffPayload = publicVideoRouteOptionsResponseSchema.parse({
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
  });
  assert.equal(staffPayload.routes.length, 3);
  assert.equal(
    staffPayload.routes.find((route) => route.id === "byteplus_international")
      ?.available,
    false,
  );
  assert.throws(() =>
    publicVideoRouteOptionsResponseSchema.parse({
      ...staffPayload,
      routes: [
        staffPayload.routes[0],
        staffPayload.routes[0],
        staffPayload.routes[1],
      ],
    }),
  );
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
  assert.match(
    source.slice(availabilityIndex, quotaIndex),
    /code:\s*"SERVICE_UNAVAILABLE"[\s\S]*?action:\s*"retry"/,
  );
  assert.match(
    source,
    /batchCount\s*\*\s*SHUYU_VIDEO_POINTS_PER_GENERATION/,
  );
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
