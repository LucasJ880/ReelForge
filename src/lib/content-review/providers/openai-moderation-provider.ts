import OpenAI from "openai";
import type {
  ContentReviewProvider,
  MediaReviewInput,
  ReviewResult,
  TextReviewInput,
} from "../types";

const MODEL = "omni-moderation-latest";

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
      const response = await client().moderations.create({
        model: MODEL,
        input: input.text,
      });
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
      const response = await client().moderations.create({
        model: MODEL,
        input: [{ type: "image_url", image_url: { url: imageUrl } }],
      });
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

export const __test__ = { mapResult, isMockMode };
