import assert from "node:assert/strict";
import test from "node:test";
import {
  RETIRED_VIDEO_PROVIDER_ADAPTERS,
  RETIRED_VIDEO_ROUTE_IDS,
  VIDEO_ROUTE_IDS,
  VIDEO_ROUTE_REGISTRY,
  createVideoRouteSnapshot,
  getVideoRouteContract,
  isEnabledVideoRouteId,
  isRetiredVideoProviderAdapter,
  isRetiredVideoRouteId,
  readVideoRouteSnapshot,
} from "../src/lib/video-generation/video-route-registry";

test("video route registry explicitly allowlists audited routes", () => {
  assert.deepEqual(VIDEO_ROUTE_IDS, [
    "mock",
    "buddy",
    /// 下线、出片代码已删；只为读旧记录留着这三条登记（runway 2026-11-16，两条直连 Seedance 2026-11-17）
    "runway",
    "byteplus_international",
    "volcengine_cn_legacy",
  ]);
  assert.deepEqual(Object.keys(VIDEO_ROUTE_REGISTRY).sort(), [...VIDEO_ROUTE_IDS].sort());
  assert.equal(isEnabledVideoRouteId("mock"), true);
  assert.equal(isEnabledVideoRouteId("buddy"), true);
  /// 还能出片的只有 buddy（mock 只给本地联调）
  assert.deepEqual(
    VIDEO_ROUTE_IDS.filter((id) => isEnabledVideoRouteId(id)),
    ["mock", "buddy"],
  );
});

test("已下线的两条直连 Seedance 线路：登记只为读旧记录——线路 id、适配器名、模型、地区原样留着，但停用", () => {
  assert.deepEqual(getVideoRouteContract("byteplus_international"), {
    id: "byteplus_international",
    enabled: false,
    providerAdapter: "byteplus",
    model: "dreamina-seedance-2-0-260128",
    processingRegion: "ap-southeast",
  });
  assert.deepEqual(getVideoRouteContract("volcengine_cn_legacy"), {
    id: "volcengine_cn_legacy",
    enabled: false,
    providerAdapter: "byteplus",
    model: "doubao-seedance-2-0-260128",
    processingRegion: "cn-beijing",
  });
  assert.deepEqual([...RETIRED_VIDEO_PROVIDER_ADAPTERS], ["runway", "byteplus"]);
  for (const adapter of ["runway", "byteplus"]) assert.equal(isRetiredVideoProviderAdapter(adapter), true, adapter);
  for (const adapter of ["shuyu", "mock", "invented", null, undefined]) {
    assert.equal(isRetiredVideoProviderAdapter(adapter), false, String(adapter));
  }
  for (const routeId of ["byteplus_international", "volcengine_cn_legacy"] as const) {
    assert.equal(isRetiredVideoRouteId(routeId), true, routeId);
    assert.equal(isEnabledVideoRouteId(routeId), false, routeId);
    assert.throws(() => createVideoRouteSnapshot(routeId), new RegExp(`Video route ${routeId} is retired`));
  }
});

test("已下线的 runway 线路：登记只为读旧记录——旧快照照常读得出来，但不能建新快照", () => {
  assert.deepEqual(getVideoRouteContract("runway"), {
    id: "runway",
    enabled: false,
    providerAdapter: "runway",
    model: "klingO3_pro",
    processingRegion: null,
  });
  assert.deepEqual(RETIRED_VIDEO_ROUTE_IDS, ["runway", "byteplus_international", "volcengine_cn_legacy"]);
  assert.equal(isRetiredVideoRouteId("runway"), true);
  assert.equal(isEnabledVideoRouteId("runway"), false);
  for (const routeId of VIDEO_ROUTE_IDS.filter((id) => !RETIRED_VIDEO_ROUTE_IDS.includes(id))) {
    assert.equal(isRetiredVideoRouteId(routeId), false, routeId);
    assert.equal(isEnabledVideoRouteId(routeId), true, routeId);
  }
  assert.equal(isRetiredVideoRouteId(null), false);
  assert.equal(isRetiredVideoRouteId("invented"), false, "认不得的 id 不是「已下线」，是数据错误");

  /// 旧的 brief / 段任务 / 批次上记着的两种模型都读得出来，模型原样保留
  for (const model of ["klingO3_pro", "seedance2"]) {
    const read = readVideoRouteSnapshot({
      videoRouteSnapshot: "runway",
      videoModelSnapshot: model,
      videoProviderAdapterSnapshot: "runway",
    });
    assert.equal(read.state, "persisted");
    assert.equal(read.videoRouteSnapshot, "runway");
    assert.equal(read.videoModelSnapshot, model);
    assert.equal(read.videoProviderAdapterSnapshot, "runway");
    assert.equal(read.route?.enabled, false);
  }
  assert.throws(() => createVideoRouteSnapshot("runway"), /Video route runway is retired/);
});

test("Shuyu partner route is enabled only for the audited studio-video contract", () => {
  const buddy = getVideoRouteContract("buddy");
  assert.equal(buddy.enabled, true);
  assert.equal(buddy.model, "studio-video");
  assert.equal(buddy.providerAdapter, "shuyu");
  assert.equal(buddy.processingRegion, null);
  assert.equal(isEnabledVideoRouteId("buddy"), true);
  assert.deepEqual(createVideoRouteSnapshot("buddy"), {
    videoRouteSnapshot: "buddy",
    videoModelSnapshot: "studio-video",
    videoProviderAdapterSnapshot: "shuyu",
  });
});

test("enabled routes create complete immutable snapshots", () => {
  const snapshot = createVideoRouteSnapshot("mock");
  assert.deepEqual(snapshot, {
    videoRouteSnapshot: "mock",
    videoModelSnapshot: "aivora-deterministic-mock-v1",
    videoProviderAdapterSnapshot: "mock",
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(createVideoRouteSnapshot("buddy")), true);
});

test("historical all-null route evidence remains unknown without a default", () => {
  assert.deepEqual(
    readVideoRouteSnapshot({
      videoRouteSnapshot: null,
      videoModelSnapshot: null,
      videoProviderAdapterSnapshot: null,
    }),
    {
      state: "historical_unknown",
      route: null,
      videoRouteSnapshot: null,
      videoModelSnapshot: null,
      videoProviderAdapterSnapshot: null,
    },
  );
  assert.equal(readVideoRouteSnapshot({}).state, "historical_unknown");
});

test("persisted snapshots preserve their exact model instead of current defaults", () => {
  const read = readVideoRouteSnapshot({
    videoRouteSnapshot: "byteplus_international",
    videoModelSnapshot: "historical-explicit-model",
    videoProviderAdapterSnapshot: "byteplus",
  });
  assert.equal(read.state, "persisted");
  assert.equal(read.videoModelSnapshot, "historical-explicit-model");
  assert.equal(read.route.id, "byteplus_international");
  assert.equal(read.route.enabled, false, "旧直连记录读得出来，线路定义已停用");
  const shuyu = readVideoRouteSnapshot({
    videoRouteSnapshot: "buddy",
    videoModelSnapshot: "studio-video-historical",
    videoProviderAdapterSnapshot: "shuyu",
  });
  assert.equal(shuyu.videoModelSnapshot, "studio-video-historical");
});

test("partial and unknown persisted snapshots fail closed", () => {
  assert.throws(
    () =>
      readVideoRouteSnapshot({
        videoRouteSnapshot: "mock",
        videoModelSnapshot: null,
        videoProviderAdapterSnapshot: "mock",
      }),
    /Incomplete persisted video route snapshot/,
  );
  assert.throws(
    () =>
      readVideoRouteSnapshot({
        videoRouteSnapshot: "invented",
        videoModelSnapshot: "x",
        videoProviderAdapterSnapshot: "mock",
      }),
    /Unknown persisted video route snapshot/,
  );
});
