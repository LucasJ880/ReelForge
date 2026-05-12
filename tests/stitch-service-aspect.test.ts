import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "../src/lib/services/stitch-service";

const { resolveAspectResolution } = __test__;

test("stitch-service: 9:16 → 1080x1920（vertical TikTok / Reels）", () => {
  const r = resolveAspectResolution("9:16");
  assert.equal(r.width, 1080);
  assert.equal(r.height, 1920);
});

test("stitch-service: 16:9 → 1920x1080（horizontal YouTube / TV）", () => {
  const r = resolveAspectResolution("16:9");
  assert.equal(r.width, 1920);
  assert.equal(r.height, 1080);
});

test("stitch-service: 1:1 → 1080x1080（square Instagram feed）", () => {
  const r = resolveAspectResolution("1:1");
  assert.equal(r.width, 1080);
  assert.equal(r.height, 1080);
});

test("stitch-service: 未知 aspect 兜底 9:16（不抛异常）", () => {
  const r = resolveAspectResolution("not-a-ratio");
  assert.equal(r.width, 1080);
  assert.equal(r.height, 1920);
});
