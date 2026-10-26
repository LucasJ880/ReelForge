/**
 * ElevenLabs TTS 实现（P04-A2，第二家供应商，带逐词时间戳）。
 *
 * 为什么是 ElevenLabs：OpenAI tts-1 / gpt-4o-mini-tts 于 2027-01-06 关停，E3a 证实生产 key 没有
 * realtime 模型，替代只能是第三方；字幕逐词高亮（P04-B）与后置对口型（P04-F）都要供应商原生的
 * 时间戳而不是估算，`/with-timestamps` 端点直接给字符级对齐。MiniMax 作为备选等 E3b 对比后再接。
 *
 * 只用 `ELEVENLABS_API_KEY`；无 key 时诚实不可用，不 mock。
 * 字符对齐 → 逐词：中文逐字（字幕按字高亮）、拉丁文按空白切词、标点并入前一个词。
 */

import { markCapability } from "@/lib/services/capability-status-service";
import { isTtsProviderConfigured } from "@/lib/providers/tts/config";
import {
  TtsError,
  type TtsProvider,
  type TtsSynthesizeInput,
  type TtsSynthesizeResult,
  type TtsWord,
} from "@/lib/providers/tts/types";
import { resolveTtsVoice } from "@/lib/providers/tts/voices";

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

export const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";
/** 缺省模型：多语种（含中文）、质量档；E3b 若证明 flash 档延迟 / 价格更合适再换。 */
export const ELEVENLABS_DEFAULT_TTS_MODEL = "eleven_multilingual_v2";
/** 44.1kHz 128kbps mp3：与 OpenAI 实现同为 audio/mpeg，下游 ffmpeg 混音链路不变。 */
export const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";

export function resolveElevenLabsTtsModel(env: EnvLike = process.env): string {
  return env.ELEVENLABS_TTS_MODEL?.trim() || ELEVENLABS_DEFAULT_TTS_MODEL;
}

export function elevenLabsTtsEndpoint(voiceId: string): string {
  return `${ELEVENLABS_API_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${ELEVENLABS_OUTPUT_FORMAT}`;
}

/** ElevenLabs 响应里的字符级对齐（秒）。 */
export interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

const CJK = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
const WORD_CHAR = /[\p{L}\p{N}'’]/u;

/**
 * 字符对齐 → 逐词（纯函数）。规则：
 * - 空白切词，空白本身不进任何词；
 * - CJK 字符各自成词（字幕逐字高亮；两端都切）；
 * - 其它字符（字母 / 数字 / 撇号）累积成词；标点并入正在累积的词，没有在累积的词就并入前一个词；
 * - 时间取词内首字符起点与末字符终点，毫秒取整；非法（起止缺失 / 终点早于起点）的词丢弃。
 */
export function wordsFromCharacterAlignment(alignment: ElevenLabsAlignment): TtsWord[] {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const words: TtsWord[] = [];
  let current: { text: string; startMs: number; endMs: number } | null = null;
  const flush = () => {
    if (current && current.text && current.endMs >= current.startMs) words.push({ ...current });
    current = null;
  };
  for (const [index, char] of characters.entries()) {
    const start = starts[index];
    const end = ends[index];
    if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }
    const startMs = Math.round(start * 1000);
    const endMs = Math.round(end * 1000);
    if (/\s/u.test(char)) {
      flush();
      continue;
    }
    if (CJK.test(char)) {
      flush();
      words.push({ text: char, startMs, endMs });
      continue;
    }
    if (WORD_CHAR.test(char)) {
      if (current) {
        current.text += char;
        current.endMs = Math.max(current.endMs, endMs);
      } else {
        current = { text: char, startMs, endMs };
      }
      continue;
    }
    /// 标点：并入正在累积的词；否则并入前一个词（时间也延长到标点终点）
    if (current) {
      current.text += char;
      current.endMs = Math.max(current.endMs, endMs);
    } else if (words.length > 0) {
      const last = words[words.length - 1]!;
      last.text += char;
      last.endMs = Math.max(last.endMs, endMs);
    }
  }
  flush();
  return words;
}

export function createElevenLabsTtsProvider(
  options: { fetchImpl?: typeof fetch; env?: EnvLike } = {},
): TtsProvider {
  const env = options.env ?? process.env;
  return {
    id: "elevenlabs",
    model: resolveElevenLabsTtsModel(env),
    supportsWordTimestamps: true,
    synthesize: (input) => synthesizeWithElevenLabs(input, options.fetchImpl ?? fetch, env),
  };
}

async function synthesizeWithElevenLabs(
  input: TtsSynthesizeInput,
  fetchImpl: typeof fetch,
  env: EnvLike,
): Promise<TtsSynthesizeResult> {
  if (!isTtsProviderConfigured("elevenlabs", env)) {
    throw new TtsError("ELEVENLABS_API_KEY 未配置，TTS 不可用", null, false, "elevenlabs");
  }
  const key = env.ELEVENLABS_API_KEY!.trim();
  const text = input.text.trim();
  if (!text) {
    throw new TtsError("口播文本为空", null, false, "elevenlabs");
  }
  const model = resolveElevenLabsTtsModel(env);
  const voice = resolveTtsVoice("elevenlabs", input.voiceId);

  const response = await fetchImpl(elevenLabsTtsEndpoint(voice), {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, model_id: model }),
  });

  if (!response.ok) {
    /// 日志脱敏：只留状态码与截断的错误体，不落 key、不落完整口播稿。
    const body = (await response.text().catch(() => "")).slice(0, 200);
    const retryable = response.status === 429 || response.status >= 500;
    const error = new TtsError(`TTS 合成失败：HTTP ${response.status} ${body}`, response.status, retryable, "elevenlabs");
    /// 「AI 配音」实时回写：401 key 失效 / 402·429 额度用完 → 暂停；5xx 不改状态。
    await markCapability("voice", { error }, { detail: { provider: "elevenlabs", model } });
    throw error;
  }

  let payload: { audio_base64?: unknown; alignment?: unknown; normalized_alignment?: unknown };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new TtsError("TTS 返回的不是 JSON", null, true, "elevenlabs");
  }
  if (typeof payload.audio_base64 !== "string" || !payload.audio_base64) {
    throw new TtsError("TTS 返回缺少 audio_base64", null, true, "elevenlabs");
  }
  await markCapability("voice", "success", { detail: { provider: "elevenlabs", model } });

  const audio = Buffer.from(payload.audio_base64, "base64");
  if (audio.byteLength < 1024) {
    throw new TtsError("TTS 返回的音频异常（不足 1KB）", null, true, "elevenlabs");
  }
  /// alignment 对应原文；normalized_alignment 对应供应商归一化后的文本（数字展开等），字幕要原文。
  const alignment = parseAlignment(payload.alignment) ?? parseAlignment(payload.normalized_alignment);
  const words = alignment ? wordsFromCharacterAlignment(alignment) : [];
  const durationMs = words.length > 0 ? words[words.length - 1]!.endMs : undefined;
  return {
    audio,
    mime: "audio/mpeg",
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(words.length > 0 ? { words } : {}),
  };
}

function parseAlignment(raw: unknown): ElevenLabsAlignment | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const characters = record.characters;
  const starts = record.character_start_times_seconds;
  const ends = record.character_end_times_seconds;
  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends)) return null;
  if (characters.length === 0 || characters.length !== starts.length || characters.length !== ends.length) return null;
  if (!characters.every((c) => typeof c === "string")) return null;
  return {
    characters: characters as string[],
    character_start_times_seconds: starts as number[],
    character_end_times_seconds: ends as number[],
  };
}
