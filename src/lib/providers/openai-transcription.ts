/**
 * 语音识别（2026-11-10 · 字幕对齐）：把成片里 AI 段的音轨交给 OpenAI 转写，拿每个字 / 词实际说出的时间，
 * 字幕据此跟着人声走（alignCuesToSpeech）。不改口播、不改画面，只影响字幕什么时候出现。
 *
 * 为什么是 whisper-1：转写接口里只有它支持 `response_format=verbose_json` + `timestamp_granularities[]=word`
 *（逐词时间）；gpt-4o-transcribe 系列只回 json / text，没有时间。
 *
 * 缺省关：Vercel 设 `CAPTION_SPEECH_ALIGN=on` 才调用，并且这把 OPENAI_API_KEY 要有 whisper-1 的权限
 *（2026-11-10 查过：当时密钥的 22 个模型里没有任何转写模型，需要在 OpenAI 项目里开通）。
 * 没开、没权限、超时、报错、回来的东西不对——一律返回 null，字幕照旧按字数摊，合成不受影响。
 *
 * 只用 fetch，不引 SDK：合成函数的体积不涨。日志只留状态码与截断的错误体，不落密钥、不落口播稿。
 */
import { readFile } from "node:fs/promises";
import type { SpokenWord } from "@/lib/video-generation/audio-post-production";

export const OPENAI_TRANSCRIPTION_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
export const OPENAI_TRANSCRIPTION_MODEL = "whisper-1";
/** 15 秒的音频实际 1–3 秒回来；等不到就放弃，不拖住合成 */
export const TRANSCRIPTION_TIMEOUT_MS = 20_000;

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** 开关开着、而且有密钥，才去识别。 */
export function captionSpeechAlignEnabled(env: EnvLike = process.env): boolean {
  return env.CAPTION_SPEECH_ALIGN?.trim().toLowerCase() === "on" && Boolean(env.OPENAI_API_KEY?.trim());
}

/** "zh-CN" → "zh"；接口只认 ISO-639-1。认不出就不传，让模型自己判断。 */
export function transcriptionLanguage(language: string | null | undefined): string | null {
  const code = language?.trim().toLowerCase().split(/[-_]/u)[0] ?? "";
  return /^[a-z]{2}$/u.test(code) ? code : null;
}

/**
 * verbose_json → 逐词时间（毫秒）。接口回的是秒：`words: [{ word, start, end }]`。
 * 形状不对、一个词都没有 → 空数组（调用方当作没识别出来）。
 */
export function parseTranscriptionWords(payload: unknown): SpokenWord[] {
  const rows = (payload as { words?: unknown } | null)?.words;
  if (!Array.isArray(rows)) return [];
  const words: SpokenWord[] = [];
  for (const row of rows) {
    const { word, start, end } = (row ?? {}) as { word?: unknown; start?: unknown; end?: unknown };
    if (typeof word !== "string" || typeof start !== "number" || typeof end !== "number") continue;
    if (!word.trim() || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) continue;
    words.push({ text: word.trim(), startMs: Math.round(start * 1_000), endMs: Math.round(end * 1_000) });
  }
  return words;
}

export interface TranscribeSpeechArgs {
  /** 本地音频文件（管线抽好的 16k 单声道 wav） */
  audioPath: string;
  /** 口播 / 字幕语言，如 zh-CN、en-US */
  language?: string | null;
  timeoutMs?: number;
}

export interface TranscribeSpeechDeps {
  fetchImpl?: typeof fetch;
  env?: EnvLike;
  readAudio?: (path: string) => Promise<Uint8Array>;
}

/**
 * 识别一段音频里的逐词时间。拿不到就返回 null，从不抛错——字幕对齐是锦上添花，不能把合成带崩。
 */
export async function transcribeSpeechWithOpenAi(
  args: TranscribeSpeechArgs,
  deps: TranscribeSpeechDeps = {},
): Promise<SpokenWord[] | null> {
  const env = deps.env ?? process.env;
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const startedAt = Date.now();
  try {
    const audio = await (deps.readAudio ?? readFile)(args.audioPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "speech.wav");
    form.append("model", OPENAI_TRANSCRIPTION_MODEL);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    const language = transcriptionLanguage(args.language);
    if (language) form.append("language", language);
    /// 不把口播稿当提示词喂进去：音轨里没说的话，模型可能照着提示词「听」出来，还带上编造的时间。
    /// 只给一句中性的简体提示，减少中文被写成繁体（写成繁体也对得上一部分，对齐逻辑扛得住）。
    if (language === "zh") form.append("prompt", "以下是普通话的句子。");

    const response = await (deps.fetchImpl ?? fetch)(OPENAI_TRANSCRIPTION_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(args.timeoutMs ?? TRANSCRIPTION_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = (await response.text().catch(() => "")).replace(/\s+/gu, " ").slice(0, 200);
      console.warn(`[captions] speech transcription failed: HTTP ${response.status} ${body}`);
      return null;
    }
    const words = parseTranscriptionWords(await response.json());
    if (words.length === 0) {
      console.warn("[captions] speech transcription returned no word timestamps");
      return null;
    }
    console.log(`[captions] speech transcription ok in ${Date.now() - startedAt}ms (${words.length} words)`);
    return words;
  } catch (error) {
    console.warn("[captions] speech transcription unavailable:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
