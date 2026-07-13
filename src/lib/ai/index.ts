/**
 * AI Provider 工厂入口。
 *
 * 业务代码使用方式：
 *
 *   import { getAiProvider } from "@/lib/ai";
 *   const ai = getAiProvider();
 *   const result = await ai.chatJsonByTier({ tier: "script", system, user });
 *
 * Provider 选择由 env AI_PROVIDER 决定（详见 src/lib/config/env.ts）：
 *   - openai (默认海外)
 *   - volcengine (默认 cn region)
 */

import { getAppEnv } from "@/lib/config/env";
import { OpenAiProvider } from "./providers/openai-provider";
import { VolcengineProvider } from "./providers/volcengine-provider";
import type { AiProvider } from "./types";
import type {
  AiChatJsonByTierOptions,
  AiChatJsonOptions,
  AiChatJsonResult,
} from "./types";

let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (cached) return cached;
  cached = createAiProvider();
  return cached;
}

export function createAiProvider(): AiProvider {
  const env = getAppEnv();
  switch (env.aiProvider) {
    case "openai":
      return new OpenAiProvider();
    case "volcengine":
      return new VolcengineProvider();
    default: {
      const exhaustiveCheck: never = env.aiProvider;
      throw new Error(
        `[ai] 未知 AI_PROVIDER: ${String(exhaustiveCheck)}（必须为 openai / volcengine）`,
      );
    }
  }
}

/// 仅测试用：清缓存
export function __resetAiProviderForTests(): void {
  cached = null;
}

/** Compatibility-shaped helpers keep business callers provider-neutral while
 * preserving the existing call contracts during the Phase 1 migration. */
export function isLLMAvailable(): boolean {
  return getAiProvider().isConfigured();
}

export function isLLMForcedMock(): boolean {
  return getAiProvider().isForceMock();
}

export function chatJson<T = unknown>(
  options: AiChatJsonOptions,
): Promise<AiChatJsonResult<T>> {
  return getAiProvider().chatJson<T>(options);
}

export function chatJsonByTier<T = unknown>(
  options: AiChatJsonByTierOptions,
): Promise<AiChatJsonResult<T>> {
  return getAiProvider().chatJsonByTier<T>(options);
}

export function analyzeImages(
  imageUrls: string[],
  system: string,
  user: string,
): Promise<AiChatJsonResult<Record<string, unknown>>> {
  return getAiProvider().analyzeImages({ imageUrls, system, user });
}

export type { AiProvider, AiTier, AiChatJsonResult, AiChatJsonByTierOptions } from "./types";
export { ProviderCapabilityNotImplementedError } from "./types";
