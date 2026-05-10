import assert from "node:assert/strict";
import test from "node:test";
import { RawAssetType } from "@prisma/client";
import {
  ASSET_QA_DEFAULTS,
  evaluateAssetQA,
} from "../src/lib/services/asset-qa-service";
import { parseMissingShotReport } from "../src/lib/schemas/asset-qa";

test("evaluateAssetQA returns USABLE for a clean 9:16 mp4", () => {
  const result = evaluateAssetQA({
    type: RawAssetType.VIDEO,
    name: "shop-hook.mp4",
    url: "https://blob.example.com/uploads/shop-hook.mp4",
    mimeType: "video/mp4",
    fileSizeBytes: 12 * 1024 * 1024,
    durationMs: 18_000,
    width: 1080,
    height: 1920,
  });
  assert.equal(result.status, "USABLE");
  assert.equal(result.orientation, "portrait");
  assert.equal(result.aspectRatio, "9:16");
  assert.ok(result.score >= 80);
});

test("evaluateAssetQA flags landscape video as RETAKE_RECOMMENDED for portrait target", () => {
  const result = evaluateAssetQA({
    type: RawAssetType.VIDEO,
    name: "horizontal.mp4",
    url: "https://blob.example.com/uploads/horizontal.mp4",
    mimeType: "video/mp4",
    fileSizeBytes: 60 * 1024 * 1024,
    durationMs: 12_000,
    width: 1920,
    height: 1080,
  });
  assert.equal(result.orientation, "landscape");
  assert.notEqual(result.status, "USABLE");
  assert.ok(
    result.reasons.some((r) => /朝向/.test(r)),
    "should mention orientation in reasons",
  );
  assert.ok(
    result.retakeSuggestions.length > 0,
    "should provide a retake suggestion",
  );
});

test("evaluateAssetQA marks oversized files as warnings", () => {
  const result = evaluateAssetQA({
    type: RawAssetType.VIDEO,
    name: "huge.mp4",
    url: "https://blob.example.com/uploads/huge.mp4",
    mimeType: "video/mp4",
    fileSizeBytes: ASSET_QA_DEFAULTS.maxFileSizeBytes + 50 * 1024 * 1024,
    durationMs: 25_000,
    width: 1080,
    height: 1920,
  });
  const sizeCheck = result.checks.find((c) => c.rule === "size_within_limit");
  assert.ok(sizeCheck);
  assert.equal(sizeCheck?.passed, false);
});

test("evaluateAssetQA marks unsupported extension as fatal", () => {
  const result = evaluateAssetQA({
    type: RawAssetType.VIDEO,
    name: "old-format.avi",
    url: "https://blob.example.com/uploads/old-format.avi",
    mimeType: "video/x-msvideo",
    fileSizeBytes: 5 * 1024 * 1024,
    durationMs: 10_000,
    width: 1080,
    height: 1920,
  });
  assert.equal(result.status, "RETAKE_RECOMMENDED");
  assert.ok(
    result.reasons.some((r) => /类型/.test(r)),
    "should mention unsupported type",
  );
});

test("evaluateAssetQA tolerates missing optional metadata", () => {
  const result = evaluateAssetQA({
    type: RawAssetType.IMAGE,
    name: "logo.png",
    url: "https://blob.example.com/uploads/logo.png",
    mimeType: "image/png",
    fileSizeBytes: 200_000,
    durationMs: null,
    width: null,
    height: null,
  });
  assert.ok(result.checks.length > 0);
  assert.ok(["USABLE", "BARELY_USABLE"].includes(result.status));
});

test("MissingShotReport schema enforces matched/missing counts", () => {
  const report = parseMissingShotReport({
    total: 3,
    matched: 1,
    missingRequired: 2,
    shots: [
      { scenePlanId: "s1", sceneIndex: 1, visualIntent: "Hook", required: true, matched: true },
      { scenePlanId: "s2", sceneIndex: 2, visualIntent: "Proof", required: true, matched: false },
      { scenePlanId: "s3", sceneIndex: 3, visualIntent: "CTA", required: true, matched: false },
    ],
  });
  assert.equal(report.missingRequired, 2);
  assert.equal(report.shots.length, 3);
});
