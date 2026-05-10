import type { AIUsageStatus } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * AI 调用日志：feature/provider/model/tokens/cost/status 全可追踪。
 *
 * 设计要点：
 * - 这里只做「成本/可观测」记录；具体业务结果由各业务表保存（避免双写)。
 * - inputSummary/outputSummary 必须截断到 1KB 以内，防止误存 PII。
 * - 失败时也要写一条 status=FAILED 的 log，带 errorMessage。
 */
export interface RecordAIUsageInput {
  feature: string;
  provider?: string;
  model?: string | null;
  deliveryOrderId?: string | null;
  creativeCardId?: string | null;
  actorUserId?: string | null;
  inputSummary?: string | null;
  outputSummary?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  costEstimateUsd?: number | null;
  promptVersion?: string | null;
  status?: AIUsageStatus;
  errorMessage?: string | null;
  durationMs?: number | null;
}

const MAX_SUMMARY_CHARS = 1024;

export async function recordAIUsage(input: RecordAIUsageInput) {
  return db.aIUsageLog.create({
    data: {
      feature: input.feature,
      provider: input.provider ?? "openai",
      model: input.model ?? null,
      deliveryOrderId: input.deliveryOrderId ?? null,
      creativeCardId: input.creativeCardId ?? null,
      actorUserId: input.actorUserId ?? null,
      inputSummary: truncate(input.inputSummary),
      outputSummary: truncate(input.outputSummary),
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      totalTokens: input.totalTokens ?? null,
      costEstimateUsd: input.costEstimateUsd ?? null,
      promptVersion: input.promptVersion ?? null,
      status: input.status ?? "SUCCESS",
      errorMessage: input.errorMessage ?? null,
      durationMs: input.durationMs ?? null,
    },
  });
}

/**
 * 估算 OpenAI 模型成本。
 * 价格与 OpenAI 公开 pricing 对齐（2026-05），仅作估算用，可能滞后。
 */
export function estimateOpenAICostUsd(params: {
  model: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
}): number | null {
  const { model } = params;
  const prompt = params.promptTokens ?? 0;
  const completion = params.completionTokens ?? 0;
  if (prompt === 0 && completion === 0) return null;

  const pricing = OPENAI_PRICING[model] ?? OPENAI_PRICING_FALLBACK;
  const cost = (prompt / 1000) * pricing.prompt + (completion / 1000) * pricing.completion;
  return Number(cost.toFixed(6));
}

const OPENAI_PRICING: Record<string, { prompt: number; completion: number }> = {
  /// 单价 USD / 1K tokens
  "gpt-4o-mini": { prompt: 0.00015, completion: 0.0006 },
  "gpt-4o": { prompt: 0.0025, completion: 0.01 },
  "gpt-4.1-mini": { prompt: 0.0004, completion: 0.0016 },
};
const OPENAI_PRICING_FALLBACK = { prompt: 0.001, completion: 0.003 };

/**
 * 包装一个 LLM 调用：记录耗时、token、状态、错误。
 *
 * 用法：
 *   const data = await withAIUsageTracking({
 *     feature: "client_script",
 *     promptVersion: PROMPT_VERSION,
 *     model: "gpt-4o-mini",
 *     deliveryOrderId,
 *   }, async () => await chatJson(...));
 */
export async function withAIUsageTracking<T>(
  meta: Omit<RecordAIUsageInput, "status" | "errorMessage" | "durationMs"> & {
    /// 仅 meta 用：用户 prompt 摘要（用于 inputSummary fallback）
    inputForLog?: string;
  },
  fn: () => Promise<{
    data: T;
    modelUsed?: string;
    tokenUsage?: {
      promptTokens?: number | null;
      completionTokens?: number | null;
      totalTokens?: number | null;
    } | null;
    raw?: string;
  }>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const usage = result.tokenUsage ?? null;
    const cost = estimateOpenAICostUsd({
      model: result.modelUsed ?? meta.model ?? "gpt-4o-mini",
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
    });
    await recordAIUsage({
      ...meta,
      model: result.modelUsed ?? meta.model ?? null,
      inputSummary: meta.inputSummary ?? meta.inputForLog ?? null,
      outputSummary:
        meta.outputSummary ??
        (typeof result.raw === "string" ? result.raw : null),
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      costEstimateUsd: cost,
      durationMs: Date.now() - start,
      status: "SUCCESS",
    });
    return result.data;
  } catch (err) {
    await recordAIUsage({
      ...meta,
      model: meta.model ?? null,
      inputSummary: meta.inputSummary ?? meta.inputForLog ?? null,
      durationMs: Date.now() - start,
      status: "FAILED",
      errorMessage: (err as Error).message,
    });
    throw err;
  }
}

function truncate(value?: string | null) {
  if (!value) return null;
  if (value.length <= MAX_SUMMARY_CHARS) return value;
  return `${value.slice(0, MAX_SUMMARY_CHARS - 3)}...`;
}
