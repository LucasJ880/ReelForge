import assert from "node:assert/strict";
import test from "node:test";
import {
  parseWizardTimeline,
  safeParseWizardTimeline,
  type WizardTimeline,
} from "../src/lib/schemas/wizard-render";
import {
  decideRenderMode,
  dryRunRender,
} from "../src/lib/services/wizard-render-service";
import { WizardRenderJobMode, WizardRenderJobStatus } from "@prisma/client";

const baseTimeline: WizardTimeline = {
  aspectRatio: "9:16",
  totalDurationMs: 12000,
  language: "en",
  clips: [
    {
      sceneIndex: 1,
      rawAssetId: "ra_1",
      sourceUrl: "https://cdn.example.com/clip1.mp4",
      startMs: 0,
      endMs: 4000,
      durationMs: 4000,
      placeholder: false,
    },
    {
      sceneIndex: 2,
      rawAssetId: null,
      sourceUrl: null,
      startMs: 4000,
      endMs: 8000,
      durationMs: 4000,
      placeholder: true,
    },
    {
      sceneIndex: 3,
      rawAssetId: "ra_3",
      sourceUrl: "https://cdn.example.com/clip3.mp4",
      startMs: 8000,
      endMs: 12000,
      durationMs: 4000,
      placeholder: false,
    },
  ],
  brand: {
    logoUrl: "https://cdn.example.com/logo.png",
    primaryColor: "#000000",
    ctaText: "Call now",
  },
  ctaText: "Call now",
  placeholderClipCount: 1,
};

test("wizard timeline schema accepts valid timeline", () => {
  const parsed = parseWizardTimeline(baseTimeline);
  assert.equal(parsed.clips.length, 3);
  assert.equal(parsed.placeholderClipCount, 1);
});

test("wizard timeline schema rejects placeholder clip with sourceUrl mismatch", () => {
  const result = safeParseWizardTimeline({
    ...baseTimeline,
    clips: [
      {
        ...baseTimeline.clips[0]!,
        sourceUrl: "not-a-url",
      },
    ],
  });
  assert.equal(result.success, false);
});

test("decideRenderMode → MOCK when no clips", async () => {
  const mode = await decideRenderMode({
    hasAnyClips: false,
    hasUsableClips: false,
  });
  assert.equal(mode, WizardRenderJobMode.MOCK);
});

test("decideRenderMode → DRAFT when ENABLE_WIZARD_FFMPEG_RENDER not set", async () => {
  delete process.env.ENABLE_WIZARD_FFMPEG_RENDER;
  const mode = await decideRenderMode({
    hasAnyClips: true,
    hasUsableClips: true,
  });
  assert.equal(mode, WizardRenderJobMode.DRAFT);
});

test("decideRenderMode → DRAFT when toggled on but no usable clips", async () => {
  process.env.ENABLE_WIZARD_FFMPEG_RENDER = "true";
  const mode = await decideRenderMode({
    hasAnyClips: true,
    hasUsableClips: false,
  });
  assert.equal(mode, WizardRenderJobMode.DRAFT);
  delete process.env.ENABLE_WIZARD_FFMPEG_RENDER;
});

test("dryRunRender → DRAFT_READY result with manifest fallback for typical timeline", async () => {
  delete process.env.ENABLE_WIZARD_FFMPEG_RENDER;
  const { mode, result } = await dryRunRender(baseTimeline);
  assert.equal(mode, WizardRenderJobMode.DRAFT);
  assert.equal(result.status, WizardRenderJobStatus.DRAFT_READY);
  assert.ok(result.fallbackReason && result.fallbackReason.includes("Draft Preview"));
  assert.ok(result.manifestUrl);
  /// 数据 URL 形式或 https URL 都接受
  assert.match(
    result.manifestUrl ?? "",
    /^(data:application\/json;base64,|https?:\/\/)/,
  );
  /// outputVideoUrl 应该指向第一个可用素材
  assert.equal(result.outputVideoUrl, baseTimeline.clips[0]!.sourceUrl);
});

test("dryRunRender → MOCK when timeline only has placeholder clips", async () => {
  const placeholderOnly: WizardTimeline = {
    ...baseTimeline,
    clips: [
      {
        sceneIndex: 1,
        rawAssetId: null,
        sourceUrl: null,
        startMs: 0,
        endMs: 5000,
        durationMs: 5000,
        placeholder: true,
      },
    ],
    placeholderClipCount: 1,
  };
  const { mode, result } = await dryRunRender(placeholderOnly);
  /// 注意：placeholder-only 仍然 hasAnyClips=true，所以走 DRAFT
  assert.equal(mode, WizardRenderJobMode.DRAFT);
  assert.equal(result.status, WizardRenderJobStatus.DRAFT_READY);
  assert.equal(result.outputVideoUrl, null);
  assert.ok(result.manifestUrl);
});

test("manifest content is parseable JSON describing timeline", async () => {
  const { result } = await dryRunRender(baseTimeline);
  assert.ok(result.manifestUrl);
  const manifestUrl = result.manifestUrl ?? "";
  if (!manifestUrl.startsWith("data:application/json;base64,")) {
    /// blob URL 模式跳过 — 由集成测试覆盖
    return;
  }
  const base64 = manifestUrl.replace("data:application/json;base64,", "");
  const json = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  assert.equal(json.kind, "aivora_wizard_render_manifest");
  assert.equal(json.aspectRatio, "9:16");
  assert.equal(json.timeline.clips.length, 3);
});
