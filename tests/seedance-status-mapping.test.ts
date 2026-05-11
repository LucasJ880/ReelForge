import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "../src/lib/providers/seedance";

const { mapProviderStatus, isFailureStatus } = __test__;

test("seedance status mapping: succeeded → completed", () => {
  assert.equal(mapProviderStatus("succeeded"), "completed");
  assert.equal(mapProviderStatus("Succeeded"), "completed");
  assert.equal(mapProviderStatus("SUCCESS"), "completed");
  assert.equal(mapProviderStatus("done"), "completed");
});

test("seedance status mapping: failed family → failed", () => {
  assert.equal(mapProviderStatus("failed"), "failed");
  assert.equal(mapProviderStatus("error"), "failed");
  assert.equal(mapProviderStatus("expired"), "failed");
  assert.equal(mapProviderStatus("cancelled"), "failed");
  assert.equal(mapProviderStatus("canceled"), "failed");
});

test("seedance status mapping: queued / pending → pending", () => {
  assert.equal(mapProviderStatus("queued"), "pending");
  assert.equal(mapProviderStatus("PENDING"), "pending");
  assert.equal(mapProviderStatus("waiting"), "pending");
});

test("seedance status mapping: running / processing / unknown → processing (do NOT terminate)", () => {
  assert.equal(mapProviderStatus("running"), "processing");
  assert.equal(mapProviderStatus("processing"), "processing");
  /// 关键：未知字符串绝不能被误判为完成或失败
  assert.equal(mapProviderStatus("warming_up_phase_2_alpha"), "processing");
  assert.equal(mapProviderStatus(""), "processing");
});

test("isFailureStatus only returns true for terminal failure tokens", () => {
  assert.equal(isFailureStatus("failed"), true);
  assert.equal(isFailureStatus("expired"), true);
  assert.equal(isFailureStatus("cancelled"), true);
  assert.equal(isFailureStatus("succeeded"), false);
  assert.equal(isFailureStatus("running"), false);
  assert.equal(isFailureStatus("unknown"), false);
});
