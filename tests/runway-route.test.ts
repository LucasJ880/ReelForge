import assert from "node:assert/strict";
import test from "node:test";
import { runwayVideoResolution } from "../src/lib/providers/runway";
import { createVideoProviderByRouteSnapshot } from "../src/lib/video-generation/providers";
import { RunwayVideoProvider } from "../src/lib/video-generation/providers/runway-video-provider";
import { resolveVideoRouteUnitPoints } from "../src/lib/video-generation/video-route-cost";
import {
  createVideoRouteSnapshot,
  readVideoRouteSnapshot,
  VIDEO_ROUTE_IDS,
} from "../src/lib/video-generation/video-route-registry";
import {
  canVideoRouteOverrideDefaultRuntimeFailure,
  customerVideoRouteId,
  isVideoRouteSnapshotRuntimeReady,
  selectCustomerVideoRouteSnapshot,
  STAFF_SELECTABLE_VIDEO_ROUTE_IDS,
  VideoRouteSelectionError,
} from "../src/lib/video-generation/video-route-selection";

/**
 * Runway 线路（2026-10-28，CEO 批，key 未到）：注册、取适配器、客户线路开关、运行就绪。
 * 客户默认仍是 buddy；VIDEO_CUSTOMER_ROUTE=runway 才切。真机验收等 key。
 */

const REAL = { VIDEO_ENGINE_MOCK: "false", VIDEO_PROVIDER: "shuyu" };

test("注册：runway 线路 = Runway 适配器 + Seedance 2.5；快照能读回、能取到对应适配器", () => {
  assert.ok(VIDEO_ROUTE_IDS.includes("runway"));
  const snapshot = createVideoRouteSnapshot("runway");
  assert.deepEqual(snapshot, {
    videoRouteSnapshot: "runway",
    videoModelSnapshot: "seedance2_5",
    videoProviderAdapterSnapshot: "runway",
  });
  const read = readVideoRouteSnapshot(snapshot);
  assert.equal(read.state, "persisted");
  const provider = createVideoProviderByRouteSnapshot(snapshot);
  assert.ok(provider instanceof RunwayVideoProvider);
  assert.equal(provider.id, "runway");
  assert.equal(provider.maxReferenceImages, 30);
  assert.throws(() => createVideoProviderByRouteSnapshot({ ...snapshot, videoProviderAdapterSnapshot: "shuyu" }), /incompatible adapter/);
  assert.throws(() => createVideoProviderByRouteSnapshot({ ...snapshot, videoModelSnapshot: "gen9" }), /unknown model/);
});

test("客户线路开关：缺省 buddy；VIDEO_CUSTOMER_ROUTE=runway 才切；点名 buddy 的旧调用方照样放行", () => {
  assert.equal(customerVideoRouteId(REAL), "buddy");
  assert.equal(customerVideoRouteId({ ...REAL, VIDEO_CUSTOMER_ROUTE: "something-else" }), "buddy");
  assert.equal(selectCustomerVideoRouteSnapshot({ env: REAL }).videoRouteSnapshot, "buddy");
  const runwayEnv = { ...REAL, VIDEO_CUSTOMER_ROUTE: "runway" };
  assert.equal(selectCustomerVideoRouteSnapshot({ env: runwayEnv }).videoRouteSnapshot, "runway");
  assert.equal(selectCustomerVideoRouteSnapshot({ env: runwayEnv, requestedRouteId: "buddy" }).videoRouteSnapshot, "buddy");
  assert.equal(selectCustomerVideoRouteSnapshot({ env: runwayEnv, requestedRouteId: "runway" }).videoRouteSnapshot, "runway");
  /// 没切过去时客户不能自己点名 runway；任何时候都不能点名直连线路
  assert.throws(() => selectCustomerVideoRouteSnapshot({ env: REAL, requestedRouteId: "runway" }), VideoRouteSelectionError);
  assert.throws(
    () => selectCustomerVideoRouteSnapshot({ env: runwayEnv, requestedRouteId: "byteplus_international" }),
    VideoRouteSelectionError,
  );
});

test("运行就绪：runway 只看 RUNWAYML_API_SECRET；默认运行时的 Shuyu / Seedance 配置问题不拦它", () => {
  const snapshot = createVideoRouteSnapshot("runway");
  assert.equal(isVideoRouteSnapshotRuntimeReady(snapshot, REAL), false);
  assert.equal(isVideoRouteSnapshotRuntimeReady(snapshot, { ...REAL, RUNWAYML_API_SECRET: "key" }), true);
  assert.equal(canVideoRouteOverrideDefaultRuntimeFailure(snapshot, "shuyu_key_missing"), true);
  assert.equal(canVideoRouteOverrideDefaultRuntimeFailure(snapshot, "byteplus_key_missing"), true);
  /// 内容审核与 mock 封印永远不能绕
  assert.equal(canVideoRouteOverrideDefaultRuntimeFailure(snapshot, "content_review_key_missing"), false);
  assert.equal(canVideoRouteOverrideDefaultRuntimeFailure(snapshot, "production_mock_forbidden"), false);
  assert.ok((STAFF_SELECTABLE_VIDEO_ROUTE_IDS as readonly string[]).includes("runway"));
});

test("计价与分辨率：runway 不记合作方积分；出片默认 720p，显式配置才出 1080p", async () => {
  assert.equal(await resolveVideoRouteUnitPoints("runway"), null);
  assert.equal(runwayVideoResolution({}), "720p");
  assert.equal(runwayVideoResolution({ RUNWAY_VIDEO_RESOLUTION: "1080P" }), "1080p");
  assert.equal(runwayVideoResolution({ RUNWAY_VIDEO_RESOLUTION: "4k" }), "720p");
});

test("灰度名单：名单里的账号（邮箱不分大小写或 user id）走 Runway，其余照旧 Shuyu；全员开关优先", async () => {
  const { isRunwayPilotAccount, usesRunwayStoryboardImages } = await import("../src/lib/video-generation/runway-rollout");
  const env = { ...REAL, RUNWAY_PILOT_ACCOUNTS: " CEO.Test@Example.com , user_42 " };
  assert.equal(isRunwayPilotAccount({ email: "ceo.test@example.com" }, env), true);
  assert.equal(isRunwayPilotAccount({ userId: "user_42" }, env), true);
  assert.equal(isRunwayPilotAccount({ email: "someone@example.com", userId: "user_7" }, env), false);
  assert.equal(isRunwayPilotAccount(null, env), false);
  assert.equal(customerVideoRouteId(env, { email: "ceo.test@example.com" }), "runway");
  assert.equal(customerVideoRouteId(env, { email: "someone@example.com" }), "buddy");
  assert.equal(
    selectCustomerVideoRouteSnapshot({ env, account: { userId: "user_42" } }).videoRouteSnapshot,
    "runway",
  );
  /// 全员开关打开时名单失效（人人都是 Runway）
  assert.equal(customerVideoRouteId({ ...env, VIDEO_CUSTOMER_ROUTE: "runway" }, { email: "someone@example.com" }), "runway");
  /// 故事板出图还要有 key：没 key 留在 Shuyu
  assert.equal(usesRunwayStoryboardImages({ userId: "user_42" }, env), false);
  assert.equal(usesRunwayStoryboardImages({ userId: "user_42" }, { ...env, RUNWAYML_API_SECRET: "key" }), true);
});

test("降级：Runway 主线路不可用时降到 Shuyu（Shuyu 没配也不硬降）；其余主线路照旧", async () => {
  const { customerFailoverRouteSnapshot } = await import("../src/lib/video-generation/video-route-selection");
  assert.equal(customerFailoverRouteSnapshot({ ...REAL, SHUYU_API_KEY: "shuyu" }, "runway")?.videoRouteSnapshot, "buddy");
  assert.equal(customerFailoverRouteSnapshot({ ...REAL }, "runway"), null);
});
