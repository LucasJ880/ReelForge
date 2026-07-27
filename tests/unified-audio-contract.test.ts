process.env.LLM_FORCE_MOCK = "true";

import assert from "node:assert/strict";
import test from "node:test";
import { unifiedVideoGenerationRequestSchema } from "../src/lib/schemas/unified-input";
import { buildPlan } from "../src/lib/video-generation/generation-supervisor";
import type { UnifiedVideoGenerationRequest } from "../src/types/video-generation";

const legacyFixture = {
  userType: "business",
  rawPrompt: "Create a concise product demonstration for a reusable bottle.",
  attachments: [],
  selectedDuration: 15,
  selectedAspectRatio: "9:16",
  selectedBrandEndingMode: "none",
  language: "zh-CN",
} as const;

test("historical requests default native audio and captions off", () => {
  const parsed = unifiedVideoGenerationRequestSchema.parse(legacyFixture);
  assert.equal(parsed.audio?.voiceover?.enabled ?? false, false);
  assert.equal(parsed.audio?.bgm?.trackId ?? "none", "none");
  assert.equal(parsed.captions?.enabled ?? false, false);
});

test("voiceover script is bounded and remains editable request data", () => {
  const parsed = unifiedVideoGenerationRequestSchema.parse({
    ...legacyFixture,
    audio: {
      voiceover: {
        enabled: true,
        voiceId: "warm-confident",
        language: "zh-CN",
        script: "现在开始。",
      },
      bgm: { trackId: "wholesome", volume: 0.25 },
    },
  });
  assert.equal(parsed.audio?.voiceover?.script, "现在开始。");
  assert.equal(parsed.audio?.bgm?.volume, 0.25);

  assert.throws(() =>
    unifiedVideoGenerationRequestSchema.parse({
      ...legacyFixture,
      audio: {
        voiceover: {
          enabled: true,
          voiceId: "warm-confident",
          language: "zh-CN",
          script: "长".repeat(2_001),
        },
      },
    }),
  );
  assert.throws(() =>
    unifiedVideoGenerationRequestSchema.parse({
      ...legacyFixture,
      audio: { bgm: { trackId: "wholesome", volume: 0.36 } },
    }),
  );
});

test("supervisor carries a normalized post-production snapshot", async () => {
  const request = unifiedVideoGenerationRequestSchema.parse({
    ...legacyFixture,
    audio: {
      voiceover: {
        enabled: true,
        voiceId: "warm-confident",
        language: "zh-CN",
        script: "一拧即开，随时补水。",
      },
      bgm: { trackId: "wholesome", volume: 0.2 },
    },
    captions: {
      enabled: true,
      style: "word_by_word",
      language: "zh-CN",
      position: "bottom",
      exportSrt: true,
    },
  });
  const plan = await buildPlan(request as UnifiedVideoGenerationRequest);

  assert.deepEqual(plan.postProduction, {
    audio: {
      voiceover: {
        enabled: true,
        voiceId: "warm-confident",
        language: "zh-CN",
        script: "一拧即开，随时补水。",
      },
      bgm: { trackId: "wholesome", volume: 0.2 },
    },
    captions: {
      enabled: true,
      style: "word_by_word",
      language: "zh-CN",
      position: "bottom",
      exportSrt: true,
    },
  });
  assert.equal(plan.inputClassification.generationMode, "text_to_video_ad");
  assert.match(
    plan.seedancePrompts[0]?.prompt ?? "",
    /Spoken dialogue \(voice only, exact wording, zh-CN, warm confident\): "一拧即开，随时补水。"/,
  );
  assert.match(
    plan.seedancePrompts[0]?.prompt ?? "",
    /Do not render subtitles, captions, readable text, or a music bed\./,
  );
});
