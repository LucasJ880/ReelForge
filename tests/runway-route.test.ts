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
 * Runway 线路（2026-10-28，CEO 批）：注册、取适配器、客户线路开关、运行就绪。
 * 客户默认是 buddy（Shuyu）；VIDEO_CUSTOMER_ROUTE=runway 全员切；10-29 起客户可主动选「高质量」= Runway。
 */

const REAL = { VIDEO_ENGINE_MOCK: "false", VIDEO_PROVIDER: "shuyu" };

test("注册：runway 线路 = Runway 适配器 + Kling O3 Pro；快照能读回、能取到对应适配器；换模型前的 Seedance 快照照常可读", () => {
  assert.ok(VIDEO_ROUTE_IDS.includes("runway"));
  const snapshot = createVideoRouteSnapshot("runway");
  /// 2026-10-28 灰度真机：Seedance 2.5 拦写实人脸参考图，故事板多半有人 → 线路换 Kling O3 Pro
  assert.deepEqual(snapshot, {
    videoRouteSnapshot: "runway",
    videoModelSnapshot: "klingO3_pro",
    videoProviderAdapterSnapshot: "runway",
  });
  const read = readVideoRouteSnapshot(snapshot);
  assert.equal(read.state, "persisted");
  const provider = createVideoProviderByRouteSnapshot(snapshot);
  assert.ok(provider instanceof RunwayVideoProvider);
  assert.equal(provider.id, "runway");
  /// 已落库的旧任务保留当时的模型，轮询 / 取消仍能拿到 Runway 适配器
  const legacy = { videoRouteSnapshot: "runway", videoModelSnapshot: "seedance2_5", videoProviderAdapterSnapshot: "runway" } as const;
  assert.equal(readVideoRouteSnapshot(legacy).videoModelSnapshot, "seedance2_5");
  assert.ok(createVideoProviderByRouteSnapshot(legacy) instanceof RunwayVideoProvider);
  assert.equal(createVideoProviderByRouteSnapshot(legacy).maxReferenceImages, 30);
  /// Kling：首帧之外最多 7 张参考（故事板 4 帧 + 3 张商品图）
  assert.equal(provider.maxReferenceImages, 7);
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

test("10-29 起默认一律 Shuyu：灰度名单不再改默认，只管名单账号的故事板出图；全员开关仍能整体切到 Runway", async () => {
  const { isRunwayPilotAccount, usesRunwayStoryboardImages } = await import("../src/lib/video-generation/runway-rollout");
  const env = { ...REAL, RUNWAY_PILOT_ACCOUNTS: " CEO.Test@Example.com , user_42 " };
  assert.equal(isRunwayPilotAccount({ email: "ceo.test@example.com" }, env), true);
  assert.equal(isRunwayPilotAccount({ userId: "user_42" }, env), true);
  assert.equal(isRunwayPilotAccount({ email: "someone@example.com", userId: "user_7" }, env), false);
  assert.equal(isRunwayPilotAccount(null, env), false);
  assert.equal(customerVideoRouteId(env), "buddy");
  assert.equal(
    selectCustomerVideoRouteSnapshot({ env, account: { userId: "user_42" } }).videoRouteSnapshot,
    "buddy",
    "名单账号不选高质量也是 Shuyu",
  );
  assert.equal(customerVideoRouteId({ ...env, VIDEO_CUSTOMER_ROUTE: "runway" }), "runway");
  /// 故事板出图与 10-28 一致：名单账号走 Runway，但要有 key
  assert.equal(usesRunwayStoryboardImages({ userId: "user_42" }, env), false);
  assert.equal(usesRunwayStoryboardImages({ userId: "user_42" }, { ...env, RUNWAYML_API_SECRET: "key" }), true);
});

test("高质量（Runway）选项：配了 key 缺省对所有客户开放；RUNWAY_PREMIUM=pilot 只给名单、=off 全关；没 key 一律不行", async () => {
  const { canChooseRunwayPremium, runwayPremiumMode } = await import("../src/lib/video-generation/runway-rollout");
  const keyed = { ...REAL, RUNWAYML_API_SECRET: "key", RUNWAY_PILOT_ACCOUNTS: "ceo.test@example.com" };
  const someone = { email: "someone@example.com" };
  const ceo = { email: "CEO.test@example.com" };
  assert.equal(runwayPremiumMode(keyed), "on");
  assert.equal(canChooseRunwayPremium(someone, keyed), true);
  assert.equal(
    selectCustomerVideoRouteSnapshot({ env: keyed, account: someone, requestedRouteId: "runway" }).videoRouteSnapshot,
    "runway",
  );
  assert.equal(selectCustomerVideoRouteSnapshot({ env: keyed, account: someone }).videoRouteSnapshot, "buddy", "不选就是 Shuyu");

  const pilotOnly = { ...keyed, RUNWAY_PREMIUM: "pilot" };
  assert.equal(runwayPremiumMode(pilotOnly), "pilot");
  assert.equal(canChooseRunwayPremium(someone, pilotOnly), false);
  assert.equal(canChooseRunwayPremium(ceo, pilotOnly), true);
  assert.throws(
    () => selectCustomerVideoRouteSnapshot({ env: pilotOnly, account: someone, requestedRouteId: "runway" }),
    VideoRouteSelectionError,
  );
  assert.equal(canChooseRunwayPremium(ceo, { ...keyed, RUNWAY_PREMIUM: "OFF" }), false);
  assert.equal(canChooseRunwayPremium(someone, REAL), false, "没 key 不开放");
});

test("降级：Runway 主线路不可用时降到 Shuyu（Shuyu 没配也不硬降）；其余主线路照旧", async () => {
  const { customerFailoverRouteSnapshot } = await import("../src/lib/video-generation/video-route-selection");
  assert.equal(customerFailoverRouteSnapshot({ ...REAL, SHUYU_API_KEY: "shuyu" }, "runway")?.videoRouteSnapshot, "buddy");
  assert.equal(customerFailoverRouteSnapshot({ ...REAL }, "runway"), null);
  /// 10-29：Shuyu 的备用是 Runway（配了 key、SHUYU_FALLBACK_TO_RUNWAY 没关）；否则照旧降到火山直连（这里没配 → null）
  assert.equal(customerFailoverRouteSnapshot({ ...REAL, RUNWAYML_API_SECRET: "key" }, "buddy")?.videoRouteSnapshot, "runway");
  assert.equal(
    customerFailoverRouteSnapshot({ ...REAL, RUNWAYML_API_SECRET: "key", SHUYU_FALLBACK_TO_RUNWAY: "off" }, "buddy"),
    null,
  );
  assert.equal(customerFailoverRouteSnapshot({ ...REAL }, "buddy"), null);
});
