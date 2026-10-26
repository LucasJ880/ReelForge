import type { TtsProviderId } from "@/lib/providers/tts/config";

/** 产品音色 id（与 audio-caption-controls 的 VOICE_OPTIONS 同一套）。 */
export const PRODUCT_VOICE_IDS = [
  "warm-confident",
  "natural-friendly",
  "energetic-creator",
  "calm-premium",
] as const;
export type ProductVoiceId = (typeof PRODUCT_VOICE_IDS)[number];

/**
 * 每家供应商一张表，必须覆盖全部产品音色。
 * 未识别的 id 落到 fallback：报错不如出片，音色偏差人耳可接受。
 */
export const VOICE_MAP: Record<TtsProviderId, { voices: Record<ProductVoiceId, string>; fallback: string }> = {
  openai: {
    voices: {
      "warm-confident": "nova",
      "natural-friendly": "shimmer",
      "energetic-creator": "alloy",
      "calm-premium": "onyx",
    },
    fallback: "nova",
  },
  /**
   * ElevenLabs 预置音色（premade voices，所有账号可用）的 voice_id；E3b 真机试听后可换。
   * 列音色而不是列名字：/v1/text-to-speech/{voice_id} 只认 id。
   */
  elevenlabs: {
    voices: {
      "warm-confident": "21m00Tcm4TlvDq8ikWAM", // Rachel
      "natural-friendly": "EXAVITQu4vr4xnSDxMaL", // Bella
      "energetic-creator": "TxGEqnHWrfWFTfGW9XjX", // Josh
      "calm-premium": "pNInz6obpgDQGcFmaJgB", // Adam
    },
    fallback: "21m00Tcm4TlvDq8ikWAM",
  },
};

export function resolveTtsVoice(provider: TtsProviderId, voiceId: string | null | undefined): string {
  const table = VOICE_MAP[provider];
  if (!voiceId) return table.fallback;
  return (table.voices as Record<string, string>)[voiceId] ?? table.fallback;
}
