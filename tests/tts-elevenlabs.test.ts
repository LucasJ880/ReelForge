import assert from "node:assert/strict";
import test from "node:test";

import { getTtsProvider, isTtsConfigured, resolveTtsProviderId, TtsError, VOICE_MAP } from "../src/lib/providers/tts";
import {
  ELEVENLABS_API_BASE,
  ELEVENLABS_DEFAULT_TTS_MODEL,
  elevenLabsTtsEndpoint,
  wordsFromCharacterAlignment,
} from "../src/lib/providers/tts/elevenlabs";
import { probeTts } from "../src/lib/services/capability-probe-service";
import { capabilityConfiguration, capabilityProviders } from "../src/lib/services/capability-status-service";

/**
 * P04-A2 · ElevenLabs 逐词 TTS 适配器。全部走注入的 fetch / env，不出网、不读真实 key。
 * 真机判据（E3b 时间戳偏差、E16 金标）等 key 到位后在验收文档里记。
 */

const ENV = { TTS_PROVIDER: "elevenlabs", ELEVENLABS_API_KEY: "xi-test-not-real" };

type Captured = { url: string; init: RequestInit };

function recordingFetch(status: number, body: BodyInit, captured: Captured[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
}

function alignmentOf(text: string, stepSec = 0.1) {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * stepSec),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * stepSec),
  };
}

test("选择与配置：TTS_PROVIDER=elevenlabs 需要 ELEVENLABS_API_KEY；capabilityConfiguration.voice 与之同一判据", () => {
  assert.equal(resolveTtsProviderId(ENV), "elevenlabs");
  assert.equal(isTtsConfigured(ENV), true);
  assert.equal(isTtsConfigured({ TTS_PROVIDER: "elevenlabs", OPENAI_API_KEY: "sk" }), false);
  assert.equal(capabilityConfiguration(ENV).voice, true);
  assert.deepEqual(capabilityProviders(ENV), { voice: "elevenlabs" });
  assert.ok(VOICE_MAP.elevenlabs.voices["calm-premium"]);
});

test("字符对齐 → 逐词：英文按空白切词、标点并入前词；中文逐字；混排各按各的", () => {
  const en = wordsFromCharacterAlignment(alignmentOf("Hi there, world!"));
  assert.deepEqual(en.map((w) => w.text), ["Hi", "there,", "world!"]);
  assert.deepEqual(en[0], { text: "Hi", startMs: 0, endMs: 200 });
  assert.deepEqual(en[1], { text: "there,", startMs: 300, endMs: 900 });

  const zh = wordsFromCharacterAlignment(alignmentOf("你好，世界"));
  assert.deepEqual(zh.map((w) => w.text), ["你", "好，", "世", "界"]);
  assert.deepEqual(zh[1], { text: "好，", startMs: 100, endMs: 300 });

  const mixed = wordsFromCharacterAlignment(alignmentOf("用 iPhone 拍"));
  assert.deepEqual(mixed.map((w) => w.text), ["用", "iPhone", "拍"]);
});

test("字符对齐：时间缺失 / 非数的字符被跳过，词不因此断裂", () => {
  const words = wordsFromCharacterAlignment({
    characters: ["a", "b", " ", "c"],
    character_start_times_seconds: [0, Number.NaN, 0.2, 0.3],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4],
  });
  assert.deepEqual(words, [
    { text: "a", startMs: 0, endMs: 100 },
    { text: "c", startMs: 300, endMs: 400 },
  ]);
});

test("合成：打 with-timestamps 端点、xi-api-key 头、缺省模型；结果带 words 与 durationMs，supportsWordTimestamps=true", async () => {
  const captured: Captured[] = [];
  const audio = Buffer.alloc(4096, 1).toString("base64");
  const provider = getTtsProvider({
    env: ENV,
    fetchImpl: recordingFetch(
      200,
      JSON.stringify({ audio_base64: audio, alignment: alignmentOf("Hello world") }),
      captured,
    ),
  });
  assert.equal(provider.id, "elevenlabs");
  assert.equal(provider.model, ELEVENLABS_DEFAULT_TTS_MODEL);
  assert.equal(provider.supportsWordTimestamps, true);

  const result = await provider.synthesize({ text: "Hello world", voiceId: "energetic-creator", language: "en" });
  assert.equal(result.mime, "audio/mpeg");
  assert.equal(result.audio.byteLength, 4096);
  assert.deepEqual(result.words?.map((w) => w.text), ["Hello", "world"]);
  assert.equal(result.durationMs, 1100);

  assert.equal(captured[0]!.url, elevenLabsTtsEndpoint(VOICE_MAP.elevenlabs.voices["energetic-creator"]));
  assert.match(captured[0]!.url, /\/with-timestamps\?output_format=mp3_44100_128$/);
  const headers = captured[0]!.init.headers as Record<string, string>;
  assert.equal(headers["xi-api-key"], ENV.ELEVENLABS_API_KEY);
  assert.deepEqual(JSON.parse(String(captured[0]!.init.body)), { text: "Hello world", model_id: ELEVENLABS_DEFAULT_TTS_MODEL });
});

test("合成：ELEVENLABS_TTS_MODEL 覆盖模型；未知音色落到 fallback；没有 alignment 时 words 留空而不是估算", async () => {
  const captured: Captured[] = [];
  const provider = getTtsProvider({
    env: { ...ENV, ELEVENLABS_TTS_MODEL: "eleven_flash_v2_5" },
    fetchImpl: recordingFetch(200, JSON.stringify({ audio_base64: Buffer.alloc(2048, 1).toString("base64") }), captured),
  });
  assert.equal(provider.model, "eleven_flash_v2_5");
  const result = await provider.synthesize({ text: "ok", voiceId: "not-a-voice", language: "zh" });
  assert.equal(result.words, undefined);
  assert.equal(result.durationMs, undefined);
  assert.equal(captured[0]!.url, elevenLabsTtsEndpoint(VOICE_MAP.elevenlabs.fallback));
  assert.equal(JSON.parse(String(captured[0]!.init.body)).model_id, "eleven_flash_v2_5");
});

test("错误分类：401 不可重试、429 / 5xx 可重试、无 key 不出网；错误信息不含 key", async () => {
  for (const [status, retryable] of [[401, false], [429, true], [503, true]] as const) {
    const provider = getTtsProvider({ env: ENV, fetchImpl: recordingFetch(status, "nope") });
    await assert.rejects(
      provider.synthesize({ text: "x", language: "en" }),
      (error: unknown) => {
        assert.ok(error instanceof TtsError);
        assert.equal(error.provider, "elevenlabs");
        assert.equal(error.status, status);
        assert.equal(error.retryable, retryable);
        assert.doesNotMatch(error.message, /xi-test-not-real/);
        return true;
      },
    );
  }
  const captured: Captured[] = [];
  const unconfigured = getTtsProvider({ env: { TTS_PROVIDER: "elevenlabs" }, fetchImpl: recordingFetch(200, "", captured) });
  await assert.rejects(unconfigured.synthesize({ text: "x", language: "en" }), /ELEVENLABS_API_KEY/);
  assert.equal(captured.length, 0);
});

test("探测按供应商：elevenlabs 打 GET /v1/user（不耗额度），401 → auth 暂停；无 key → not_configured", async () => {
  const captured: Captured[] = [];
  const ok = await probeTts({ env: ENV, fetchImpl: recordingFetch(200, "{}", captured), timeoutMs: 1_000 });
  assert.equal(ok.status, "available");
  assert.equal(ok.detail?.provider, "elevenlabs");
  assert.equal(captured[0]!.url, `${ELEVENLABS_API_BASE}/v1/user`);
  assert.equal((captured[0]!.init.headers as Record<string, string>)["xi-api-key"], ENV.ELEVENLABS_API_KEY);

  const unauthorized = await probeTts({ env: ENV, fetchImpl: recordingFetch(401, "{}"), timeoutMs: 1_000 });
  assert.equal(unauthorized.reason, "auth");

  const missing = await probeTts({ env: { TTS_PROVIDER: "elevenlabs" }, fetchImpl: recordingFetch(200, ""), timeoutMs: 1_000 });
  assert.equal(missing.status, "not_configured");
});
