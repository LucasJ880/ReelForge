import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  getTtsProvider,
  isTtsConfigured,
  PRODUCT_VOICE_IDS,
  resolveTtsProviderId,
  resolveTtsVoice,
  TTS_PROVIDER_IDS,
  TtsError,
  VOICE_MAP,
} from "../src/lib/providers/tts";
import { OPENAI_TTS_ENDPOINT, OPENAI_TTS_MODEL } from "../src/lib/providers/tts/openai";
import { resolveCapabilities, CAPABILITY_KEYS, type CapabilityKey, type CapabilityRecord } from "../src/lib/capabilities/registry";
import { probeTts } from "../src/lib/services/capability-probe-service";
import { capabilityConfiguration, capabilityProviders } from "../src/lib/services/capability-status-service";

/**
 * P04-A1 · TtsProvider 抽象。全部走注入的 fetch / env，不出网、不读真实 key。
 */

const ENV = { OPENAI_API_KEY: "sk-test-not-real" };

type Captured = { url: string; init: RequestInit };

function recordingFetch(status: number, body: BodyInit, captured: Captured[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
}

test("选择：TTS_PROVIDER 缺省 / 大小写 / 空白都落到 openai；未知值回落 openai 且只记一次日志", (t) => {
  assert.equal(resolveTtsProviderId({}), "openai");
  assert.equal(resolveTtsProviderId({ TTS_PROVIDER: " OpenAI " }), "openai");
  assert.equal(resolveTtsProviderId({ TTS_PROVIDER: "" }), "openai");

  const warn = t.mock.method(console, "warn", () => {});
  assert.equal(resolveTtsProviderId({ TTS_PROVIDER: "elevenlab-typo" }), "openai");
  assert.equal(resolveTtsProviderId({ TTS_PROVIDER: "elevenlab-typo" }), "openai");
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0]!.arguments[0]), /elevenlab-typo/);
});

test("配置判据按供应商：openai 需要 OPENAI_API_KEY；capabilityConfiguration.voice 与之同一判据", (t) => {
  t.mock.method(console, "warn", () => {});
  assert.equal(isTtsConfigured(ENV), true);
  assert.equal(isTtsConfigured({ OPENAI_API_KEY: "  " }), false);
  assert.equal(isTtsConfigured({ TTS_PROVIDER: "unknown-x", OPENAI_API_KEY: "sk" }), true);
  assert.equal(capabilityConfiguration(ENV).voice, true);
  assert.equal(capabilityConfiguration({}).voice, false);
  assert.deepEqual(capabilityProviders(ENV), { voice: "openai" });
});

test("音色表：每家供应商覆盖全部产品音色（含 calm-premium），且与创作页 VOICE_OPTIONS 同一套 id", () => {
  for (const provider of TTS_PROVIDER_IDS) {
    for (const voiceId of PRODUCT_VOICE_IDS) {
      assert.ok(VOICE_MAP[provider].voices[voiceId], `${provider} 缺 ${voiceId}`);
    }
  }
  assert.equal(resolveTtsVoice("openai", "calm-premium"), "onyx");
  assert.equal(resolveTtsVoice("openai", "nope"), VOICE_MAP.openai.fallback);

  const controls = readFileSync("src/components/video-generation/audio-caption-controls.tsx", "utf8");
  const block = controls.slice(controls.indexOf("const VOICE_OPTIONS"), controls.indexOf("] as const;"));
  const uiIds = [...block.matchAll(/id: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(uiIds, [...PRODUCT_VOICE_IDS]);
});

test("OpenAI 实现：打生产端点与模型，音色经表映射，文本去首尾空白；结果形状 {audio, mime}，不编时长与逐词", async () => {
  const captured: Captured[] = [];
  const provider = getTtsProvider({ env: ENV, fetchImpl: recordingFetch(200, new Uint8Array(4096), captured) });
  assert.equal(provider.id, "openai");
  assert.equal(provider.model, OPENAI_TTS_MODEL);
  assert.equal(provider.supportsWordTimestamps, false);

  const result = await provider.synthesize({ text: "  沉稳一点  ", voiceId: "calm-premium", language: "zh" });
  assert.equal(result.audio.byteLength, 4096);
  assert.equal(result.mime, "audio/mpeg");
  assert.equal(result.durationMs, undefined);
  assert.equal(result.words, undefined);

  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.url, OPENAI_TTS_ENDPOINT);
  const body = JSON.parse(String(captured[0]!.init.body));
  assert.deepEqual(body, { model: OPENAI_TTS_MODEL, voice: "onyx", input: "沉稳一点", response_format: "mp3" });
  assert.equal((captured[0]!.init.headers as Record<string, string>).Authorization, `Bearer ${ENV.OPENAI_API_KEY}`);
});

test("OpenAI 实现：缺 key / 空文本在发请求之前就拒绝（不可重试）", async () => {
  const captured: Captured[] = [];
  const fetchImpl = recordingFetch(200, new Uint8Array(4096), captured);
  await assert.rejects(
    getTtsProvider({ env: {}, fetchImpl }).synthesize({ text: "你好", language: "zh" }),
    (err: unknown) => err instanceof TtsError && !err.retryable && err.provider === "openai",
  );
  await assert.rejects(
    getTtsProvider({ env: ENV, fetchImpl }).synthesize({ text: "   ", language: "zh" }),
    (err: unknown) => err instanceof TtsError && !err.retryable,
  );
  assert.equal(captured.length, 0);
});

test("未知 TTS_PROVIDER：getTtsProvider 仍返回可用的 openai 实现", async (t) => {
  t.mock.method(console, "warn", () => {});
  const provider = getTtsProvider({
    env: { ...ENV, TTS_PROVIDER: "not-a-vendor" },
    fetchImpl: recordingFetch(200, new Uint8Array(2048)),
  });
  assert.equal(provider.id, "openai");
  assert.equal((await provider.synthesize({ text: "ok", language: "en" })).audio.byteLength, 2048);
});

test("探测按供应商：probeTts 打的是当前供应商的生产端点与模型，detail 标明供应商", async () => {
  const captured: Captured[] = [];
  const observation = await probeTts({
    env: ENV,
    fetchImpl: recordingFetch(200, new Uint8Array(16), captured),
    timeoutMs: 1_000,
  });
  assert.equal(observation.status, "available");
  assert.equal(observation.detail?.provider, "openai");
  assert.equal(observation.detail?.model, OPENAI_TTS_MODEL);
  assert.equal(captured[0]!.url, OPENAI_TTS_ENDPOINT);
  assert.equal(JSON.parse(String(captured[0]!.init.body)).voice, VOICE_MAP.openai.fallback);

  const missing = await probeTts({ env: {}, fetchImpl: recordingFetch(200, ""), timeoutMs: 1_000 });
  assert.equal(missing.status, "not_configured");
});

const NOW = new Date("2026-10-26T12:00:00.000Z");
const ALL_CONFIGURED = Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, true])) as Record<CapabilityKey, boolean>;

function accountOutageView(providers?: { voice?: string }) {
  const records: CapabilityRecord[] = [
    {
      key: "text",
      status: "unavailable",
      reason: "quota",
      source: "probe",
      checkedAt: NOW.toISOString(),
      failingSince: NOW.toISOString(),
    },
    {
      key: "voice",
      status: "available",
      reason: "ok",
      source: "runtime",
      checkedAt: new Date(NOW.getTime() - 60_000).toISOString(),
      failingSince: null,
    },
  ];
  const view = resolveCapabilities({ records, configured: ALL_CONFIGURED, providers, now: NOW });
  return view.items.find((item) => item.key === "voice")!;
}

test("注册表联动：OpenAI 账户停摆只在配音走 OpenAI 时连带暂停配音", () => {
  assert.equal(accountOutageView().status, "unavailable", "缺省视为 openai（切换前行为）");
  assert.equal(accountOutageView({ voice: "openai" }).status, "unavailable");
  const other = accountOutageView({ voice: "another-vendor" });
  assert.equal(other.status, "available");
  assert.equal(other.reason, "ok");
});

test("封存护栏：tts 目录不叫 volc-tts、不出现 synthesizeSpeech / 火山 TTS 字样", () => {
  const dir = "src/lib/providers/tts";
  for (const file of readdirSync(dir)) {
    assert.doesNotMatch(file, /volc/i);
    assert.doesNotMatch(readFileSync(`${dir}/${file}`, "utf8"), /synthesizeSpeech|volc-tts|submitTts/);
  }
});
