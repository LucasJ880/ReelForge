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
  selectVideoRouteSnapshot,
  STAFF_SELECTABLE_VIDEO_ROUTE_IDS,
  VideoRouteSelectionError,
} from "../src/lib/video-generation/video-route-selection";

/**
 * Runway 线路（2026-10-28，CEO 批）：注册、取适配器、客户线路开关、运行就绪。
 * 客户默认是 buddy（Shuyu）；VIDEO_CUSTOMER_ROUTE=runway 全员切；10-29 起客户可主动选「高质量」= Runway。
 *
 * 2026-11-16 CEO：Runway 出片彻底下线（runway-rollout.ts 的 RUNWAY_RETIRED）。入口四个全关、不看环境变量；
 * 注册、适配器与历史快照读取保留（下线前交给 Runway 的任务还要查结果）。下面的入口用例改成守「打不开」。
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

test("Runway 下线后的客户线路：任何开关下都是 buddy；点名 runway 或直连线路一律拒绝", () => {
  const everySwitchOn = {
    ...REAL,
    VIDEO_CUSTOMER_ROUTE: "runway",
    RUNWAYML_API_SECRET: "key",
    RUNWAY_PREMIUM: "on",
    RUNWAY_PILOT_ACCOUNTS: "ceo.test@example.com",
  };
  for (const env of [REAL, { ...REAL, VIDEO_CUSTOMER_ROUTE: "something-else" }, everySwitchOn]) {
    assert.equal(customerVideoRouteId(env), "buddy");
    assert.equal(selectCustomerVideoRouteSnapshot({ env }).videoRouteSnapshot, "buddy");
    assert.equal(selectCustomerVideoRouteSnapshot({ env, requestedRouteId: "buddy" }).videoRouteSnapshot, "buddy");
    assert.throws(
      () => selectCustomerVideoRouteSnapshot({ env, requestedRouteId: "runway", account: { email: "ceo.test@example.com" } }),
      VideoRouteSelectionError,
    );
    assert.throws(
      () => selectCustomerVideoRouteSnapshot({ env, requestedRouteId: "byteplus_international" }),
      VideoRouteSelectionError,
    );
  }
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
  /// 11-16 下线：内部也不能再点名 runway
  assert.equal((STAFF_SELECTABLE_VIDEO_ROUTE_IDS as readonly string[]).includes("runway"), false);
  assert.throws(
    () => selectVideoRouteSnapshot({ isInternalStaff: true, requestedRouteId: "runway", env: { ...REAL, RUNWAYML_API_SECRET: "key" } }),
    VideoRouteSelectionError,
  );
});

test("计价与分辨率：runway 不记合作方积分；出片默认 720p，显式配置才出 1080p", async () => {
  assert.equal(await resolveVideoRouteUnitPoints("runway"), null);
  assert.equal(runwayVideoResolution({}), "720p");
  assert.equal(runwayVideoResolution({ RUNWAY_VIDEO_RESOLUTION: "1080P" }), "1080p");
  assert.equal(runwayVideoResolution({ RUNWAY_VIDEO_RESOLUTION: "4k" }), "720p");
});

test("Runway 下线后：名单与开关只剩读法，全员切换、故事板出图、「高质量」选项、失败改交四个入口都打不开", async () => {
  const {
    RUNWAY_RETIRED,
    canChooseRunwayPremium,
    isRunwayPilotAccount,
    runwayPremiumMode,
    shuyuFallbackToRunwayEnabled,
    usesRunwayStoryboardImages,
    usesRunwayVideo,
  } = await import("../src/lib/video-generation/runway-rollout");
  assert.equal(RUNWAY_RETIRED, true);
  const env = {
    ...REAL,
    VIDEO_CUSTOMER_ROUTE: "runway",
    RUNWAYML_API_SECRET: "key",
    RUNWAY_PILOT_ACCOUNTS: " CEO.Test@Example.com , user_42 ",
  };
  /// 解析函数照旧（留给历史数据与排查用）
  assert.equal(isRunwayPilotAccount({ email: "ceo.test@example.com" }, env), true);
  assert.equal(isRunwayPilotAccount({ userId: "user_42" }, env), true);
  assert.equal(isRunwayPilotAccount({ email: "someone@example.com", userId: "user_7" }, env), false);
  assert.equal(isRunwayPilotAccount(null, env), false);
  assert.equal(runwayPremiumMode(env), "on");
  assert.equal(runwayPremiumMode({ ...env, RUNWAY_PREMIUM: "pilot" }), "pilot");
  /// 四个入口：开关全开、key 配着、账号在名单里，也一律关
  const ceo = { email: "CEO.test@example.com", userId: "user_42" };
  for (const premium of [undefined, "on", "pilot"]) {
    const switched = { ...env, ...(premium ? { RUNWAY_PREMIUM: premium } : {}) };
    assert.equal(usesRunwayVideo(switched), false);
    assert.equal(usesRunwayStoryboardImages(ceo, switched), false);
    assert.equal(canChooseRunwayPremium(ceo, switched), false);
    assert.equal(shuyuFallbackToRunwayEnabled(switched), false);
  }
});

test("降级：下线前交给 Runway 的任务失败仍改交 Shuyu（Shuyu 没配也不硬降）；Shuyu 自己没有备用线路", async () => {
  const { customerFailoverRouteSnapshot } = await import("../src/lib/video-generation/video-route-selection");
  assert.equal(customerFailoverRouteSnapshot({ ...REAL, SHUYU_API_KEY: "shuyu" }, "runway")?.videoRouteSnapshot, "buddy");
  assert.equal(customerFailoverRouteSnapshot({ ...REAL }, "runway"), null);
  /// 11-16 Runway 下线：key 还配着、开关没关，Shuyu 也不再改交 Runway
  assert.equal(customerFailoverRouteSnapshot({ ...REAL, RUNWAYML_API_SECRET: "key" }, "buddy"), null);
  assert.equal(
    customerFailoverRouteSnapshot({ ...REAL, RUNWAYML_API_SECRET: "key", SHUYU_FALLBACK_TO_RUNWAY: "on" }, "buddy"),
    null,
  );
  assert.equal(customerFailoverRouteSnapshot({ ...REAL }, "buddy"), null);
});
