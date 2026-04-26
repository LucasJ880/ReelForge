import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "missing-openai-api-key",
});

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export interface ChatJsonOptions {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatJsonResult<T> {
  data: T;
  modelUsed: string;
  tokenUsage: TokenUsage | null;
  raw: string;
}

/**
 * 通用 JSON 模式 LLM 调用：系统提示 + 用户提示 → 强制返回 JSON。
 * 如果 OPENAI_API_KEY 未配置则抛错（调用方应自行 mock）。
 */
export async function chatJson<T = unknown>(
  options: ChatJsonOptions,
): Promise<ChatJsonResult<T>> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY 未配置");
  }

  const model = options.model || DEFAULT_MODEL;
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
    response_format: { type: "json_object" },
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 3500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI 返回了空响应");
  }

  let parsed: T;
  try {
    parsed = JSON.parse(content) as T;
  } catch (err) {
    throw new Error(
      `OpenAI 返回的不是合法 JSON：${(err as Error).message}\n原文：${content.slice(0, 300)}`,
    );
  }

  return {
    data: parsed,
    modelUsed: model,
    tokenUsage: response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : null,
    raw: content,
  };
}

/**
 * 视觉分析（GPT-4o）：用于参考图的内容提取。
 */
export async function analyzeImages(
  imageUrls: string[],
  system: string,
  userPrompt: string,
): Promise<ChatJsonResult<Record<string, unknown>>> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY 未配置");
  }

  const imageContent = imageUrls.slice(0, 5).map((url) => ({
    type: "image_url" as const,
    image_url: { url, detail: "low" as const },
  }));

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          ...imageContent,
          { type: "text", text: userPrompt },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1200,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("视觉分析返回了空响应");

  return {
    data: JSON.parse(content),
    modelUsed: "gpt-4o",
    tokenUsage: response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : null,
    raw: content,
  };
}

export function isLLMAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
