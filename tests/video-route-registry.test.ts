import assert from "node:assert/strict";
import test from "node:test";
import {
  VIDEO_ROUTE_IDS,
  VIDEO_ROUTE_REGISTRY,
  createVideoRouteSnapshot,
  getVideoRouteContract,
  isEnabledVideoRouteId,
  readVideoRouteSnapshot,
} from "../src/lib/video-generation/video-route-registry";

test("video route registry explicitly allowlists audited routes", () => {
  assert.deepEqual(VIDEO_ROUTE_IDS, [
    "byteplus_international",
    "volcengine_cn_legacy",
    "mock",
    "buddy",
  ]);
  assert.deepEqual(Object.keys(VIDEO_ROUTE_REGISTRY), VIDEO_ROUTE_IDS);

  assert.deepEqual(getVideoRouteContract("byteplus_international"), {
    id: "byteplus_international",
    enabled: true,
    providerAdapter: "byteplus",
    model: "dreamina-seedance-2-0-260128",
    processingRegion: "ap-southeast",
  });
  assert.deepEqual(getVideoRouteContract("volcengine_cn_legacy"), {
    id: "volcengine_cn_legacy",
    enabled: true,
    providerAdapter: "byteplus",
    model: "doubao-seedance-2-0-260128",
    processingRegion: "cn-beijing",
  });
  assert.equal(isEnabledVideoRouteId("mock"), true);
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
  const snapshot = createVideoRouteSnapshot("volcengine_cn_legacy");
  assert.deepEqual(snapshot, {
    videoRouteSnapshot: "volcengine_cn_legacy",
    videoModelSnapshot: "doubao-seedance-2-0-260128",
    videoProviderAdapterSnapshot: "byteplus",
  });
  assert.equal(Object.isFrozen(snapshot), true);
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
