import { resolveTtsProviderId, type TtsProviderId } from "@/lib/providers/tts/config";
import { createElevenLabsTtsProvider } from "@/lib/providers/tts/elevenlabs";
import { createOpenAiTtsProvider } from "@/lib/providers/tts/openai";
import type { TtsProvider } from "@/lib/providers/tts/types";

export {
  DEFAULT_TTS_PROVIDER,
  TTS_PROVIDER_IDS,
  isTtsConfigured,
  isTtsProviderConfigured,
  resolveTtsProviderId,
  type TtsProviderId,
} from "@/lib/providers/tts/config";
export { TtsError, type TtsProvider, type TtsSynthesizeInput, type TtsSynthesizeResult, type TtsWord } from "@/lib/providers/tts/types";
export { PRODUCT_VOICE_IDS, VOICE_MAP, resolveTtsVoice, type ProductVoiceId } from "@/lib/providers/tts/voices";

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

const FACTORIES: Record<TtsProviderId, (options: { fetchImpl?: typeof fetch; env: EnvLike }) => TtsProvider> = {
  openai: createOpenAiTtsProvider,
  elevenlabs: createElevenLabsTtsProvider,
};

/** 按 TTS_PROVIDER 取当前供应商。fetchImpl / env 只给测试注入。 */
export function getTtsProvider(options: { fetchImpl?: typeof fetch; env?: EnvLike } = {}): TtsProvider {
  const env = options.env ?? process.env;
  return FACTORIES[resolveTtsProviderId(env)]({ fetchImpl: options.fetchImpl, env });
}
