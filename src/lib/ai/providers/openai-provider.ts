/**
 * OpenAI Provider 适配器。
 *
 * 这层是「现有 src/lib/providers/openai.ts + openai-image.ts 的 thin wrapper」，
 * 不复制业务逻辑。所有 model resolution / fallback chain / mock guard 仍在原文件，
 * 这样老代码继续工作，新代码统一走 AiProvider 接口。
 */

import {
  analyzeImages as legacyAnalyzeImages,
  chatJson as legacyChatJson,
  chatJsonByTier as legacyChatJsonByTier,
  isLLMAvailable,
  isLLMForcedMock,
  type OpenAITier,
} from "@/lib/providers/openai";
import { generateImages as legacyGenerateImages } from "@/lib/providers/openai-image";
import type {
  AiChatJsonByTierOptions,
  AiChatJsonOptions,
  AiChatJsonResult,
  AiImageGenerationOptions,
  AiImageGenerationResult,
  AiProvider,
  AiVisionAnalyzeOptions,
} from "../types";

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
    return legacyAnalyzeImages(options.imageUrls, options.system, options.user);
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
}
