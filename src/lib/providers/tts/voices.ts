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
};

export function resolveTtsVoice(provider: TtsProviderId, voiceId: string | null | undefined): string {
  const table = VOICE_MAP[provider];
  if (!voiceId) return table.fallback;
  return (table.voices as Record<string, string>)[voiceId] ?? table.fallback;
}
