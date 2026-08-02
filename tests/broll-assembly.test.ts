import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBrollPostProduction,
  segmentDurationSec,
} from "../src/lib/services/broll-assembly-service";
import {
  OpenAiTtsError,
  resolveTtsVoice,
  synthesizeVoiceover,
} from "../src/lib/providers/openai-tts";
import { postProductionPlanSchema } from "../src/lib/schemas/unified-input";

/**
 * b-roll 编排层（docs/roadmap/2026-08-02-broll-assembly-plan.md）。
 * 选片与缺段 gate 已由 broll-plan.test.ts 覆盖；这里守编排层自己的决策：
 * 段时长夹取、音色映射、后期快照纪律（口播不二次覆盖 / 字幕以 script 为源）。
 */

/// TTS 测试全部走注入的 fake fetch，不出网；假 key 只为过 provider 的存在性检查。
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-key-not-real";

test("段时长：口播驱动，夹取到最短 2s 并留呼吸间隙", () => {
  assert.equal(segmentDurationSec(0.4), 2);
  assert.equal(segmentDurationSec(1.65), 2);
  assert.equal(segmentDurationSec(3), 3.35);
  assert.equal(segmentDurationSec(8.2), 8.55);
});

test("音色映射：产品音色 id → OpenAI voice，未识别一律 nova", () => {
  assert.equal(resolveTtsVoice("warm-confident"), "nova");
  assert.equal(resolveTtsVoice("natural-friendly"), "shimmer");
  assert.equal(resolveTtsVoice("energetic-creator"), "alloy");
  assert.equal(resolveTtsVoice("unknown-style"), "nova");
  assert.equal(resolveTtsVoice(null), "nova");
  assert.equal(resolveTtsVoice(undefined), "nova");
});

test("后期快照：通过契约校验，口播 enabled=false（TTS 已烘进段音轨，绝不二次覆盖）", () => {
  const snapshot = buildBrollPostProduction({
    script: "很多人不知道窗户该怎么量。我们免费上门。",
    voiceId: "warm-confident",
    bgmTrackId: "wholesome",
    captionsEnabled: true,
  });
  const parsed = postProductionPlanSchema.parse(snapshot);
  assert.equal(parsed.audio.voiceover.enabled, false);
  /// 字幕的文本源必须是完整口播稿
  assert.equal(parsed.audio.voiceover.script.includes("免费上门"), true);
  assert.equal(parsed.audio.voiceover.language, "zh");
  assert.equal(parsed.captions.language, "zh");
  assert.equal(parsed.captions.exportSrt, true);
  assert.equal(parsed.audio.bgm.trackId, "wholesome");
  assert.ok(parsed.audio.bgm.volume > 0 && parsed.audio.bgm.volume <= 0.35);
});

test("后期快照：英文脚本判英文，bgm=none 时音量为 0", () => {
  const snapshot = buildBrollPostProduction({
    script: "Most people measure windows wrong. We do it free.",
    voiceId: "natural-friendly",
    bgmTrackId: "none",
    captionsEnabled: false,
  });
  assert.equal(snapshot.audio.voiceover.language, "en");
  assert.equal(snapshot.audio.bgm.volume, 0);
  assert.equal(snapshot.captions.enabled, false);
});

function fakeTtsFetch(status: number, body: BufferSource | string): typeof fetch {
  return (async () =>
    new Response(body as BodyInit, { status })) as unknown as typeof fetch;
}

test("TTS 错误分类：429/5xx 可重试，4xx 不可重试，短音频判异常", async () => {
  await assert.rejects(
    synthesizeVoiceover({ text: "你好", fetchImpl: fakeTtsFetch(429, "rate limited") }),
    (err: unknown) => err instanceof OpenAiTtsError && err.retryable && err.status === 429,
  );
  await assert.rejects(
    synthesizeVoiceover({ text: "你好", fetchImpl: fakeTtsFetch(400, "bad request") }),
    (err: unknown) => err instanceof OpenAiTtsError && !err.retryable && err.status === 400,
  );
  /// 200 但音频小于 1KB：供应商异常返回，判可重试
  await assert.rejects(
    synthesizeVoiceover({ text: "你好", fetchImpl: fakeTtsFetch(200, Buffer.alloc(64)) }),
    (err: unknown) => err instanceof OpenAiTtsError && err.retryable,
  );
});

test("TTS 正常路径：返回音频 Buffer", async () => {
  const audio = Buffer.alloc(4096, 1);
  const result = await synthesizeVoiceover({
    text: "让每一扇窗都刚刚好",
    voiceId: "warm-confident",
    fetchImpl: fakeTtsFetch(200, audio),
  });
  assert.equal(result.byteLength, 4096);
});
