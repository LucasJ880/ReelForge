import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  captionSpeechAlignEnabled,
  OPENAI_TRANSCRIPTION_ENDPOINT,
  OPENAI_TRANSCRIPTION_MODEL,
  parseTranscriptionWords,
  transcribeSpeechWithOpenAi,
  transcriptionLanguage,
} from "../src/lib/providers/openai-transcription";
import { composeTimeline, type SpeechTranscriber } from "../src/lib/media/stitch-pipeline";
import { probeMedia } from "../src/lib/media/ffmpeg-bin";
import type { PostProductionPlan } from "../src/types/video-generation";
import { ffmpegHasLibass, ffmpegUsable, makeClip, useBundledCjkFont } from "./helpers/synthetic-media";

/**
 * 2026-11-10 字幕对齐的「识别来源」与接线：
 *   - OpenAI 转写调用：请求长什么样、回来的东西怎么读、任何失败都只是返回 null；
 *   - 合成管线：给了识别器，字幕跟着人声走；识别器不行，成片照出、字幕照旧。
 */

const SCRIPT = "三个颜色，通勤、约会、周末都够用。今天选珊瑚，抿一下就出门。";

function captionPlan(): PostProductionPlan {
  return {
    audio: {
      voiceover: { enabled: true, voiceId: "warm-confident", language: "zh-CN", script: SCRIPT },
      bgm: { trackId: "none", volume: 0 },
    },
    captions: { enabled: true, style: "word_by_word", language: "zh-CN", position: "bottom", exportSrt: true },
  } as PostProductionPlan;
}

test("开关：缺省关；CAPTION_SPEECH_ALIGN=on 且有密钥才识别", () => {
  assert.equal(captionSpeechAlignEnabled({}), false);
  assert.equal(captionSpeechAlignEnabled({ OPENAI_API_KEY: "sk-test" }), false);
  assert.equal(captionSpeechAlignEnabled({ CAPTION_SPEECH_ALIGN: "on" }), false, "没有密钥不算开");
  assert.equal(captionSpeechAlignEnabled({ CAPTION_SPEECH_ALIGN: "off", OPENAI_API_KEY: "sk-test" }), false);
  assert.equal(captionSpeechAlignEnabled({ CAPTION_SPEECH_ALIGN: " ON ", OPENAI_API_KEY: "sk-test" }), true);
});

test("语言与返回值：zh-CN → zh；verbose_json 的秒换成毫秒，坏行丢掉", () => {
  assert.equal(transcriptionLanguage("zh-CN"), "zh");
  assert.equal(transcriptionLanguage("en_US"), "en");
  assert.equal(transcriptionLanguage(""), null);
  assert.equal(transcriptionLanguage(null), null);
  assert.deepEqual(
    parseTranscriptionWords({
      text: "今天选珊瑚",
      words: [
        { word: "今天", start: 4.33, end: 4.74 },
        { word: " 选 ", start: 4.74, end: 5.02 },
        { word: "", start: 5.1, end: 5.2 },
        { word: "坏", start: 6, end: 5 },
        { word: "也坏", start: "7", end: 8 },
        null,
      ],
    }),
    [
      { text: "今天", startMs: 4330, endMs: 4740 },
      { text: "选", startMs: 4740, endMs: 5020 },
    ],
  );
  assert.deepEqual(parseTranscriptionWords({ text: "没有 words 字段" }), []);
  assert.deepEqual(parseTranscriptionWords(null), []);
});

test("请求：打转写端点，whisper-1 + verbose_json + 逐词时间；不把口播稿喂给模型", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ words: [{ word: "今天", start: 0.5, end: 0.9 }] }), { status: 200 });
  }) as typeof fetch;
  const words = await transcribeSpeechWithOpenAi(
    { audioPath: "/tmp/does-not-matter.wav", language: "zh-CN" },
    { fetchImpl, env: { OPENAI_API_KEY: "sk-test" }, readAudio: async () => new Uint8Array([1, 2, 3, 4]) },
  );
  assert.deepEqual(words, [{ text: "今天", startMs: 500, endMs: 900 }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OPENAI_TRANSCRIPTION_ENDPOINT);
  assert.equal(OPENAI_TRANSCRIPTION_ENDPOINT, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer sk-test");
  const form = calls[0].init.body as FormData;
  assert.equal(form.get("model"), OPENAI_TRANSCRIPTION_MODEL);
  assert.equal(OPENAI_TRANSCRIPTION_MODEL, "whisper-1", "只有 whisper-1 给逐词时间");
  assert.equal(form.get("response_format"), "verbose_json");
  assert.deepEqual(form.getAll("timestamp_granularities[]"), ["word"]);
  assert.equal(form.get("language"), "zh");
  assert.ok(form.get("file") instanceof Blob);
  assert.ok(!String(form.get("prompt") ?? "").includes("珊瑚"), "口播稿不进提示词：没说的话不能被「听」出来");
  assert.ok(calls[0].init.signal instanceof AbortSignal, "带超时");
});

test("任何失败都只是返回 null：没密钥、没权限、超时、读不到文件、回来没有词", async () => {
  const ok = { readAudio: async () => new Uint8Array([1]) };
  /// 没密钥：不发请求
  let called = 0;
  const counting = (async () => {
    called++;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  assert.equal(await transcribeSpeechWithOpenAi({ audioPath: "a.wav" }, { ...ok, fetchImpl: counting, env: {} }), null);
  assert.equal(called, 0);
  /// 没有模型权限（2026-11-10 生产密钥的现状）
  const forbidden = (async () =>
    new Response(JSON.stringify({ error: { message: "Project does not have access to model whisper-1", code: "model_not_found" } }), { status: 403 })) as typeof fetch;
  assert.equal(await transcribeSpeechWithOpenAi({ audioPath: "a.wav" }, { ...ok, fetchImpl: forbidden, env: { OPENAI_API_KEY: "sk-test" } }), null);
  /// 超时 / 网络断
  const hanging = (async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }) as typeof fetch;
  assert.equal(await transcribeSpeechWithOpenAi({ audioPath: "a.wav" }, { ...ok, fetchImpl: hanging, env: { OPENAI_API_KEY: "sk-test" } }), null);
  /// 文件读不到
  assert.equal(
    await transcribeSpeechWithOpenAi(
      { audioPath: "missing.wav" },
      { fetchImpl: counting, env: { OPENAI_API_KEY: "sk-test" }, readAudio: async () => { throw new Error("ENOENT"); } },
    ),
    null,
  );
  /// 200 但没有逐词时间
  const empty = (async () => new Response(JSON.stringify({ text: "今天" }), { status: 200 })) as typeof fetch;
  assert.equal(await transcribeSpeechWithOpenAi({ audioPath: "a.wav" }, { ...ok, fetchImpl: empty, env: { OPENAI_API_KEY: "sk-test" } }), null);
});

test("生产入口按开关注入识别器；管线自己不认识供应商", () => {
  const service = readFileSync("src/lib/services/stitch-service.ts", "utf8");
  assert.match(service, /transcribeSpeech: captionSpeechAlignEnabled\(\)\s+\? \(\{ audioPath, language \}\) => transcribeSpeechWithOpenAi\(\{ audioPath, language \}\)\s+: null,/);
  const pipeline = readFileSync("src/lib/media/stitch-pipeline.ts", "utf8");
  assert.ok(!/from "@\/lib\/providers\//.test(pipeline), "管线是纯合成：不引任何供应商模块，识别谁来做由调用方定");
  const provider = readFileSync("src/lib/providers/openai-transcription.ts", "utf8");
  assert.doesNotMatch(provider, /from "openai"/, "只用 fetch，不把 SDK 打进合成函数");
});

test("integration：给了识别器，成片字幕跟着人声走；SRT 里第二句从人声开口处开始", async (t) => {
  if (!(await ffmpegUsable())) return t.skip("ffmpeg not installed");
  if (!(await ffmpegHasLibass())) return t.skip("ffmpeg has no libass");
  if (!useBundledCjkFont(t)) return t.skip("bundled CJK font missing");
  const dir = mkdtempSync(path.join(tmpdir(), "caption-speech-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clip = await makeClip(path.join(dir, "ai.mp4"), { durationSec: 10, audio: { kind: "tone", hz: 440, speechSec: 8 } });
  const heard: Array<{ audioPath: string; language: string | null; durationSec: number }> = [];
  /// 识别器回的是「这一段音频里」的时间：第一句 0.2–3.8 秒，第二句 4.3–7.3 秒
  const transcribe: SpeechTranscriber = async (args) => {
    heard.push(args);
    assert.equal((await probeMedia(args.audioPath)).hasAudio, true, "交给识别器的是抽好的音轨");
    return [
      { text: "三个颜色通勤约会周末都够用", startMs: 200, endMs: 3800 },
      { text: "今天选珊瑚抿一下就出门", startMs: 4300, endMs: 7300 },
    ];
  };
  const base = {
    clips: [{ path: clip, intendedDurationSec: 10, trimToFit: true, role: "ai_generated" as const }],
    aspectRatio: "9:16",
    postProduction: captionPlan(),
  };
  const before = await composeTimeline({ ...base, workDir: path.join(dir, "before") });
  const after = await composeTimeline({ ...base, workDir: path.join(dir, "after"), transcribeSpeech: transcribe });

  assert.notEqual(before.captionSource, "speech");
  assert.equal(after.captionSource, "speech");
  assert.equal(heard.length, 1);
  assert.equal(heard[0].language, "zh-CN");
  assert.ok(Math.abs(heard[0].durationSec - 10) < 0.1);

  const secondStart = (srtPath: string | null) => {
    const match = readFileSync(srtPath as string, "utf8").match(/\n2\n(\d\d):(\d\d):(\d\d),(\d\d\d) -->/u);
    assert.ok(match, "SRT 里有第二句");
    return Number(match[2]) * 60_000 + Number(match[3]) * 1_000 + Number(match[4]);
  };
  /// 按字数摊：第二句要等到 5 秒多；跟着人声：4.3 秒开口前一点就换上去
  assert.ok(secondStart(before.srtPath) > 5_000, `before ${secondStart(before.srtPath)}`);
  assert.ok(Math.abs(secondStart(after.srtPath) - 4_180) <= 150, `after ${secondStart(after.srtPath)}`);
  assert.equal(after.applied.captions, true);
  assert.ok((await probeMedia(after.videoPath)).durationSec, "成片照常产出");
});

test("integration：识别器抛错或返回 null，成片照出，字幕照旧按字数摊", async (t) => {
  if (!(await ffmpegUsable())) return t.skip("ffmpeg not installed");
  if (!(await ffmpegHasLibass())) return t.skip("ffmpeg has no libass");
  if (!useBundledCjkFont(t)) return t.skip("bundled CJK font missing");
  const dir = mkdtempSync(path.join(tmpdir(), "caption-speech-fail-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clip = await makeClip(path.join(dir, "ai.mp4"), { durationSec: 6, audio: { kind: "tone", hz: 440, speechSec: 5 } });
  const base = {
    clips: [{ path: clip, intendedDurationSec: 6, trimToFit: true, role: "ai_generated" as const }],
    aspectRatio: "9:16",
    postProduction: captionPlan(),
  };
  const plain = await composeTimeline({ ...base, workDir: path.join(dir, "plain") });
  const thrown = await composeTimeline({
    ...base,
    workDir: path.join(dir, "thrown"),
    transcribeSpeech: async () => {
      throw new Error("provider exploded");
    },
  });
  const nothing = await composeTimeline({ ...base, workDir: path.join(dir, "nothing"), transcribeSpeech: async () => null });
  for (const result of [thrown, nothing]) {
    assert.equal(result.captionSource, plain.captionSource);
    assert.equal(result.applied.captions, true);
    assert.equal(readFileSync(result.srtPath as string, "utf8"), readFileSync(plain.srtPath as string, "utf8"));
  }
});
