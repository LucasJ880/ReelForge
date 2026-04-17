/**
 * Voice catalog（纯数据，客户端/服务端通用）
 * 分离 msedge-tts 的 node-only 运行时，避免打进浏览器包
 */

export interface VoiceOption {
  id: string;
  label: string;
  language: string;
  languageCode: string;
  gender: "Female" | "Male";
}

export const VOICE_CATALOG: VoiceOption[] = [
  { id: "zh-CN-XiaoxiaoNeural", label: "晓晓（温柔女声）", language: "中文（普通话）", languageCode: "zh-CN", gender: "Female" },
  { id: "zh-CN-YunxiNeural", label: "云希（青年男声）", language: "中文（普通话）", languageCode: "zh-CN", gender: "Male" },
  { id: "zh-CN-XiaoyiNeural", label: "晓伊（活泼女声）", language: "中文（普通话）", languageCode: "zh-CN", gender: "Female" },
  { id: "zh-CN-YunjianNeural", label: "云健（沉稳男声）", language: "中文（普通话）", languageCode: "zh-CN", gender: "Male" },

  { id: "en-US-AriaNeural", label: "Aria (US Female)", language: "English", languageCode: "en-US", gender: "Female" },
  { id: "en-US-GuyNeural", label: "Guy (US Male)", language: "English", languageCode: "en-US", gender: "Male" },
  { id: "en-GB-SoniaNeural", label: "Sonia (UK Female)", language: "English", languageCode: "en-GB", gender: "Female" },
  { id: "en-GB-RyanNeural", label: "Ryan (UK Male)", language: "English", languageCode: "en-GB", gender: "Male" },

  { id: "ja-JP-NanamiNeural", label: "Nanami（女声）", language: "日本語", languageCode: "ja-JP", gender: "Female" },
  { id: "ja-JP-KeitaNeural", label: "Keita（男声）", language: "日本語", languageCode: "ja-JP", gender: "Male" },

  { id: "ko-KR-SunHiNeural", label: "SunHi（女声）", language: "한국어", languageCode: "ko-KR", gender: "Female" },
  { id: "ko-KR-InJoonNeural", label: "InJoon（男声）", language: "한국어", languageCode: "ko-KR", gender: "Male" },

  { id: "es-ES-ElviraNeural", label: "Elvira (Female)", language: "Español", languageCode: "es-ES", gender: "Female" },
  { id: "es-ES-AlvaroNeural", label: "Álvaro (Male)", language: "Español", languageCode: "es-ES", gender: "Male" },

  { id: "fr-FR-DeniseNeural", label: "Denise (Female)", language: "Français", languageCode: "fr-FR", gender: "Female" },
  { id: "fr-FR-HenriNeural", label: "Henri (Male)", language: "Français", languageCode: "fr-FR", gender: "Male" },

  { id: "de-DE-KatjaNeural", label: "Katja (Female)", language: "Deutsch", languageCode: "de-DE", gender: "Female" },
  { id: "de-DE-ConradNeural", label: "Conrad (Male)", language: "Deutsch", languageCode: "de-DE", gender: "Male" },

  { id: "vi-VN-HoaiMyNeural", label: "HoaiMy (Female)", language: "Tiếng Việt", languageCode: "vi-VN", gender: "Female" },
  { id: "vi-VN-NamMinhNeural", label: "NamMinh (Male)", language: "Tiếng Việt", languageCode: "vi-VN", gender: "Male" },

  { id: "id-ID-GadisNeural", label: "Gadis (Female)", language: "Bahasa Indonesia", languageCode: "id-ID", gender: "Female" },
  { id: "id-ID-ArdiNeural", label: "Ardi (Male)", language: "Bahasa Indonesia", languageCode: "id-ID", gender: "Male" },
];

export const DEFAULT_VOICE_ID = "zh-CN-XiaoxiaoNeural";

export function groupVoicesByLanguage(): Record<string, VoiceOption[]> {
  const groups: Record<string, VoiceOption[]> = {};
  for (const v of VOICE_CATALOG) {
    if (!groups[v.language]) groups[v.language] = [];
    groups[v.language].push(v);
  }
  return groups;
}
