/**
 * 内容审核 Provider 工厂入口。
 *
 * 业务代码使用方式：
 *
 *   import { reviewTextOrThrow } from "@/lib/content-review";
 *   await reviewTextOrThrow({ kind: "generation_prompt", text: prompt, context: { briefId } });
 *
 * Provider 选择：
 *   - CONTENT_REVIEW_ENABLED=false → 强制 noop
 *   - CONTENT_REVIEW_ENABLED=true + PROVIDER=noop → 警告 + 走 noop（仅 dev/staging 临时）
 *   - CONTENT_REVIEW_ENABLED=true + PROVIDER=openai_moderation → text/image moderation
 *
 * Enforced boundaries: upload, generation prompt before provider submit, and
 * final media before it becomes customer-visible.
 */

import { getAppEnv } from "@/lib/config/env";
import { NoopReviewProvider } from "./providers/noop-review-provider";
import { OpenAiModerationProvider } from "./providers/openai-moderation-provider";
import type {
  ContentReviewProvider,
  MediaReviewInput,
  ReviewResult,
  TextReviewInput,
} from "./types";

let cached: ContentReviewProvider | null = null;

export function getContentReviewProvider(): ContentReviewProvider {
  if (cached) return cached;
  cached = createContentReviewProvider();
  return cached;
}

export function createContentReviewProvider(): ContentReviewProvider {
  const env = getAppEnv();

  /// Hard rule：CONTENT_REVIEW_ENABLED=false 永远走 noop，无视 PROVIDER 值
  if (!env.contentReviewEnabled) {
    return new NoopReviewProvider();
  }

  switch (env.contentReviewProvider) {
    case "openai_moderation":
      return new OpenAiModerationProvider();
    case "noop":
      console.warn(
        "[content-review] CONTENT_REVIEW_ENABLED=true 但 PROVIDER=noop，等同于未启用审核（仅 dev/staging 允许）",
      );
      return new NoopReviewProvider();
    default: {
      const exhaustiveCheck: never = env.contentReviewProvider;
      throw new Error(
        `[content-review] 未知 CONTENT_REVIEW_PROVIDER: ${String(exhaustiveCheck)}`,
      );
    }
  }
}

export function __resetContentReviewProviderForTests(): void {
  cached = null;
}

/**
 * Fail closed for every non-approved result. A manual-review verdict is a queue,
 * not permission to deliver or submit content.
 */
export async function reviewTextOrThrow(
  input: TextReviewInput,
): Promise<ReviewResult> {
  const provider = getContentReviewProvider();
  const result = await provider.reviewText(input);
  if (result.verdict !== "approved") {
    throw new ContentReviewRejectedError(input.kind, result);
  }
  return result;
}

/**
 * 同上，针对媒体。
 */
export async function reviewMediaOrThrow(
  input: MediaReviewInput,
): Promise<ReviewResult> {
  const provider = getContentReviewProvider();
  const result = await provider.reviewMedia(input);
  if (result.verdict !== "approved") {
    throw new ContentReviewRejectedError(input.kind, result);
  }
  return result;
}

export class ContentReviewRejectedError extends Error {
  constructor(
    public objectKind: string,
    public result: ReviewResult,
  ) {
    super(
      result.userMessage ||
        `内容审核未通过（${objectKind}）：${(result.categories ?? []).join(", ") || result.verdict}`,
    );
    this.name = "ContentReviewRejectedError";
  }

  /**
   * True 仅当审核 provider 明确判定内容违规（verdict==="rejected"）。
   * 只有这种情况才是「用户素材本身有问题、需更换素材」。
   *
   * 其余非通过结果——failed_closed / failed_open（provider 不可达、密钥缺失、
   * 429/5xx 抖动、OpenAI 拉不到素材 URL）与 manual_review（视频/音频需抽帧或人工，
   * 当前无自动放行）——都不是用户素材的问题，不能提示「请更换素材」，
   * 应按「安全检查暂不可用、稍后重试」处理。此判定让上传边界不再把 provider 故障
   * 误报成内容违规（0721 线上真机：正常产品图因此上传不了）。
   */
  get isContentGenuinelyBlocked(): boolean {
    return this.result.verdict === "rejected";
  }
}

/**
 * 把内容审核异常归类为「用户可见语义」。非 ContentReviewRejectedError 一律视为
 * 服务临时不可用（provider 抛错已在 provider 内兜成 failed_closed，走到这里的其它异常
 * 属未知瞬时故障）。业务路由据此选择 QUALITY_BLOCKED（换素材）还是可重试的不可用态。
 */
export function classifyContentReviewFailure(
  error: unknown,
): "content_blocked" | "review_unavailable" {
  if (
    error instanceof ContentReviewRejectedError &&
    error.isContentGenuinelyBlocked
  ) {
    return "content_blocked";
  }
  return "review_unavailable";
}

export type {
  ContentReviewProvider,
  MediaReviewInput,
  ReviewResult,
  TextReviewInput,
  ReviewVerdict,
  ReviewObjectKind,
} from "./types";
