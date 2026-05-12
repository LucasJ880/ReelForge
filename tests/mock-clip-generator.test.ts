import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "../src/lib/video-generation/mock-clip-generator";

const { computeCacheKey, resolveAspect, staticFallbackPath } = __test__;

test("mock-clip-generator: cacheKey 稳定（同输入同 key）", () => {
  const a = computeCacheKey({
    briefId: "brief-1",
    segmentIndex: 0,
    segmentCount: 3,
    durationSec: 5,
    aspectRatio: "9:16",
    purpose: "hook",
  });
  const b = computeCacheKey({
    briefId: "brief-1",
    segmentIndex: 0,
    segmentCount: 3,
    durationSec: 5,
    aspectRatio: "9:16",
    purpose: "hook",
  });
  assert.equal(a, b);
});

test("mock-clip-generator: cacheKey 随段索引变化", () => {
  const seg0 = computeCacheKey({
    briefId: "brief-1",
    segmentIndex: 0,
    segmentCount: 3,
    durationSec: 5,
    aspectRatio: "9:16",
  });
  const seg1 = computeCacheKey({
    briefId: "brief-1",
    segmentIndex: 1,
    segmentCount: 3,
    durationSec: 5,
    aspectRatio: "9:16",
  });
  assert.notEqual(seg0, seg1);
});

test("mock-clip-generator: cacheKey 随 aspect 变化", () => {
  const v916 = computeCacheKey({
    briefId: "brief-1",
    segmentIndex: 0,
    segmentCount: 1,
    durationSec: 4,
    aspectRatio: "9:16",
  });
  const v169 = computeCacheKey({
    briefId: "brief-1",
    segmentIndex: 0,
    segmentCount: 1,
    durationSec: 4,
    aspectRatio: "16:9",
  });
  assert.notEqual(v916, v169);
});

test("mock-clip-generator: aspect resolution 9:16 → 720x1280 vertical", () => {
  const r = resolveAspect("9:16");
  assert.equal(r.width, 720);
  assert.equal(r.height, 1280);
});

test("mock-clip-generator: aspect resolution 16:9 → 1280x720 horizontal", () => {
  const r = resolveAspect("16:9");
  assert.equal(r.width, 1280);
  assert.equal(r.height, 720);
});

test("mock-clip-generator: aspect resolution 1:1 → 720x720 square", () => {
  const r = resolveAspect("1:1");
  assert.equal(r.width, 720);
  assert.equal(r.height, 720);
});

test("mock-clip-generator: 未知 aspect 兜底到 9:16（不抛异常）", () => {
  const r = resolveAspect("999:1");
  assert.equal(r.width, 720);
  assert.equal(r.height, 1280);
});

test("mock-clip-generator: cacheKey 形如 mock-9x16-5s-seg0of3-<hash>", () => {
  const k = computeCacheKey({
    briefId: "brief-x",
    segmentIndex: 0,
    segmentCount: 3,
    durationSec: 5,
    aspectRatio: "9:16",
  });
  assert.match(k, /^mock-9x16-5s-seg0of3-[a-f0-9]{8}$/);
});

test("mock-clip-generator: 静态 fallback 文件路径按 aspect 命名", () => {
  assert.match(staticFallbackPath("9:16"), /public\/mock-clips\/9x16\.mp4$/);
  assert.match(staticFallbackPath("16:9"), /public\/mock-clips\/16x9\.mp4$/);
  assert.match(staticFallbackPath("1:1"), /public\/mock-clips\/1x1\.mp4$/);
});
