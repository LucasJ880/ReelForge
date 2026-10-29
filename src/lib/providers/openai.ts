import OpenAI from "openai";
import { isDryRun } from "@/lib/config/dry-run";
import { markCapability } from "@/lib/services/capability-status-service";
import {
  inlineImagesAfterDownloadFailure,
  isImageDownloadError,
} from "@/lib/providers/openai-vision-inline";

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
 *   vision     → gpt-5.6-sol，备用 gpt-5.6-terra（图像理解 + JSON；analyzeImages 按 vision 链回退）
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
 * 3. vision 链此前是 [sol, gpt-4o]：sol 一旦 404 就直接掉到 403 的 4o，等于没有备用线。
 *    P01-A 起备用是 gpt-5.6-terra（生产 key 有权限，也支持图像输入），analyzeImages 真的会走这条链。
 */
const FALLBACK_CHAIN: Record<OpenAITier, string[]> = {
  director: ["gpt-5.6-sol", "gpt-5.5", "gpt-4.1"],
  script: ["gpt-5.6-sol", "gpt-5.5", "gpt-4.1"],
  videoPrompt: ["gpt-5.6-sol", "gpt-5.5", "gpt-4.1"],
  creative: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-4.1"],
  qa: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-4.1-mini"],
  fast: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-4o-mini"],
  research: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-4o-mini"],
  vision: ["gpt-5.6-sol", "gpt-5.6-terra"],
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
  /** 正文 token 上限；推理模型另加思考余量（见 completionTokenBudget）。 */
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
  if (isReasoningModel(model)) {
    return { max_completion_tokens: limit };
  }
  return { max_tokens: limit };
}

/** GPT-5.x / GPT-6.x / o 系：会先「思考」再作答的模型。 */
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|gpt-6|o1|o3|o4)/i.test(model);
}

/**
 * 推理模型的 max_completion_tokens 同时包含思考与正文，而调用方的 maxTokens 是按「正文多长」定的
 * （一致性设定 1200、镜头卡 2500）。思考把额度吃光时正文为空、finish_reason=length。
 * 10-29 真机：consistency_bible 在 gpt-5.6-sol 上 reasoning_tokens=1200/1200、正文 0 字；
 * 同一请求放开上限重跑，思考 133–1375 token 不等，正文只要约 420。镜头卡在 terra 上思考 107–1025。
 * 所以推理模型在正文上限之外另留一份思考余量。按实际生成计费，上限放宽本身不多花钱。
 */
export const REASONING_HEADROOM_TOKENS = 4000;

/** 一次 JSON 调用实际下发的 token 上限：推理模型 = 正文上限 + 思考余量；其它模型 = 正文上限。 */
export function completionTokenBudget(model: string, answerTokens: number): number {
  return isReasoningModel(model) ? answerTokens + REASONING_HEADROOM_TOKENS : answerTokens;
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
  if (isReasoningModel(model)) {
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
  try {
    const result = await chatJsonOnce<T>(options);
    /// C4 · 能力状态实时回写：成功即「AI 写作正常」，账户层错误即「暂停」（同状态 10 分钟只写一次，永不抛出）。
    await markCapability("text", "success", { detail: { provider: "openai", model: result.modelUsed } });
    return result;
  } catch (err) {
    await markCapability("text", { error: err }, { detail: { provider: "openai", model: options.model } });
    throw err;
  }
}

/** 单次调用，不回写能力状态：chatJsonByTier 走完整条回退链后只回写一次结论。 */
async function chatJsonOnce<T = unknown>(
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
  const temperatureParam = buildTemperatureParam(model, options.temperature ?? 0.7);
  const { data, raw, tokenUsage } = await createJsonCompletion(
    {
      model,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user },
      ],
      ...temperatureParam,
    },
    options.maxTokens ?? 3500,
    "OpenAI ",
  );

  return { data: data as T, modelUsed: model, tokenUsage, raw };
}

type JsonCompletionRequest = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  "response_format" | "max_tokens" | "max_completion_tokens"
>;
type CompletionChoice = OpenAI.Chat.Completions.ChatCompletion["choices"][number];
type CompletionUsage = OpenAI.Chat.Completions.ChatCompletion["usage"];

/**
 * 正文为空 / JSON 被截断时的原因，写进错误信息——调用方会吞掉错误走兜底，日志里得看得出为什么。
 * 截断时说清思考用了多少额度；拒答、内容过滤直接点名。
 */
function describeIncompleteCompletion(
  model: string,
  choice: Pick<CompletionChoice, "finish_reason"> & { message?: { refusal?: string | null } | null } | undefined,
  usage: CompletionUsage | null | undefined,
  budget: number,
): string {
  const refusal = choice?.message?.refusal?.trim();
  if (refusal) return `model=${model}，模型拒答：${refusal.slice(0, 160)}`;
  const finish = choice?.finish_reason ?? "无";
  const completion = usage?.completion_tokens;
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens;
  if (finish === "length") {
    const thinking = typeof reasoning === "number" ? `，其中思考 ${reasoning}` : "";
    return `model=${model}，finish_reason=length：上限 ${budget} token 用了 ${completion ?? "?"}${thinking}，正文没写完`;
  }
  if (finish === "content_filter") return `model=${model}，finish_reason=content_filter：被内容过滤拦下`;
  return `model=${model}，finish_reason=${finish}，completion ${completion ?? "?"} token`;
}

function sumTokenUsage(usages: Array<CompletionUsage | null | undefined>): TokenUsage | null {
  const present = usages.filter((usage): usage is NonNullable<CompletionUsage> => Boolean(usage));
  if (present.length === 0) return null;
  return present.reduce<TokenUsage>(
    (total, usage) => ({
      promptTokens: total.promptTokens + usage.prompt_tokens,
      completionTokens: total.completionTokens + usage.completion_tokens,
      totalTokens: total.totalTokens + usage.total_tokens,
    }),
    { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  );
}

function parseJsonContent(content: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * 发一次 JSON 模式请求并解析正文（chatJson 与 analyzeImages 共用）。
 * 输出被截断（finish_reason=length：正文为空或 JSON 不完整）时上限翻倍再问一次——思考长度每次不同，
 * 重来一次基本都能答完；仍不行就把原因写进错误，不再只是一句「空响应」。tokenUsage 是两次之和。
 */
async function createJsonCompletion(
  request: JsonCompletionRequest,
  answerTokens: number,
  label: string,
): Promise<{ data: unknown; raw: string; tokenUsage: TokenUsage | null }> {
  const send = (budget: number) =>
    openai.chat.completions.create({
      ...request,
      response_format: { type: "json_object" },
      ...buildTokenLimitParam(request.model, budget),
    });

  let budget = completionTokenBudget(request.model, answerTokens);
  let response = await send(budget);
  const usages: CompletionUsage[] = [response.usage];
  let content = response.choices[0]?.message?.content ?? "";
  let parsed = content ? parseJsonContent(content) : null;

  if (!parsed?.ok && response.choices[0]?.finish_reason === "length") {
    console.warn(
      `[openai] ${describeIncompleteCompletion(request.model, response.choices[0], response.usage, budget)}；上限翻倍重试一次`,
    );
    budget *= 2;
    response = await send(budget);
    usages.push(response.usage);
    content = response.choices[0]?.message?.content ?? "";
    parsed = content ? parseJsonContent(content) : null;
  }

  if (parsed?.ok) return { data: parsed.value, raw: content, tokenUsage: sumTokenUsage(usages) };

  const choice = response.choices[0];
  if (!parsed) {
    throw new Error(`${label}返回了空响应（${describeIncompleteCompletion(request.model, choice, response.usage, budget)}）`);
  }
  const truncated =
    choice?.finish_reason === "length"
      ? `（${describeIncompleteCompletion(request.model, choice, response.usage, budget)}）`
      : "";
  throw new Error(`${label}返回的不是合法 JSON${truncated}：${parsed.error}\n原文：${content.slice(0, 300)}`);
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
      const result = await chatJsonOnce<T>({
        ...options,
        model: candidate,
      });
      const fallbackUsed = i > 0;
      console.log(
        `[openai] stage=${stageLabel} tier=${options.tier} model=${candidate}` +
          (fallbackUsed ? ` fallback=true (preferred=${chain[0]})` : ""),
      );
      await markCapability("text", "success", { detail: { provider: "openai", model: candidate } });
      return { ...result, fallbackUsed, tier: options.tier };
    } catch (err) {
      lastErr = err;
      if (!isModelMissingError(err)) {
        /// 非「模型不存在」错误（限流、上下文超长、内容审核等）—— 不要静默吞掉
        await markCapability("text", { error: err }, { detail: { provider: "openai", model: candidate } });
        throw err;
      }
      console.warn(
        `[openai] stage=${stageLabel} model=${candidate} 不可用，将回退到 ${chain[i + 1] ?? "无"}`,
        (err as Error).message,
      );
    }
  }
  /// 整条回退链的模型都不存在 / 没权限：同样是账户层结论，回写一次。
  await markCapability("text", { error: lastErr }, { detail: { provider: "openai", model: chain[chain.length - 1] } });
  throw lastErr instanceof Error
    ? lastErr
    : new Error("OpenAI 调用失败：所有候选模型都不可用");
}

/**
 * 「模型不存在 / 没权限」才回退到下一档。
 * 429 与 5xx 一律不算：那是限流或上游抖动，换个模型只会多花一次钱，而且会把
 * 「服务暂时不可用」这种账户层外的事实瞒过能力状态；报文里哪怕写着 "model … unavailable" 也不算。
 */
function isModelMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: number }).status;
  if (typeof status === "number" && (status === 429 || status >= 500)) return false;
  if (status === 404) return true;
  const code = (err as { code?: string }).code;
  if (code === "model_not_found") return true;
  const message = (err as Error).message ?? "";
  return /model.*(does not exist|not found|unavailable|deprecated)/i.test(
    message,
  );
}

/** analyzeImages 的调用参数：精度与输出上限。默认值 = 帧质检历史行为（low / 1200）。 */
export interface VisionAnalyzeOptions {
  /** OpenAI `image_url.detail`。low 省 token 够看字幕；商品 / 人物一致性检查用 high。 */
  detail?: "low" | "high" | "auto";
  /** 正文 token 上限（5.x 系落到 max_completion_tokens，并另加思考余量，见 completionTokenBudget）。 */
  maxTokens?: number;
}

export const VISION_DEFAULT_DETAIL: NonNullable<VisionAnalyzeOptions["detail"]> = "low";
export const VISION_DEFAULT_MAX_TOKENS = 1200;
/** 一次最多看 8 张。 */
const VISION_MAX_IMAGES = 8;

/**
 * 视觉分析：参考图理解 / 帧质检 / 故事板抽卡评审都走这里。
 *
 * P01-A（2026-10-26）：
 * - detail / maxTokens 由调用方决定，不再写死在请求里（默认值保持 low / 1200，行为不变）。
 * - 首选模型「不存在 / 没权限」时按 vision 回退链继续（与 chatJsonByTier 同一规则）。
 *   限流、超时、内容审核等错误不回退——那不是模型选错，重试另一个模型只会多花一次钱。
 *
 * 10-29：OpenAI 自己拉图偶尔超时（400 invalid_image_url）。这时服务端取图转 data URL，同一模型重试一次
 * （openai-vision-inline）。这类失败是图没拉到，不是 key / 额度问题，不回写「AI 看图」能力状态。
 */
export async function analyzeImages(
  imageUrls: string[],
  system: string,
  userPrompt: string,
  options: VisionAnalyzeOptions = {},
): Promise<ChatJsonResult<Record<string, unknown>>> {
  const chain = resolveFallbackChain("vision");
  let urls = imageUrls.slice(0, VISION_MAX_IMAGES);
  let inlineTried = false;
  let lastErr: unknown = null;
  for (let i = 0; i < chain.length; i++) {
    const candidate = chain[i];
    try {
      let result: ChatJsonResult<Record<string, unknown>>;
      try {
        result = await analyzeImagesOnce(candidate, urls, system, userPrompt, options);
      } catch (err) {
        if (inlineTried || !isImageDownloadError(err)) throw err;
        inlineTried = true;
        /// 转好的 data URL 留给回退链后面的模型继续用
        urls = await inlineImagesAfterDownloadFailure(urls, options.detail, err);
        result = await analyzeImagesOnce(candidate, urls, system, userPrompt, options);
      }
      const fallbackUsed = i > 0;
      if (fallbackUsed) {
        console.warn(
          `[openai] stage=vision model=${candidate} fallback=true (preferred=${chain[0]})`,
        );
      }
      /// C4 · 「AI 看图」实时回写（画面质检、参考图理解都走这里）。
      await markCapability("vision", "success", { detail: { provider: "openai", model: candidate } });
      return { ...result, fallbackUsed };
    } catch (err) {
      lastErr = err;
      if (!isModelMissingError(err)) {
        if (!isImageDownloadError(err)) {
          await markCapability("vision", { error: err }, { detail: { provider: "openai", model: candidate } });
        }
        throw err;
      }
      console.warn(
        `[openai] stage=vision model=${candidate} 不可用，将回退到 ${chain[i + 1] ?? "无"}`,
        (err as Error).message,
      );
    }
  }
  await markCapability("vision", { error: lastErr }, { detail: { provider: "openai", model: chain[chain.length - 1] } });
  throw lastErr instanceof Error
    ? lastErr
    : new Error("OpenAI 视觉调用失败：所有候选模型都不可用");
}

async function analyzeImagesOnce(
  visionModel: string,
  imageUrls: string[],
  system: string,
  userPrompt: string,
  options: VisionAnalyzeOptions,
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

  const detail = options.detail ?? VISION_DEFAULT_DETAIL;
  const imageContent = imageUrls.slice(0, VISION_MAX_IMAGES).map((url) => ({
    type: "image_url" as const,
    image_url: { url, detail },
  }));

  const { data, raw, tokenUsage } = await createJsonCompletion(
    {
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
    },
    options.maxTokens ?? VISION_DEFAULT_MAX_TOKENS,
    "视觉分析",
  );

  return {
    data: data as Record<string, unknown>,
    modelUsed: visionModel,
    tokenUsage,
    raw,
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
