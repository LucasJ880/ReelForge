import OpenAI from "openai";
import type {
  ContentReviewProvider,
  MediaReviewInput,
  ReviewResult,
  TextReviewInput,
} from "../types";

const MODEL = "omni-moderation-latest";

/// 批量派发会短时间连发多次审核请求，OpenAI moderation 的 429/5xx/网络抖动
/// 属于「稍后重试即可」的瞬时故障。此前直接 fail-closed 会把整批任务永久判死
/// （2026-07-20 真机验收：18 连发中 12 条因此死亡）。仅对瞬时错误做有限退避重试，
/// 重试穷尽后仍然 fail-closed，不放松安全语义。
const TRANSIENT_RETRY_DELAYS_MS = [1_000, 3_000];

function isTransientModerationError(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  if (typeof status !== "number") return true; // 网络层错误（无 HTTP 状态）
  return status === 408 || status === 429 || status >= 500;
}

async function withTransientRetries<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (
        !isTransientModerationError(error) ||
        attempt === TRANSIENT_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, TRANSIENT_RETRY_DELAYS_MS[attempt]),
      );
    }
  }
  throw lastError;
}

type ModerationResult = {
  flagged: boolean;
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
};

export class OpenAiModerationProvider implements ContentReviewProvider {
  readonly id = "openai_moderation" as const;
  readonly displayName = "OpenAI omni-moderation-latest";

  isConfigured() {
    return isMockMode() || Boolean(process.env.OPENAI_API_KEY);
  }

  async reviewText(input: TextReviewInput): Promise<ReviewResult> {
    if (isMockMode()) return mockApproved(input.kind);
    if (!process.env.OPENAI_API_KEY) return failedClosed("审核服务尚未配置");
    try {
      const response = await withTransientRetries(() =>
        client().moderations.create({
          model: MODEL,
          input: input.text,
        }),
      );
      return mapResult(response.id, response.results[0] as unknown as ModerationResult | undefined);
    } catch {
      return failedClosed("内容安全检查暂时不可用，请稍后重试");
    }
  }

  async reviewMedia(input: MediaReviewInput): Promise<ReviewResult> {
    if (isMockMode()) return mockApproved(input.kind);
    if (!process.env.OPENAI_API_KEY) return failedClosed("审核服务尚未配置");
    if (input.mediaType === "audio") {
      return {
        verdict: "manual_review",
        categories: ["unsupported_audio"],
        userMessage: "音频素材需要人工复核后才能使用",
      };
    }
    const imageUrl = input.mediaType === "image"
      ? input.mediaUrl
      : typeof input.context?.previewImageUrl === "string"
        ? input.context.previewImageUrl
        : null;
    if (!imageUrl) {
      return {
        verdict: "manual_review",
        categories: ["video_preview_required"],
        userMessage: "视频素材正在等待画面抽帧复核",
      };
    }
    try {
      const response = await withTransientRetries(() =>
        client().moderations.create({
          model: MODEL,
          input: [{ type: "image_url", image_url: { url: imageUrl } }],
        }),
      );
      return mapResult(response.id, response.results[0] as unknown as ModerationResult | undefined);
    } catch {
      return failedClosed("媒体安全检查暂时不可用，请稍后重试");
    }
  }
}

function client() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function isMockMode() {
  return [process.env.CONTENT_REVIEW_MOCK, process.env.LLM_FORCE_MOCK]
    .some((value) => ["1", "true", "yes"].includes(value?.toLowerCase() ?? ""));
}

function mockApproved(kind: string): ReviewResult {
  return {
    verdict: "approved",
    reviewId: `mock_moderation_${kind}`,
    categories: [],
    score: 0,
  };
}

function failedClosed(userMessage: string): ReviewResult {
  return { verdict: "failed_closed", categories: ["provider_unavailable"], userMessage };
}

function mapResult(reviewId: string, result?: ModerationResult): ReviewResult {
  if (!result) return failedClosed("审核服务返回了无效结果，请稍后重试");
  const categories = Object.entries(result.categories)
    .filter(([, flagged]) => flagged)
    .map(([category]) => category);
  const score = Math.max(0, ...Object.values(result.category_scores)) * 100;
  return {
    verdict: result.flagged ? "rejected" : "approved",
    reviewId,
    categories,
    score,
    userMessage: result.flagged
      ? "素材或描述包含暂不支持的内容，请调整后重试"
      : undefined,
  };
}

export const __test__ = {
  mapResult,
  isMockMode,
  withTransientRetries,
  isTransientModerationError,
  TRANSIENT_RETRY_DELAYS_MS,
};
