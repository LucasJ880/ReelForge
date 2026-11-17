import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isVideoRouteSnapshotRuntimeReady,
  selectVideoRouteSnapshot,
  STAFF_SELECTABLE_VIDEO_ROUTE_IDS,
  VideoRouteSelectionError,
} from "../src/lib/video-generation/video-route-selection";
import * as routeSelection from "../src/lib/video-generation/video-route-selection";
import { hashVideoDispatchRequest } from "../src/lib/services/video-dispatch-idempotency";
import {
  createVideoRouteSnapshot,
  type VideoRouteSnapshot,
} from "../src/lib/video-generation/video-route-registry";

/// 生产的三种真实形状：VIDEO_PROVIDER 没写、写 shuyu、残留旧值 byteplus（按 shuyu 处理）
const REAL_ENVS = [
  { VIDEO_ENGINE_MOCK: "false" },
  { VIDEO_PROVIDER: "shuyu", VIDEO_ENGINE_MOCK: "false" },
  { VIDEO_PROVIDER: "byteplus", VIDEO_ENGINE_MOCK: "false", SEEDANCE_RUNTIME_PROFILE: "volcengine_cn_legacy" },
] as const;
const realEnv = REAL_ENVS[0];

/// 旧记录上的直连线路快照：线路已下线，不能再用 createVideoRouteSnapshot 造，只能照库里的样子手写
const RETIRED_DIRECT_SNAPSHOTS: VideoRouteSnapshot[] = [
  {
    videoRouteSnapshot: "byteplus_international",
    videoModelSnapshot: "dreamina-seedance-2-0-260128",
    videoProviderAdapterSnapshot: "byteplus",
  },
  {
    videoRouteSnapshot: "volcengine_cn_legacy",
    videoModelSnapshot: "doubao-seedance-2-0-260128",
    videoProviderAdapterSnapshot: "byteplus",
  },
];

test("customer routing is Shuyu-only outside mock mode, whatever VIDEO_PROVIDER production still carries", () => {
  assert.equal(
    typeof routeSelection.selectCustomerVideoRouteSnapshot,
    "function",
  );
  for (const env of REAL_ENVS) {
    assert.equal(
      routeSelection.selectCustomerVideoRouteSnapshot({ env }).videoRouteSnapshot,
      "buddy",
    );
    assert.deepEqual(
      selectVideoRouteSnapshot({ requestedRouteId: "buddy", isInternalStaff: false, env }),
      createVideoRouteSnapshot("buddy"),
    );
    assert.deepEqual(
      selectVideoRouteSnapshot({ isInternalStaff: false, env }),
      createVideoRouteSnapshot("buddy"),
    );
    for (const routeId of ["byteplus_international", "volcengine_cn_legacy", "runway"]) {
      assert.throws(
        () => selectVideoRouteSnapshot({ requestedRouteId: routeId, isInternalStaff: false, env }),
        (error) => error instanceof VideoRouteSelectionError && error.code === "FORBIDDEN",
        routeId,
      );
    }
  }
});

test("dispatch refuses on any runtime readiness failure: there is no other route to stand in", async () => {
  const [dispatch, selection] = await Promise.all([
    readFile("src/app/api/video-generation/dispatch/route.ts", "utf8"),
    readFile("src/lib/video-generation/video-route-selection.ts", "utf8"),
  ]);
  for (const source of [dispatch, selection]) {
    assert.doesNotMatch(source, /canVideoRouteOverrideDefaultRuntimeFailure|overrideMayIgnoreGlobalRouteFailure|selectedRouteOverridesDefaultFailure/);
  }
  assert.match(dispatch, /const runtimeReadiness = videoGenerationRuntimeReadiness\(\);\s*if \(!runtimeReadiness\.ok\) \{/);
});

test("internal staff get the same single route: no override defaults to buddy, retired and unknown ids are INVALID_ROUTE", () => {
  assert.deepEqual([...STAFF_SELECTABLE_VIDEO_ROUTE_IDS], ["buddy"]);
  for (const env of REAL_ENVS) {
    assert.deepEqual(selectVideoRouteSnapshot({ isInternalStaff: true, env }), createVideoRouteSnapshot("buddy"));
    assert.deepEqual(
      selectVideoRouteSnapshot({ requestedRouteId: "buddy", isInternalStaff: true, env }),
      createVideoRouteSnapshot("buddy"),
    );
    for (const routeId of ["byteplus_international", "volcengine_cn_legacy", "runway", "mock", "custom-proxy"]) {
      assert.throws(
        () => selectVideoRouteSnapshot({ requestedRouteId: routeId, isInternalStaff: true, env }),
        (error) => error instanceof VideoRouteSelectionError && error.code === "INVALID_ROUTE",
        routeId,
      );
    }
  }
});

test("mock rehearsal forces mock and refuses a paid route override", () => {
  const env = { ...realEnv, VIDEO_ENGINE_MOCK: "true" };
  assert.equal(
    selectVideoRouteSnapshot({ isInternalStaff: false, env })
      .videoRouteSnapshot,
    "mock",
  );
  for (const requestedRouteId of ["buddy", "byteplus_international"]) {
    assert.throws(
      () => selectVideoRouteSnapshot({ requestedRouteId, isInternalStaff: true, env }),
      (error) =>
        error instanceof VideoRouteSelectionError &&
        error.code === "MOCK_ROUTE_CONFLICT",
    );
  }
});

test("idempotency hash includes the effective route snapshot", () => {
  const body = { request: { rawPrompt: "same request" } };
  const buddy = hashVideoDispatchRequest(body, createVideoRouteSnapshot("buddy"));
  const mock = hashVideoDispatchRequest(body, createVideoRouteSnapshot("mock"));
  assert.notEqual(buddy, mock);
  assert.equal(buddy, hashVideoDispatchRequest(body, createVideoRouteSnapshot("buddy")));
});

test("runtime readiness: buddy needs the Shuyu key; retired direct routes are never ready, even with their old credentials", () => {
  const buddy = createVideoRouteSnapshot("buddy");
  assert.equal(isVideoRouteSnapshotRuntimeReady(buddy, { SHUYU_API_KEY: "configured" }), true);
  assert.equal(isVideoRouteSnapshotRuntimeReady(buddy, { BYTEPLUS_ARK_API_KEY: "configured", ARK_API_KEY: "configured" }), false);
  for (const snapshot of RETIRED_DIRECT_SNAPSHOTS) {
    assert.equal(
      isVideoRouteSnapshotRuntimeReady(snapshot, {
        BYTEPLUS_ARK_API_KEY: "configured",
        ARK_API_KEY: "configured",
        ARK_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3",
        SHUYU_API_KEY: "configured",
      }),
      false,
      snapshot.videoRouteSnapshot,
    );
  }
});
