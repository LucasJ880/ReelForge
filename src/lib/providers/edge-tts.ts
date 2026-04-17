/**
 * Microsoft Edge TTS Provider（Free 通道语音合成）
 *
 * 完全免费，无需 API key
 * 支持多语言：中 / 英 / 日 / 韩 / 西 / 法 / 德 / 越 / 印尼
 *
 * Mock 模式（VIDEO_ENGINE_MOCK=true）：返回静音 mp3 占位，避免测试时打真实端口
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

export interface VoiceOption {
  id: string; // ShortName，如 "zh-CN-XiaoxiaoNeural"
  label: string;
  language: string; // 语言 label，如 "中文 (普通话)"
  languageCode: string; // 如 "zh-CN"
  gender: "Female" | "Male";
}

/**
 * 精选 9 国语言推荐音色（来源: Microsoft Edge / Azure Speech）
 * 按语言分组，便于前端渲染 Select
 */
export const VOICE_CATALOG: VoiceOption[] = [
  // 中文（普通话）
  { id: "zh-CN-XiaoxiaoNeural", label: "晓晓（温柔女声）", language: "中文（普通话）", languageCode: "zh-CN", gender: "Female" },
  { id: "zh-CN-YunxiNeural", label: "云希（青年男声）", language: "中文（普通话）", languageCode: "zh-CN", gender: "Male" },
  { id: "zh-CN-XiaoyiNeural", label: "晓伊（活泼女声）", language: "中文（普通话）", languageCode: "zh-CN", gender: "Female" },
  { id: "zh-CN-YunjianNeural", label: "云健（沉稳男声）", language: "中文（普通话）", languageCode: "zh-CN", gender: "Male" },

  // 英文
  { id: "en-US-AriaNeural", label: "Aria (US Female)", language: "English", languageCode: "en-US", gender: "Female" },
  { id: "en-US-GuyNeural", label: "Guy (US Male)", language: "English", languageCode: "en-US", gender: "Male" },
  { id: "en-GB-SoniaNeural", label: "Sonia (UK Female)", language: "English", languageCode: "en-GB", gender: "Female" },
  { id: "en-GB-RyanNeural", label: "Ryan (UK Male)", language: "English", languageCode: "en-GB", gender: "Male" },

  // 日文
  { id: "ja-JP-NanamiNeural", label: "Nanami（女声）", language: "日本語", languageCode: "ja-JP", gender: "Female" },
  { id: "ja-JP-KeitaNeural", label: "Keita（男声）", language: "日本語", languageCode: "ja-JP", gender: "Male" },

  // 韩文
  { id: "ko-KR-SunHiNeural", label: "SunHi（女声）", language: "한국어", languageCode: "ko-KR", gender: "Female" },
  { id: "ko-KR-InJoonNeural", label: "InJoon（男声）", language: "한국어", languageCode: "ko-KR", gender: "Male" },

  // 西班牙语
  { id: "es-ES-ElviraNeural", label: "Elvira (Female)", language: "Español", languageCode: "es-ES", gender: "Female" },
  { id: "es-ES-AlvaroNeural", label: "Álvaro (Male)", language: "Español", languageCode: "es-ES", gender: "Male" },

  // 法语
  { id: "fr-FR-DeniseNeural", label: "Denise (Female)", language: "Français", languageCode: "fr-FR", gender: "Female" },
  { id: "fr-FR-HenriNeural", label: "Henri (Male)", language: "Français", languageCode: "fr-FR", gender: "Male" },

  // 德语
  { id: "de-DE-KatjaNeural", label: "Katja (Female)", language: "Deutsch", languageCode: "de-DE", gender: "Female" },
  { id: "de-DE-ConradNeural", label: "Conrad (Male)", language: "Deutsch", languageCode: "de-DE", gender: "Male" },

  // 越南语
  { id: "vi-VN-HoaiMyNeural", label: "HoaiMy (Female)", language: "Tiếng Việt", languageCode: "vi-VN", gender: "Female" },
  { id: "vi-VN-NamMinhNeural", label: "NamMinh (Male)", language: "Tiếng Việt", languageCode: "vi-VN", gender: "Male" },

  // 印尼语
  { id: "id-ID-GadisNeural", label: "Gadis (Female)", language: "Bahasa Indonesia", languageCode: "id-ID", gender: "Female" },
  { id: "id-ID-ArdiNeural", label: "Ardi (Male)", language: "Bahasa Indonesia", languageCode: "id-ID", gender: "Male" },
];

export const DEFAULT_VOICE_ID = "zh-CN-XiaoxiaoNeural";

export interface TTSResult {
  audio: Buffer; // mp3 bytes
  mimeType: "audio/mpeg";
  durationEstimateMs: number; // 粗略估算
}

function isMockMode(): boolean {
  return process.env.VIDEO_ENGINE_MOCK === "true";
}

/**
 * 估算时长：按字符数 * 平均语速
 * 中日韩：~3 字/秒；西文按 word 估算
 */
function estimateDurationMs(text: string, voiceId: string): number {
  const isCJK = /^(zh|ja|ko)/.test(voiceId);
  if (isCJK) {
    const chars = text.replace(/\s+/g, "").length;
    return Math.round((chars / 3.5) * 1000);
  }
  const words = text.trim().split(/\s+/).length;
  return Math.round((words / 2.5) * 1000);
}

/**
 * 生成静音 mp3（~0.5s）用作 mock 占位
 * 使用一个最简短的合法 mp3 帧头
 */
function buildSilentMp3(): Buffer {
  // 非常简短的静音 mp3（来自开源示例，约 300ms）
  return Buffer.from(
    "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYxLjcuMTAwAAAAAAAAAAAAAAD/+5DEAAAKHKFgFHSAAOSaK0KPSAABjA4wSEAoIEBGIoKxhWN8gaMQYoLDAYKCw6KCx6KHhAICgwKOHg4OHhwKOHg4OCggEBQSFAwMDgoIBAIBAYDAYGBgUCgUEAQCgUCgUDAoFBIJDgYGBQUFAoJBIIBBYNCgYDAYGBAMBgMCgwGBQQFBIUBAYFBIIBAIDBYJCAQGAwKAQGAwKBQQCAYFAgEBgUCAQCAQGBQQCAwKBQQCAYFBAICAQGAwGBQQFBIIBAICAoEAQGBQKBQSCAgGBgIBAYFAgIBAICAQGAgMBAUCAgEBAIBAIBAoEAgEAgEAgEBAQEAgIBAQEAgEAgMCAQEAgEAgIBAIBAICAwIBAQCAwIBAQCAwKBQQCAYFBAUCAgKCAYFAgICAgEAgICAgICAQCAQEAgKBQQBAYFBAMCAYFBAQEAQCAQEAgICAgICAQCAgICAgICAgICAgICAgICAgIA==",
    "base64",
  );
}

/**
 * 用 Edge TTS 合成单段文本为 mp3
 */
export async function synthesizeSpeech(
  text: string,
  voiceId: string = DEFAULT_VOICE_ID,
  rate: number = 0, // 语速 -50 ~ +50
): Promise<TTSResult> {
  if (isMockMode()) {
    return {
      audio: buildSilentMp3(),
      mimeType: "audio/mpeg",
      durationEstimateMs: estimateDurationMs(text, voiceId),
    };
  }

  const tts = new MsEdgeTTS();
  await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const { audioStream } = tts.toStream(text, { rate });
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    audioStream.on("data", (c: Buffer) => chunks.push(c));
    audioStream.on("close", resolve);
    audioStream.on("error", reject);
  });

  const audio = Buffer.concat(chunks);
  tts.close();

  return {
    audio,
    mimeType: "audio/mpeg",
    durationEstimateMs: estimateDurationMs(text, voiceId),
  };
}

/**
 * 将 VOICE_CATALOG 按语言分组，便于 UI 渲染
 */
export function groupVoicesByLanguage(): Record<string, VoiceOption[]> {
  const groups: Record<string, VoiceOption[]> = {};
  for (const v of VOICE_CATALOG) {
    if (!groups[v.language]) groups[v.language] = [];
    groups[v.language].push(v);
  }
  return groups;
}
