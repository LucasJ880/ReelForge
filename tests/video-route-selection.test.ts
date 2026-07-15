import assert from "node:assert/strict";
import test from "node:test";
import {
  canVideoRouteOverrideDefaultRuntimeFailure,
  isVideoRouteSnapshotRuntimeReady,
  selectVideoRouteSnapshot,
  VideoRouteSelectionError,
} from "../src/lib/video-generation/video-route-selection";
import { hashVideoDispatchRequest } from "../src/lib/services/video-dispatch-idempotency";
import { createVideoRouteSnapshot } from "../src/lib/video-generation/video-route-registry";

const realEnv = {
  VIDEO_PROVIDER: "byteplus",
  VIDEO_ENGINE_MOCK: "false",
  SEEDANCE_RUNTIME_PROFILE: "byteplus_international",
};

test("authenticated customer gets direct by default and may override only to Shuyu", () => {
  assert.equal(
    selectVideoRouteSnapshot({
      isInternalStaff: false,
      env: {
        ...realEnv,
        SEEDANCE_RUNTIME_PROFILE: "volcengine_cn_legacy",
      },
    }).videoRouteSnapshot,
    "volcengine_cn_legacy",
  );
  assert.deepEqual(
    selectVideoRouteSnapshot({
      requestedRouteId: "buddy",
      isInternalStaff: false,
      env: realEnv,
    }),
    createVideoRouteSnapshot("buddy"),
  );
  for (const routeId of ["byteplus_international", "volcengine_cn_legacy"]) {
    assert.throws(
      () =>
        selectVideoRouteSnapshot({
          requestedRouteId: routeId,
          isInternalStaff: false,
          env: realEnv,
        }),
      (error) =>
        error instanceof VideoRouteSelectionError && error.code === "FORBIDDEN",
    );
  }
});

test("unregistered and mock request overrides remain sealed", () => {
  assert.equal(
    selectVideoRouteSnapshot({
      requestedRouteId: "volcengine_cn_legacy",
      isInternalStaff: true,
      env: realEnv,
    }).videoRouteSnapshot,
    "volcengine_cn_legacy",
  );
  for (const routeId of ["mock", "custom-proxy"]) {
    assert.throws(
      () =>
        selectVideoRouteSnapshot({
          requestedRouteId: routeId,
          isInternalStaff: true,
          env: realEnv,
        }),
      (error) =>
        error instanceof VideoRouteSelectionError &&
        error.code === "INVALID_ROUTE",
    );
  }
});

test("mock rehearsal forces mock and refuses a paid route override", () => {
  const env = { ...realEnv, VIDEO_ENGINE_MOCK: "true" };
  assert.equal(
    selectVideoRouteSnapshot({ isInternalStaff: false, env })
      .videoRouteSnapshot,
    "mock",
  );
  assert.throws(
    () =>
      selectVideoRouteSnapshot({
        requestedRouteId: "byteplus_international",
        isInternalStaff: true,
        env,
      }),
    (error) =>
      error instanceof VideoRouteSelectionError &&
      error.code === "MOCK_ROUTE_CONFLICT",
  );
});

test("idempotency hash includes the effective route snapshot", () => {
  const body = { request: { rawPrompt: "same request" } };
  const international = hashVideoDispatchRequest(
    body,
    createVideoRouteSnapshot("byteplus_international"),
  );
  const legacy = hashVideoDispatchRequest(
    body,
    createVideoRouteSnapshot("volcengine_cn_legacy"),
  );
  assert.notEqual(international, legacy);
  assert.equal(
    international,
    hashVideoDispatchRequest(
      body,
      createVideoRouteSnapshot("byteplus_international"),
    ),
  );
});

test("direct route readiness seals credentials to the matching endpoint", () => {
  const byteplus = createVideoRouteSnapshot("byteplus_international");
  const volcengine = createVideoRouteSnapshot("volcengine_cn_legacy");
  assert.equal(
    isVideoRouteSnapshotRuntimeReady(byteplus, {
      BYTEPLUS_ARK_API_KEY: "configured",
    }),
    true,
  );
  assert.equal(
    isVideoRouteSnapshotRuntimeReady(byteplus, {
      BYTEPLUS_ARK_API_KEY: "configured",
      ARK_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3",
    }),
    false,
  );
  assert.equal(
    isVideoRouteSnapshotRuntimeReady(volcengine, {
      ARK_API_KEY: "configured",
      ARK_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3/",
    }),
    true,
  );
  assert.equal(
    isVideoRouteSnapshotRuntimeReady(volcengine, {
      ARK_API_KEY: "configured",
      ARK_BASE_URL: "https://proxy.example.com/api/v3",
    }),
    false,
  );
});

test("explicit routes bypass only a different provider's readiness failure", () => {
  const buddy = createVideoRouteSnapshot("buddy");
  const byteplus = createVideoRouteSnapshot("byteplus_international");
  const volcengine = createVideoRouteSnapshot("volcengine_cn_legacy");

  assert.equal(
    canVideoRouteOverrideDefaultRuntimeFailure(
      buddy,
      "byteplus_endpoint_invalid",
    ),
    true,
  );
  assert.equal(
    canVideoRouteOverrideDefaultRuntimeFailure(
      buddy,
      "content_review_key_missing",
    ),
    false,
  );
  assert.equal(
    canVideoRouteOverrideDefaultRuntimeFailure(
      byteplus,
      "volcengine_legacy_key_missing",
    ),
    true,
  );
  assert.equal(
    canVideoRouteOverrideDefaultRuntimeFailure(
      byteplus,
      "byteplus_key_missing",
    ),
    false,
  );
  assert.equal(
    canVideoRouteOverrideDefaultRuntimeFailure(
      volcengine,
      "shuyu_key_missing",
    ),
    true,
  );
  assert.equal(
    canVideoRouteOverrideDefaultRuntimeFailure(
      volcengine,
      "volcengine_legacy_endpoint_invalid",
    ),
    false,
  );
});
