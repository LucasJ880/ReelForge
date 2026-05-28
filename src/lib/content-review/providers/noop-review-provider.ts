/**
 * Noop 内容审核 Provider。
 *
 * 行为：永远 approved，但保留 reviewId 和日志（便于后续追溯）。
 *
 * 使用场景：
 * - CONTENT_REVIEW_ENABLED=false（默认）
 * - 开发 / 测试 / 海外环境
 *
 * 严格禁止：
 * - 不要在 CONTENT_REVIEW_ENABLED=true 时让 noop 静默 approved。
 *   factory 会在 enabled=true + provider=noop 时给警告。
 */

import type {
  ContentReviewProvider,
  MediaReviewInput,
  ReviewResult,
  TextReviewInput,
} from "../types";

let counter = 0;

function makeId(prefix: string): string {
  counter += 1;
  return `noop_${prefix}_${Date.now()}_${counter}`;
}

export class NoopReviewProvider implements ContentReviewProvider {
  readonly id = "noop" as const;
  readonly displayName = "Noop（无审核 · 永远放行）";

  isConfigured(): boolean {
    return true;
  }

  async reviewText(input: TextReviewInput): Promise<ReviewResult> {
    return {
      verdict: "approved",
      reviewId: makeId(input.kind),
      categories: [],
      hits: [],
      score: 0,
    };
  }

  async reviewMedia(input: MediaReviewInput): Promise<ReviewResult> {
    return {
      verdict: "approved",
      reviewId: makeId(input.kind),
      categories: [],
      hits: [],
      score: 0,
    };
  }
}
