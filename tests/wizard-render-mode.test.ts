import assert from "node:assert/strict";
import test from "node:test";
import {
  decideWizardRenderMode,
  renderWizardTimelineWithFFmpeg,
} from "../src/lib/services/wizard-ffmpeg-adapter";
import type { WizardTimeline } from "../src/lib/schemas/wizard-render";

const baseTimeline: WizardTimeline = {
  aspectRatio: "9:16",
  totalDurationMs: 6000,
  language: "en",
  clips: [
    {
      sceneIndex: 1,
      rawAssetId: "ra-1",
      sourceUrl: "https://cdn.example.com/storefront.mp4",
      startMs: 0,
      endMs: 3000,
      durationMs: 3000,
      placeholder: false,
    },
    {
      sceneIndex: 2,
      rawAssetId: null,
      sourceUrl: null,
      startMs: 3000,
      endMs: 6000,
      durationMs: 3000,
      placeholder: true,
    },
  ],
  brand: {},
  ctaText: "Visit us today",
  placeholderClipCount: 1,
};

test("decideWizardRenderMode: 无任何 clip → MOCK", () => {
  assert.equal(
    decideWizardRenderMode({
      hasAnyClips: false,
      hasUsableClips: false,
      realFlagOn: true,
      ffmpegOk: true,
    }),
    "MOCK",
  );
});

test("decideWizardRenderMode: REAL flag 关闭 → DRAFT 即使 ffmpeg 可用", () => {
  assert.equal(
    decideWizardRenderMode({
      hasAnyClips: true,
      hasUsableClips: true,
      realFlagOn: false,
      ffmpegOk: true,
    }),
    "DRAFT",
  );
});

test("decideWizardRenderMode: REAL flag 开 但 ffmpeg 不可用 → DRAFT", () => {
  assert.equal(
    decideWizardRenderMode({
      hasAnyClips: true,
      hasUsableClips: true,
      realFlagOn: true,
      ffmpegOk: false,
    }),
    "DRAFT",
  );
});

test("decideWizardRenderMode: REAL flag + ffmpeg 都开 但无 usable clip → DRAFT", () => {
  assert.equal(
    decideWizardRenderMode({
      hasAnyClips: true,
      hasUsableClips: false,
      realFlagOn: true,
      ffmpegOk: true,
    }),
    "DRAFT",
  );
});

test("decideWizardRenderMode: 全满足 → REAL", () => {
  assert.equal(
    decideWizardRenderMode({
      hasAnyClips: true,
      hasUsableClips: true,
      realFlagOn: true,
      ffmpegOk: true,
    }),
    "REAL",
  );
});

test("renderWizardTimelineWithFFmpeg: 全部 clip 是占位 → throw（让 caller 走 DRAFT 兜底）", async () => {
  const t: WizardTimeline = {
    ...baseTimeline,
    clips: baseTimeline.clips.map((c) => ({
      ...c,
      placeholder: true,
      sourceUrl: null,
    })),
  };
  await assert.rejects(
    () => renderWizardTimelineWithFFmpeg(t),
    /没有可渲染的 clip/,
  );
});

test("renderWizardTimelineWithFFmpeg: clip 格式不支持 → throw", async () => {
  const t: WizardTimeline = {
    ...baseTimeline,
    clips: [
      {
        sceneIndex: 1,
        rawAssetId: "ra-1",
        sourceUrl: "https://cdn.example.com/file.exe",
        startMs: 0,
        endMs: 2000,
        durationMs: 2000,
        placeholder: false,
      },
    ],
  };
  await assert.rejects(
    () => renderWizardTimelineWithFFmpeg(t),
    /格式不支持/,
  );
});

test("renderWizardTimelineWithFFmpeg: clip 时间段无效 → throw", async () => {
  const t: WizardTimeline = {
    ...baseTimeline,
    clips: [
      {
        sceneIndex: 1,
        rawAssetId: "ra-1",
        sourceUrl: "https://cdn.example.com/clip.mp4",
        startMs: 5000,
        endMs: 1, // schema-level not allowed (positive); construct via cast
        durationMs: 1000,
        placeholder: false,
      },
    ],
  };
  await assert.rejects(
    () => renderWizardTimelineWithFFmpeg(t),
    /时间段无效/,
  );
});
