import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("customer cannot override a video route", () => {
  assert.throws(
    () =>
      selectVideoRouteSnapshot({
        requestedRouteId: "volcengine_cn_legacy",
        isInternalStaff: false,
        env: realEnv,
      }),
    (error) =>
      error instanceof VideoRouteSelectionError && error.code === "FORBIDDEN",
  );
});

test("staff override accepts only the two audited Seedance routes", () => {
  assert.equal(
    selectVideoRouteSnapshot({
      requestedRouteId: "volcengine_cn_legacy",
      isInternalStaff: true,
      env: realEnv,
    }).videoRouteSnapshot,
    "volcengine_cn_legacy",
  );
  for (const routeId of ["buddy", "mock", "custom-proxy"]) {
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
