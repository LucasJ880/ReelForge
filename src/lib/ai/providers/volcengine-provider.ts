/**
 * 火山方舟 Ark Provider 适配器（豆包 LLM + 视觉）
 *
 * 关键说明：
 * - 火山方舟 chat-completion 接口与 OpenAI 兼容（OpenAPI 兼容协议）：
 *     POST https://ark.cn-beijing.volces.com/api/v3/chat/completions
 *     Headers: Authorization: Bearer <ARK_API_KEY>
 *     Body: { model, messages, response_format, ... }
 *   因此 chatJson 直接用 fetch 即可，不引入额外 SDK 依赖。
 * - 推荐用 Ark "接入点 ID"（endpoint_id）而非模型名。
 *   官方接入点示例：ep-20250101010101-xxxxx；也可以直接传模型名（豆包 1.5 起新模型支持）。
 * - 视觉调用：豆包 1.5 Vision Pro 支持 OpenAI Vision 兼容格式。
 * - 图像生成：方舟当前没有完全对齐 OpenAI Images API 的 endpoint；
 *   保留 placeholder（throw 清晰错误）。
 *
 * 模型映射（按 tier）：
 *   director / script / videoPrompt / creative → text model (推荐 doubao-pro-32k)
 *   qa / fast / research → text model（可降级到 doubao-lite）
 *   vision → vision model (推荐 doubao-1.5-vision-pro-32k)
 */

import type {
  AiChatJsonByTierOptions,
  AiChatJsonOptions,
  AiChatJsonResult,
  AiImageGenerationOptions,
  AiImageGenerationResult,
  AiProvider,
  AiTier,
  AiVisionAnalyzeOptions,
} from "../types";
import { ProviderCapabilityNotImplementedError } from "../types";
import { isDryRun } from "@/lib/config/dry-run";

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_TEXT_MODEL = "doubao-pro-32k";
const DEFAULT_VISION_MODEL = "doubao-1.5-vision-pro-32k";

function getApiKey(): string | undefined {
  return (
    process.env.VOLCENGINE_ARK_API_KEY?.trim() ||
    process.env.ARK_API_KEY?.trim() ||
    undefined
  );
}

function getBaseUrl(): string {
  return (
    process.env.VOLCENGINE_ARK_BASE_URL?.trim() ||
    process.env.ARK_BASE_URL?.trim() ||
    DEFAULT_BASE_URL
  );
}

function resolveTextModel(tier: AiTier): string {
  /// 1. tier 专属 env: VOLCENGINE_ARK_MODEL_DIRECTOR 等
  const tierEnv = `VOLCENGINE_ARK_MODEL_${tier.toUpperCase()}`;
  const explicit = process.env[tierEnv]?.trim();
  if (explicit) return explicit;

  /// 2. 通用 text/vision
  if (tier === "vision") {
    return (
      process.env.VOLCENGINE_ARK_MODEL_VISION?.trim() || DEFAULT_VISION_MODEL
    );
  }
  return process.env.VOLCENGINE_ARK_MODEL_TEXT?.trim() || DEFAULT_TEXT_MODEL;
}

function isForceMock(): boolean {
  return (
    isDryRun() ||
    process.env.LLM_FORCE_MOCK === "true" ||
    process.env.DIRECTOR_FORCE_MOCK === "true" ||
    process.env.SCRIPT_FORCE_MOCK === "true"
  );
}

interface ArkChatResponse {
  id?: string;
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

async function arkChatJsonRaw(
  options: AiChatJsonOptions,
  apiKey: string,
  baseUrl: string,
): Promise<{ content: string; usage: ArkChatResponse["usage"]; modelUsed: string }> {
  const model = options.model ?? DEFAULT_TEXT_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
    /// 火山方舟豆包系列从 1.5 起支持 OpenAI 兼容的 response_format
    response_format: { type: "json_object" },
  };

  /// 豆包 1.x / Pro 仍支持 temperature；新一代推理模型若不支持会被服务端忽略
  if (typeof options.temperature === "number") {
    body.temperature = options.temperature;
  }
  if (typeof options.maxTokens === "number") {
    body.max_tokens = options.maxTokens;
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `[volcengine-ark] chat 调用失败 ${res.status}: ${text.slice(0, 400)}`,
    );
  }
  const data = (await res.json()) as ArkChatResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("[volcengine-ark] chat 返回空内容");
  }
  return { content, usage: data.usage, modelUsed: model };
}

export class VolcengineProvider implements AiProvider {
  readonly id = "volcengine" as const;
  readonly displayName = "火山方舟 (豆包)";

  isConfigured(): boolean {
    return Boolean(getApiKey());
  }

  isForceMock(): boolean {
    return isForceMock();
  }

  async chatJson<T = unknown>(
    options: AiChatJsonOptions,
  ): Promise<AiChatJsonResult<T>> {
    if (this.isForceMock()) {
      throw new Error(
        "LLM_FORCE_MOCK is true; refusing to send real volcengine request — caller must short-circuit to mock.",
      );
    }
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error(
        "[volcengine-ark] VOLCENGINE_ARK_API_KEY 未配置（或回退的 ARK_API_KEY 未配置）",
      );
    }
    const baseUrl = getBaseUrl();
    const { content, usage, modelUsed } = await arkChatJsonRaw(
      options,
      apiKey,
      baseUrl,
    );

    let parsed: T;
    try {
      parsed = JSON.parse(content) as T;
    } catch (err) {
      throw new Error(
        `[volcengine-ark] 返回非合法 JSON: ${(err as Error).message}\n原文: ${content.slice(0, 300)}`,
      );
    }
    return {
      data: parsed,
      modelUsed,
      tokenUsage: usage
        ? {
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
            totalTokens: usage.total_tokens ?? 0,
          }
        : null,
      raw: content,
    };
  }

  async chatJsonByTier<T = unknown>(
    options: AiChatJsonByTierOptions,
  ): Promise<AiChatJsonResult<T>> {
    if (this.isForceMock()) {
      throw new Error(
        `LLM_FORCE_MOCK is true; refusing to send real volcengine request for tier=${options.tier} — caller must short-circuit to mock.`,
      );
    }
    const model = resolveTextModel(options.tier);
    const stageLabel = options.stage ?? options.tier;
    const result = await this.chatJson<T>({
      ...options,
      model,
    });
    console.log(
      `[volcengine-ark] stage=${stageLabel} tier=${options.tier} model=${model}`,
    );
    return { ...result, tier: options.tier, fallbackUsed: false };
  }

  async analyzeImages(
    options: AiVisionAnalyzeOptions,
  ): Promise<AiChatJsonResult<Record<string, unknown>>> {
    if (this.isForceMock()) {
      throw new Error(
        "LLM_FORCE_MOCK is true; refusing to send real volcengine vision request.",
      );
    }
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error("[volcengine-ark] VOLCENGINE_ARK_API_KEY 未配置");
    }
    const baseUrl = getBaseUrl();
    const visionModel = resolveTextModel("vision");

    const imageParts = options.imageUrls.slice(0, 5).map((url) => ({
      type: "image_url" as const,
      image_url: { url },
    }));

    const body = {
      model: visionModel,
      messages: [
        { role: "system", content: options.system },
        {
          role: "user",
          content: [...imageParts, { type: "text" as const, text: options.user }],
        },
      ],
      response_format: { type: "json_object" },
    };
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `[volcengine-ark] vision 调用失败 ${res.status}: ${text.slice(0, 400)}`,
      );
    }
    const data = (await res.json()) as ArkChatResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("[volcengine-ark] vision 返回空");
    return {
      data: JSON.parse(content) as Record<string, unknown>,
      modelUsed: visionModel,
      tokenUsage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          }
        : null,
      raw: content,
      tier: "vision",
    };
  }

  async generateImages(
    _options: AiImageGenerationOptions,
  ): Promise<AiImageGenerationResult> {
    /// TODO: 接入火山方舟 SeedDream / 通用 Visual Service
    /// 当前阶段保留 placeholder；caller (logo-service) 已有 mock fallback。
    throw new ProviderCapabilityNotImplementedError("volcengine", "generateImages");
  }
}
