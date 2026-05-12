import assert from "node:assert/strict";
import test from "node:test";
import { classifyAsset } from "../src/lib/video-generation/asset-classifier";

test("[unified-asset-classifier] PNG named logo → logo, high confidence", () => {
  const r = classifyAsset({
    url: "https://example.com/acme-logo.png",
    mimeType: "image/png",
    fileName: "acme-logo.png",
    width: 256,
    height: 256,
  });
  assert.equal(r.inferredRole, "logo");
  assert.ok(r.roleConfidence > 0.7);
});

test("[unified-asset-classifier] small PNG (≤512) → logo", () => {
  const r = classifyAsset({
    url: "https://example.com/foo.png",
    mimeType: "image/png",
    fileName: "foo.png",
    width: 320,
    height: 320,
  });
  assert.equal(r.inferredRole, "logo");
});

test("[unified-asset-classifier] large JPG (1080×1920) → product_image", () => {
  const r = classifyAsset({
    url: "https://example.com/hero.jpg",
    mimeType: "image/jpeg",
    fileName: "hero.jpg",
    width: 1080,
    height: 1920,
  });
  assert.equal(r.inferredRole, "product_image");
});

test("[unified-asset-classifier] tiny image → reference_image", () => {
  const r = classifyAsset({
    url: "https://example.com/foo.jpg",
    mimeType: "image/jpeg",
    fileName: "moody.jpg",
    width: 400,
    height: 400,
  });
  assert.equal(r.inferredRole, "reference_image");
});

test("[unified-asset-classifier] video named intro → intro_clip", () => {
  const r = classifyAsset({
    url: "https://example.com/intro.mp4",
    mimeType: "video/mp4",
    fileName: "intro-acme.mp4",
    durationSeconds: 3,
  });
  assert.equal(r.inferredRole, "intro_clip");
  assert.ok(r.roleConfidence > 0.7);
});

test("[unified-asset-classifier] short video (≤5s) → intro_clip (default)", () => {
  const r = classifyAsset({
    url: "https://example.com/clip.mp4",
    mimeType: "video/mp4",
    fileName: "clip.mp4",
    durationSeconds: 3,
  });
  assert.equal(r.inferredRole, "intro_clip");
});

test("[unified-asset-classifier] medium video (8s) → ad_clip", () => {
  const r = classifyAsset({
    url: "https://example.com/x.mp4",
    mimeType: "video/mp4",
    fileName: "moment.mp4",
    durationSeconds: 8,
  });
  assert.equal(r.inferredRole, "ad_clip");
});

test("[unified-asset-classifier] long video (30s) → store_clip", () => {
  const r = classifyAsset({
    url: "https://example.com/x.mp4",
    mimeType: "video/mp4",
    fileName: "long.mp4",
    durationSeconds: 30,
  });
  assert.equal(r.inferredRole, "store_clip");
  assert.ok(r.warnings.some((w) => w.toLowerCase().includes("longer")));
});

test("[unified-asset-classifier] unsupported audio → unknown", () => {
  const r = classifyAsset({
    url: "https://example.com/foo.mp3",
    mimeType: "audio/mpeg",
    fileName: "song.mp3",
  });
  assert.equal(r.inferredRole, "unknown");
});
