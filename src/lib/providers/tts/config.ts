/**
 * TTS 供应商选择（只看 env，不 import 任何 provider / service）。
 * capability-status-service 也从这里取判据——provider 反过来要 import 它做回写，不能成环。
 *
 * OpenAI 的 tts-1 / gpt-4o-mini-tts 于 2027-01-06 关停：换供应商只改 TTS_PROVIDER，
 * 调用方一律经 getTtsProvider()，不直接碰某一家的实现。
 */

export const TTS_PROVIDER_IDS = ["openai", "elevenlabs"] as const;
export type TtsProviderId = (typeof TTS_PROVIDER_IDS)[number];

export const DEFAULT_TTS_PROVIDER: TtsProviderId = "openai";

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** 每家供应商要齐的 env（全部非空才算配置齐全）。 */
const REQUIRED_ENV: Record<TtsProviderId, readonly string[]> = {
  openai: ["OPENAI_API_KEY"],
  /// P04-A2：第二家（带逐词时间戳）。E3a 证实此 OpenAI key 无 realtime 模型，替代只能是第三方。
  elevenlabs: ["ELEVENLABS_API_KEY"],
};

const warnedUnknown = new Set<string>();

function isTtsProviderId(value: string): value is TtsProviderId {
  return (TTS_PROVIDER_IDS as readonly string[]).includes(value);
}

/** TTS_PROVIDER 未设 → openai；未知值回落 openai 并记一次日志（拼错不该让配音整条线停掉）。 */
export function resolveTtsProviderId(env: EnvLike = process.env): TtsProviderId {
  const raw = env.TTS_PROVIDER?.trim().toLowerCase();
  if (!raw) return DEFAULT_TTS_PROVIDER;
  if (isTtsProviderId(raw)) return raw;
  if (!warnedUnknown.has(raw)) {
    warnedUnknown.add(raw);
    console.warn(`[tts] 未知的 TTS_PROVIDER=${raw.slice(0, 40)}，回落 ${DEFAULT_TTS_PROVIDER}`);
  }
  return DEFAULT_TTS_PROVIDER;
}

export function isTtsProviderConfigured(id: TtsProviderId, env: EnvLike = process.env): boolean {
  return REQUIRED_ENV[id].every((name) => Boolean(env[name]?.trim()));
}

/** 当前选中的供应商配置是否齐全。 */
export function isTtsConfigured(env: EnvLike = process.env): boolean {
  return isTtsProviderConfigured(resolveTtsProviderId(env), env);
}
