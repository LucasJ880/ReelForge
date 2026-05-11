import OpenAI from "openai";

/**
 * OpenAI 模型分层（2026-05 Phase Lifecycle Hardening）：
 *
 * - 不再把所有阶段都钉在 mini —— mini 输出对最终客户看到的脚本/视频 prompt 太弱。
 * - 通过 `OpenAITier` 在调用点声明该次调用属于哪一类，然后在此处统一映射到具体模型。
 * - 模型由环境变量配置；未配置时使用默认值。
 *
 * 期望默认（在我们的 OpenAI 账号里可用，2026-05）：
 *   creative   → gpt-4.1（最终脚本/创意角度/视频 prompt；用户能看到的内容）
 *   qa         → gpt-4.1-mini（带推理的轻量打分；可手动升 gpt-4.1 / o4-mini）
 *   fast       → gpt-4o-mini（分类/抽取/补字段）
 *   research   → gpt-4o-mini（市场调研结构化压缩；fast 也可）
 *   vision     → gpt-4o（图像理解，硬编码因为目前只有 4o 支持图像分析 + JSON）
 *
 * 想试 gpt-5.5 / o4 系列？只需在 .env 里覆写：
 *   OPENAI_CREATIVE_MODEL=gpt-5.5
 *   OPENAI_QA_MODEL=o4-mini
 *
 * 若环境变量被设置但 OpenAI 账号里没有该模型，调用会抛错，
 * 此时 chatJsonByTier 会按 Tier 的 fallback chain 自动重试到下一档（可观测性日志会标 fallbackUsed=true）。
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "missing-openai-api-key",
});

export type OpenAITier = "creative" | "qa" | "fast" | "research" | "vision";

const DEFAULTS: Record<OpenAITier, string> = {
  creative: "gpt-4.1",
  qa: "gpt-4.1-mini",
  fast: "gpt-4o-mini",
  research: "gpt-4o-mini",
  vision: "gpt-4o",
};

/// 当首选模型不可用时按顺序回退（必须含至少一个我们账号里 100% 可用的模型）
const FALLBACK_CHAIN: Record<OpenAITier, string[]> = {
  creative: ["gpt-4.1", "gpt-4o", "gpt-4o-mini"],
  qa: ["gpt-4.1-mini", "gpt-4o-mini"],
  fast: ["gpt-4o-mini"],
  research: ["gpt-4o-mini"],
  vision: ["gpt-4o"],
};

export function resolveModelForTier(tier: OpenAITier): string {
  /// 优先 Tier 专属 env，其次通用 OPENAI_MODEL（向后兼容旧部署），最后默认值
  const tierEnv = `OPENAI_${tier.toUpperCase()}_MODEL`;
  return (
    process.env[tierEnv] ||
    process.env.OPENAI_MODEL ||
    DEFAULTS[tier]
  );
}

export function resolveFallbackChain(tier: OpenAITier): string[] {
  const preferred = resolveModelForTier(tier);
  /// 把 env 指定的 preferred model 放在最前，去重保留顺序
  const seen = new Set<string>();
  const chain = [preferred, ...FALLBACK_CHAIN[tier]].filter((m) => {
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  });
  return chain;
}

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
  /// 是否是 fallback 命中
  fallbackUsed?: boolean;
  /// 该次调用的业务阶段（仅当通过 chatJsonByTier 调用时填充）
  tier?: OpenAITier;
}

export interface ChatJsonByTierOptions extends Omit<ChatJsonOptions, "model"> {
  tier: OpenAITier;
  /// 阶段名（用于日志，如 "client_script" / "angle_generation"）
  stage?: string;
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

  const model = options.model || resolveModelForTier("fast");
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
 * 按业务阶段分层调用：
 * - 自动选模型；
 * - 首选模型不可用（404/model_not_found / "model `xxx` does not exist"）时回退；
 * - 命中回退会打印 console.warn，便于在 Vercel Logs 立刻发现「premium model 不可用」。
 *
 * 返回 ChatJsonResult，附带 tier / fallbackUsed 字段。
 */
export async function chatJsonByTier<T = unknown>(
  options: ChatJsonByTierOptions,
): Promise<ChatJsonResult<T>> {
  const chain = resolveFallbackChain(options.tier);
  const stageLabel = options.stage ?? options.tier;
  let lastErr: unknown = null;
  for (let i = 0; i < chain.length; i++) {
    const candidate = chain[i];
    try {
      const result = await chatJson<T>({
        ...options,
        model: candidate,
      });
      const fallbackUsed = i > 0;
      console.log(
        `[openai] stage=${stageLabel} tier=${options.tier} model=${candidate}` +
          (fallbackUsed ? ` fallback=true (preferred=${chain[0]})` : ""),
      );
      return { ...result, fallbackUsed, tier: options.tier };
    } catch (err) {
      lastErr = err;
      if (!isModelMissingError(err)) {
        /// 非「模型不存在」错误（限流、上下文超长、内容审核等）—— 不要静默吞掉
        throw err;
      }
      console.warn(
        `[openai] stage=${stageLabel} model=${candidate} 不可用，将回退到 ${chain[i + 1] ?? "无"}`,
        (err as Error).message,
      );
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("OpenAI 调用失败：所有候选模型都不可用");
}

function isModelMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: number }).status;
  if (status === 404) return true;
  const code = (err as { code?: string }).code;
  if (code === "model_not_found") return true;
  const message = (err as Error).message ?? "";
  return /model.*(does not exist|not found|unavailable|deprecated)/i.test(
    message,
  );
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

  const visionModel = resolveModelForTier("vision");
  const imageContent = imageUrls.slice(0, 5).map((url) => ({
    type: "image_url" as const,
    image_url: { url, detail: "low" as const },
  }));

  const response = await openai.chat.completions.create({
    model: visionModel,
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
    modelUsed: visionModel,
    tokenUsage: response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : null,
    raw: content,
    tier: "vision",
  };
}

export function isLLMAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/// 仅供测试导入
export const __test__ = {
  resolveModelForTier,
  resolveFallbackChain,
  isModelMissingError,
};
