/**
 * OpenAI Provider 适配器。
 *
 * 这层是「现有 src/lib/providers/openai.ts + openai-image.ts 的 thin wrapper」，
 * 不复制业务逻辑。所有 model resolution / fallback chain / mock guard 仍在原文件，
 * 这样老代码继续工作，新代码统一走 AiProvider 接口。
 */

import {
  analyzeImages as legacyAnalyzeImages,
  buildTokenLimitParam,
  chatJson as legacyChatJson,
  chatJsonByTier as legacyChatJsonByTier,
  isLLMAvailable,
  isLLMForcedMock,
  resolveFallbackChain,
  type OpenAITier,
} from "@/lib/providers/openai";
import {
  composeReferenceImage as legacyComposeReferenceImage,
  generateImages as legacyGenerateImages,
} from "@/lib/providers/openai-image";
import type {
  AiChatJsonByTierOptions,
  AiChatJsonOptions,
  AiChatJsonResult,
  AiImageGenerationOptions,
  AiImageGenerationResult,
  AiImageEditOptions,
  AiImageEditResult,
  AiProvider,
  AiVisionAnalyzeOptions,
} from "../types";

/**
 * C4 · 能力探测要用的模型解析：与生产调用同一套规则——文本 = fast 档回退链，看图 = vision 档回退链
 * （env 显式模型优先，已知无权限的 4 系沉底）。两边都取 resolveFallbackChain，探测与生产选的是同一个链首：
 * 之前看图取 resolveModelForTier，env 写了 gpt-4o 时探测会去打一个生产根本不会用的 403 模型。
 * 探测走这里而不是直连 providers/openai，守住「LLM 只经 AI provider 抽象」的门禁。
 */
export function openAiProbePlan(): { textModels: string[]; visionModels: string[] } {
  return {
    textModels: resolveFallbackChain("fast").slice(0, 3),
    visionModels: resolveFallbackChain("vision").slice(0, 3),
  };
}

/** 与 chatJson 同一条规则：5.x / o 系只收 max_completion_tokens。 */
export function openAiTokenLimitParam(
  model: string,
  limit: number,
): { max_tokens?: number; max_completion_tokens?: number } {
  return buildTokenLimitParam(model, limit);
}

export class OpenAiProvider implements AiProvider {
  readonly id = "openai" as const;
  readonly displayName = "OpenAI";

  isConfigured(): boolean {
    return isLLMAvailable();
  }

  isForceMock(): boolean {
    return isLLMForcedMock();
  }

  async chatJson<T = unknown>(
    options: AiChatJsonOptions,
  ): Promise<AiChatJsonResult<T>> {
    return legacyChatJson<T>(options);
  }

  async chatJsonByTier<T = unknown>(
    options: AiChatJsonByTierOptions,
  ): Promise<AiChatJsonResult<T>> {
    /// AiTier 与 OpenAITier 完全同构（同样 8 个值）
    return legacyChatJsonByTier<T>({
      ...options,
      tier: options.tier as OpenAITier,
    });
  }

  async analyzeImages(
    options: AiVisionAnalyzeOptions,
  ): Promise<AiChatJsonResult<Record<string, unknown>>> {
    return legacyAnalyzeImages(options.imageUrls, options.system, options.user, {
      detail: options.detail,
      maxTokens: options.maxTokens,
    });
  }

  async generateImages(
    options: AiImageGenerationOptions,
  ): Promise<AiImageGenerationResult> {
    return legacyGenerateImages({
      prompt: options.prompt,
      n: options.n,
      size: options.size,
      quality: options.quality,
      blobPrefix: options.storagePrefix,
      forceMock: options.forceMock,
      model: options.model,
    });
  }

  async editImages(options: AiImageEditOptions): Promise<AiImageEditResult> {
    return legacyComposeReferenceImage({
      prompt: options.prompt,
      referenceImages: options.referenceImages,
      size: options.size,
      quality: options.quality,
      blobPrefix: options.storagePrefix,
      forceMock: options.forceMock,
      model: options.model,
    });
  }
}
