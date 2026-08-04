import OpenAI from "openai";
import { isDryRun } from "@/lib/config/dry-run";

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

/**
 * 注：导出仅为方便 unit test 用 `node:test` mock `chat.completions.create`
 * （没有现成 SDK 注入 seam）。**业务代码不要直接访问** —— 用 chatJson / chatJsonByTier / analyzeImages。
 */
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "missing-openai-api-key",
});

/**
 * 调用前从 env 惰性刷新 key。独立脚本(验收/样片)通常在 import 之后才
 * loadEnvConfig,模块加载时单例会捕获占位 key,导致 frame-QA 等门禁 401
 * 后 fail-open(0803 真机复现)。对象身份保持不变,unit test 的 mock seam 不受影响。
 */
function refreshOpenAiKeyFromEnv(): void {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (key && openai.apiKey !== key) openai.apiKey = key;
}

export type OpenAITier =
  | "director"
  | "script"
  | "videoPrompt"
  | "creative"
  | "qa"
  | "fast"
  | "research"
  | "vision";

/**
 * ⚠️ 2026-08-01：生产 key 的项目**只有 gpt-5.6 系与 gpt-image-2 的权限**，
 * 全部 gpt-4o / gpt-4.1 系一律 403。此前整条回退链都是 4 系，
 * 于是每个 LLM 阶段都跑完三次 403 再静默降级到启发式 —— 线上看不出来，
 * 因为降级是「成功」路径。改模型前先跑 `GET /v1/models` 确认权限，别照抄文档。
 */
const DEFAULTS: Record<OpenAITier, string> = {
  /// 最强的视频导演 / 脚本 / Seedance prompt 阶段 — 客户最终看到的输出
  director: "gpt-5.6-sol",
  script: "gpt-5.6-sol",
  videoPrompt: "gpt-5.6-sol",
  creative: "gpt-5.6-sol",
  qa: "gpt-5.6-terra",
  fast: "gpt-5.6-terra",
  research: "gpt-5.6-terra",
  vision: "gpt-5.6-sol",
};

/**
 * 当首选模型不可用时按顺序回退。
 *
 * 两条规则：
 * 1. director / script / videoPrompt 永远不能退到轻量档 —— 这些是客户最终看到的
 *    脚本与 Seedance prompt。
 * 2. 链尾保留 4 系是给尚未换 key 的部署兜底；当前生产用不到它们。
 *    **不要把 4 系放到链首**，那会让每次调用白白吃三个 403。
 */
const FALLBACK_CHAIN: Record<OpenAITier, string[]> = {
  director: ["gpt-5.6-sol", "gpt-5.5", "gpt-4.1"],
  script: ["gpt-5.6-sol", "gpt-5.5", "gpt-4.1"],
  videoPrompt: ["gpt-5.6-sol", "gpt-5.5", "gpt-4.1"],
  creative: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-4.1"],
  qa: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-4.1-mini"],
  fast: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-4o-mini"],
  research: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-4o-mini"],
  vision: ["gpt-5.6-sol", "gpt-4o"],
};

/**
 * 已知在当前生产项目下**没有权限**的模型。
 *
 * 旧部署的 `OPENAI_MODEL=gpt-4o-mini` 会被 resolveModelForTier 当成首选，
 * 于是链首必然 403。与其每次调用浪费一个往返，不如在这里直接跳过 ——
 * 这不是猜测，是 `GET /v1/models` 的返回。
 */
const KNOWN_UNAVAILABLE = /^gpt-4/;

/**
 * 客户最终看到的 tier（director / script / videoPrompt）必须避免 mini —
 * 即使旧部署在 OPENAI_MODEL 设了 mini 也要保留 DEFAULTS。
 */
const NO_MINI_TIERS: ReadonlySet<OpenAITier> = new Set([
  "director",
  "script",
  "videoPrompt",
]);

export function resolveModelForTier(tier: OpenAITier): string {
  /// 优先 Tier 专属 env，其次通用 OPENAI_MODEL（向后兼容旧部署），最后默认值
  const tierEnv = `OPENAI_${tier.toUpperCase()}_MODEL`;
  const explicit = process.env[tierEnv];
  if (explicit) return explicit;

  const legacy = process.env.OPENAI_MODEL;
  if (legacy) {
    /// 客户面向 tier 不允许退化到 mini；其它 tier 仍可沿用旧 OPENAI_MODEL
    if (NO_MINI_TIERS.has(tier) && /mini/i.test(legacy)) {
      return DEFAULTS[tier];
    }
    return legacy;
  }
  return DEFAULTS[tier];
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

  /// 已知无权限的模型下沉到链尾而不是删掉：万一某个部署的 key 确实有 4 系权限，
  /// 它仍然能作为最后的兜底，只是不再占用首选位置浪费往返。
  const usable = chain.filter((m) => !KNOWN_UNAVAILABLE.test(m));
  const deprioritized = chain.filter((m) => KNOWN_UNAVAILABLE.test(m));
  return usable.length ? [...usable, ...deprioritized] : chain;
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
 * GPT-5.x / o-series reasoning 模型只接受 `max_completion_tokens`；
 * GPT-4.x / GPT-4o 系列接受 `max_tokens`（同字段 deprecated 但仍受理）。
 *
 * 历史 bug：之前 chatJson 硬编码 `max_tokens` → 调 gpt-5.5 时 OpenAI 直接 400
 * 返回 `Unsupported parameter: 'max_tokens'`，导致 director / script tier 100% 失败
 * 然后 wizard-script-service 静默回退到 mock。
 *
 * 在导出，方便 tests 直接断言。
 */
export function buildTokenLimitParam(
  model: string,
  limit: number,
): { max_tokens?: number; max_completion_tokens?: number } {
  if (/^(gpt-5|gpt-6|o1|o3|o4)/i.test(model)) {
    return { max_completion_tokens: limit };
  }
  return { max_tokens: limit };
}

/**
 * 根据 model family 决定是否透传 temperature。
 *
 * 背景：
 * - GPT-5.x / GPT-6.x / o1 / o3 / o4 系列模型的 chat completions API 仅支持
 *   `temperature=1`（默认值），任何非 1 的值都会被 OpenAI 直接 4xx 拒绝：
 *   `Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported.`
 * - 这是 OpenAI 在 GPT-5 系列引入的服务端硬约束，无法从客户端绕过。
 * - 业务代码遍布 `temperature: 0.5/0.7/0.85` 之类的调用，没法（也不该）逐个修；
 *   在 provider 层根据 model family 静默丢弃即可，让旧模型仍能受益。
 *
 * 行为：
 * - 5.x / 6.x / o-series：返回 `{}`（不下发 temperature 参数 → API 用默认 1）
 * - 其它 (gpt-4*, gpt-3.5)：返回 `{ temperature: requested }`
 *
 * @example
 *   buildTemperatureParam("gpt-5.5", 0.7)   // → {}
 *   buildTemperatureParam("gpt-4o", 0.7)    // → { temperature: 0.7 }
 *   buildTemperatureParam("o3-mini", 0.5)   // → {}
 */
export function buildTemperatureParam(
  model: string,
  requested: number | undefined,
): { temperature?: number } {
  if (/^(gpt-5|gpt-6|o1|o3|o4)/i.test(model)) {
    return {};
  }
  if (requested == null) return {};
  return { temperature: requested };
}

/**
 * 「LLM_FORCE_MOCK / DIRECTOR_FORCE_MOCK / SCRIPT_FORCE_MOCK」任一为 "true" → 全 LLM mock。
 *
 * 设计意图：
 * - 一个统一开关（LLM_FORCE_MOCK）覆盖整个 AI 管线，避免遗漏新 service 漏配 mock。
 * - 同时向后兼容已经写进 .env / docs 的 DIRECTOR_FORCE_MOCK 与 SCRIPT_FORCE_MOCK 别名。
 * - 任何 service 都应在调用 chatJsonByTier 之前先调本函数，决定是否走自家 mock 输出。
 */
export function isLLMForcedMock(): boolean {
  return (
    isDryRun() ||
    process.env.LLM_FORCE_MOCK === "true" ||
    process.env.DIRECTOR_FORCE_MOCK === "true" ||
    process.env.SCRIPT_FORCE_MOCK === "true"
  );
}

/**
 * 通用 JSON 模式 LLM 调用：系统提示 + 用户提示 → 强制返回 JSON。
 * 如果 OPENAI_API_KEY 未配置则抛错（调用方应自行 mock）。
 *
 * 防御性守门：当 isLLMForcedMock() 为 true 时**主动 throw**，
 * 让任何漏掉自家 mock 短路的 service 在调用站点立刻爆栈 —— 而不是悄悄发出真实请求。
 */
export async function chatJson<T = unknown>(
  options: ChatJsonOptions,
): Promise<ChatJsonResult<T>> {
  if (isLLMForcedMock()) {
    throw new Error(
      "LLM_FORCE_MOCK is true; refusing to send real OpenAI request — caller must short-circuit to mock before invoking chatJson.",
    );
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY 未配置");
  }
  refreshOpenAiKeyFromEnv();

  const model = options.model || resolveModelForTier("fast");
  const tokenLimit = buildTokenLimitParam(model, options.maxTokens ?? 3500);
  const temperatureParam = buildTemperatureParam(model, options.temperature ?? 0.7);
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
    response_format: { type: "json_object" },
    ...temperatureParam,
    ...tokenLimit,
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
  /// 提前 fast-fail：让漏配 mock 的 service 看到清晰栈
  if (isLLMForcedMock()) {
    throw new Error(
      `LLM_FORCE_MOCK is true; refusing to send real OpenAI request for tier=${options.tier} — caller must short-circuit to mock.`,
    );
  }
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
  if (isLLMForcedMock()) {
    throw new Error(
      "LLM_FORCE_MOCK is true; refusing to send real OpenAI vision request — caller must short-circuit to mock.",
    );
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY 未配置");
  }
  refreshOpenAiKeyFromEnv();

  const visionModel = resolveModelForTier("vision");
  const imageContent = imageUrls.slice(0, 8).map((url) => ({
    type: "image_url" as const,
    image_url: { url, detail: "low" as const },
  }));

  const tokenLimit = buildTokenLimitParam(visionModel, 1200);
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
    ...tokenLimit,
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
  buildTokenLimitParam,
  buildTemperatureParam,
  isLLMForcedMock,
};
