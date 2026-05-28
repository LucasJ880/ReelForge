/**
 * AI Provider 抽象接口（lib/ai）
 *
 * 设计原则：
 * - 业务代码 (services/) 只 import 这里的 type + getAiProvider()，
 *   绝不直接 import OpenAI SDK 或火山方舟 SDK。
 * - Provider 必须实现 chatJson + chatJsonByTier；其余能力可抛
 *   `ProviderCapabilityNotImplementedError`（在 caller 层兜底）。
 * - 状态字段 (`tier` / `fallbackUsed` / `modelUsed` / `tokenUsage`) 必须保留，
 *   现有 AI usage stats / observability 依赖。
 */

export type AiTier =
  | "director"
  | "script"
  | "videoPrompt"
  | "creative"
  | "qa"
  | "fast"
  | "research"
  | "vision";

export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiChatJsonOptions {
  system: string;
  user: string;
  /// 显式覆盖模型；不传则由 provider 根据 tier 选择
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiChatJsonByTierOptions extends Omit<AiChatJsonOptions, "model"> {
  tier: AiTier;
  /// 阶段名（用于日志，例如 "client_script" / "angle_generation"）
  stage?: string;
}

export interface AiChatJsonResult<T> {
  data: T;
  modelUsed: string;
  tokenUsage: AiTokenUsage | null;
  raw: string;
  fallbackUsed?: boolean;
  tier?: AiTier;
}

export interface AiImageGenerationOptions {
  prompt: string;
  n?: number;
  /// 标准尺寸（1024x1024 / 1024x1536 / 1536x1024），或新模型支持的自定义分辨率串
  size?: string;
  quality?: "auto" | "low" | "medium" | "high";
  /// 用于在对象存储上落盘的前缀（如 "logos/{orderId}/"）
  storagePrefix?: string;
  /// 强制 mock（测试 / demo）
  forceMock?: boolean;
  /// 显式覆盖模型
  model?: string;
}

export interface AiImageGenerationResult {
  urls: string[];
  modelUsed: string;
  fromMock: boolean;
}

export interface AiVisionAnalyzeOptions {
  imageUrls: string[];
  system: string;
  user: string;
}

/**
 * AI Provider 接口。
 *
 * 现有 6 大业务能力（按 task spec）：
 *   1. 生成视频脚本 → chatJsonByTier({ tier: "script" })
 *   2. 生成 storyboard → chatJsonByTier({ tier: "director" })
 *   3. 分析用户上传素材 → analyzeImages()
 *   4. 生成镜头 prompt → chatJsonByTier({ tier: "videoPrompt" })
 *   5. 优化 prompt → chatJsonByTier({ tier: "creative" })
 *   6. 生成视频 metadata（标题/描述/标签）→ chatJsonByTier({ tier: "creative" })
 *
 * 加上文本/图像/视觉三大底层能力。
 */
export interface AiProvider {
  readonly id: "openai" | "volcengine";
  readonly displayName: string;

  /**
   * 是否对外宣称"已配置"。
   * - openai → 看 OPENAI_API_KEY
   * - volcengine → 看 VOLCENGINE_ARK_API_KEY
   * 未配置时调用 chat/image 必须抛清晰错误（不允许静默 fall back 到 mock，
   * 由 caller 的 mock guard 决定）。
   */
  isConfigured(): boolean;

  /**
   * 强制 mock 模式判定（LLM_FORCE_MOCK / DIRECTOR_FORCE_MOCK 等）。
   * Provider 实现需保持与历史行为一致：mock=true 时 chat 路径会主动 throw，
   * 让漏配 mock 的 service 立刻爆栈。
   */
  isForceMock(): boolean;

  /**
   * 通用 JSON-mode chat：必传 model（用法少见，主要供 chatJsonByTier 内部用）。
   */
  chatJson<T = unknown>(options: AiChatJsonOptions): Promise<AiChatJsonResult<T>>;

  /**
   * 按业务 tier 选模型，带 fallback chain。强烈推荐业务代码统一用这个。
   */
  chatJsonByTier<T = unknown>(
    options: AiChatJsonByTierOptions,
  ): Promise<AiChatJsonResult<T>>;

  /**
   * 视觉分析（参考图理解）。
   * 不支持时抛 ProviderCapabilityNotImplementedError。
   */
  analyzeImages(
    options: AiVisionAnalyzeOptions,
  ): Promise<AiChatJsonResult<Record<string, unknown>>>;

  /**
   * 图像生成（Logo / 海报）。
   * 不支持时抛 ProviderCapabilityNotImplementedError；caller (logo-service) 已有 mock fallback。
   */
  generateImages(
    options: AiImageGenerationOptions,
  ): Promise<AiImageGenerationResult>;
}

export class ProviderCapabilityNotImplementedError extends Error {
  constructor(public providerId: string, public capability: string) {
    super(
      `[ai] provider="${providerId}" 暂未实现能力 "${capability}"；请在 .env 切换 AI_PROVIDER，或等待 provider 实现补齐。`,
    );
    this.name = "ProviderCapabilityNotImplementedError";
  }
}
