process.env.LLM_FORCE_MOCK = "true";

import assert from "node:assert/strict";
import test from "node:test";
import { unifiedVideoGenerationRequestSchema } from "../src/lib/schemas/unified-input";
import { buildPlan } from "../src/lib/video-generation/generation-supervisor";
import { splitScriptByWindows } from "../src/lib/video-generation/audio-post-production";
import { mapPlanToDirectorPlan } from "../src/lib/video-generation/plan-to-director";
import { splitVoiceoverScript } from "../src/lib/video-generation/prompt-intelligence";
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

// ---------------------------------------------------------------------------
// P04-C：口播按段时长加权切分
// ---------------------------------------------------------------------------

/// 20 个四字短语、逗号分隔、句号收尾 = 100 个字；短语边界每 5 个字一个
const PHRASED_ZH_SCRIPT =
  Array.from({ length: 20 }, (_, i) => ["一拧即开", "随时补水", "轻巧便携", "单手开盖"][i % 4]).join(
    "，",
  ) + "。";
const PHRASED_EN_SCRIPT = Array.from(
  { length: 40 },
  (_, i) => ["twist", "open", "sip", "go"][i % 4],
).join(" ") + ".";

test("P04-C：5s + 15s 两段时，长段分到约 3 倍台词；拼回去与原稿逐字一致", () => {
  const slots = [{ durationSec: 5 }, { durationSec: 15 }];
  const zh = splitVoiceoverScript(PHRASED_ZH_SCRIPT, slots);
  assert.equal(zh.length, 2);
  assert.equal(zh.join(""), PHRASED_ZH_SCRIPT.trim(), "拼回逐字相等");
  const zhRatio = Array.from(zh[1]).length / Array.from(zh[0]).length;
  assert.ok(zhRatio >= 2.5 && zhRatio <= 3.5, `zh ratio ${zhRatio} (${zh[0]} | ${zh[1]})`);
  assert.match(zh[0], /，$/u, "在短语边界切，不腰斩");

  const en = splitVoiceoverScript(PHRASED_EN_SCRIPT, slots);
  assert.equal(en.join(""), PHRASED_EN_SCRIPT.trim());
  const words = (chunk: string) => chunk.trim().split(/\s+/u).filter(Boolean).length;
  const enRatio = words(en[1]) / words(en[0]);
  assert.ok(enRatio >= 2.5 && enRatio <= 3.5, `en ratio ${enRatio}`);

  /// 等长段仍然均分（1025 之前的行为是这个特例）
  const even = splitVoiceoverScript(PHRASED_ZH_SCRIPT, [{ durationSec: 15 }, { durationSec: 15 }]);
  assert.equal(even.join(""), PHRASED_ZH_SCRIPT.trim());
  const evenRatio = Array.from(even[1]).length / Array.from(even[0]).length;
  assert.ok(evenRatio >= 0.8 && evenRatio <= 1.25, `even ratio ${evenRatio}`);

  /// 四段 15/15/15/5：最后的 CTA 段只拿约 1/10
  const four = splitVoiceoverScript(PHRASED_ZH_SCRIPT, [15, 15, 15, 5].map((durationSec) => ({ durationSec })));
  assert.equal(four.length, 4);
  assert.equal(four.join(""), PHRASED_ZH_SCRIPT.trim());
  assert.ok(Array.from(four[3]).length <= 15, `cta chunk ${four[3]}`);

  /// 边界：空稿每段空串；非法时长按 1 权重，不抛
  assert.deepEqual(splitVoiceoverScript("   ", slots), ["", ""]);
  assert.deepEqual(splitVoiceoverScript("只有一句。", []), []);
  assert.equal(
    splitVoiceoverScript(PHRASED_ZH_SCRIPT, [{ durationSec: 0 }, { durationSec: Number.NaN }]).join(""),
    PHRASED_ZH_SCRIPT.trim(),
  );
});

test("P04-C：DirectorPlan.segmentPlan 持久化每段分到的台词，且与各段 seedancePrompt 里的台词一致", async () => {
  const request = unifiedVideoGenerationRequestSchema.parse({
    ...legacyFixture,
    selectedDuration: 30,
    audio: {
      voiceover: {
        enabled: true,
        voiceId: "warm-confident",
        language: "zh-CN",
        script: PHRASED_ZH_SCRIPT,
      },
      bgm: { trackId: "none", volume: 0 },
    },
  });
  const plan = await buildPlan(request as UnifiedVideoGenerationRequest);
  const director = mapPlanToDirectorPlan({ plan, language: "zh-CN" });
  const aiSegments = plan.segments.filter((segment) => segment.type === "ai_generated_clip");
  assert.ok(director.segmentPlan.length >= 2, "30s = 两个 AI 段");
  assert.equal(director.segmentPlan.length, aiSegments.length);
  const chunks = director.segmentPlan.map((segment) => segment.voiceoverChunk ?? "");
  assert.equal(chunks.join(""), PHRASED_ZH_SCRIPT.trim(), "各段台词拼回去就是原稿");
  for (const [index, segment] of director.segmentPlan.entries()) {
    assert.ok(segment.voiceoverChunk, `segment ${index} carries its chunk`);
    assert.ok(
      segment.seedancePrompt.includes(segment.voiceoverChunk),
      `segment ${index} prompt speaks exactly its persisted chunk`,
    );
  }

  /// 不开口播：不写该字段（旧计划 / schema 兼容）
  const silent = await buildPlan(
    unifiedVideoGenerationRequestSchema.parse(legacyFixture) as UnifiedVideoGenerationRequest,
  );
  const silentDirector = mapPlanToDirectorPlan({ plan: silent, language: "zh-CN" });
  assert.ok(silentDirector.segmentPlan.every((segment) => segment.voiceoverChunk === undefined));
});

test("P04-B：字幕回退路径的按段切分与派发时的口播切分是同一规则（两份实现逐字一致）", () => {
  const fixtures = [
    PHRASED_ZH_SCRIPT,
    PHRASED_EN_SCRIPT,
    "先看它如何改变日常体验。一拧即开，随时补水。点击下方链接立即预约。",
    "Morning glare again? Not in this bedroom. Custom blackout curtains from SunnyShutter, measured and made for your exact window. Soft light when you want it, total blackout when you need it.",
    "没有任何标点的一长串台词连着念下去直到结束为止",
  ];
  const layouts = [[15], [15, 15], [5, 15], [15, 15, 15, 5], [15, 15, 15, 15]];
  for (const script of fixtures) {
    for (const layout of layouts) {
      const slots = layout.map((durationSec) => ({ durationSec }));
      let cursor = 0;
      const windows = layout.map((durationSec) => {
        const window = { startMs: cursor * 1_000, endMs: (cursor + durationSec) * 1_000 };
        cursor += durationSec;
        return window;
      });
      assert.deepEqual(
        splitScriptByWindows(script, windows),
        splitVoiceoverScript(script, slots),
        `layout ${layout.join("/")} :: ${script.slice(0, 12)}`,
      );
    }
  }
});
