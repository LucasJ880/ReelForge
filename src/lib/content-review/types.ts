/**
 * Provider-neutral content review contract for the North American deployment.
 * The three enforced boundaries are upload, generation prompt, and finalized media.
 * A configured provider failure is fail-closed; mock mode is explicit and auditable.
 */

export type ReviewVerdict =
  /// 通过
  | "approved"
  /// Rejected by the configured safety taxonomy.
  | "rejected"
  /// 需要人工复审
  | "manual_review"
  /// Legacy fail-open result. Production policy must not select this verdict.
  | "failed_open"
  /// Provider failure with the production fail-closed policy.
  | "failed_closed";

export type ReviewObjectKind =
  /// User-uploaded image, video, or audio.
  | "user_upload"
  /// Text sent to a video generation provider.
  | "generation_prompt"
  /// Finalized generated video.
  | "generated_video"
  /// Customer-visible generated or edited image.
  | "generated_image"
  /// 用户输入的脚本/说明文本
  | "text_input";

export interface TextReviewInput {
  kind: ReviewObjectKind;
  /// 待审核文本
  text: string;
  /// 业务上下文（如 briefId, projectId），用于审计日志
  context?: Record<string, string | number | boolean>;
}

export interface MediaReviewInput {
  kind: ReviewObjectKind;
  /// 媒体 URL（HTTPS 可达）
  mediaUrl: string;
  /// "image" | "video" | "audio"
  mediaType: "image" | "video" | "audio";
  context?: Record<string, string | number | boolean>;
}

export interface ReviewResult {
  verdict: ReviewVerdict;
  /// 审核 ID（provider 返回；用于追溯）
  reviewId?: string;
  /// 命中的违规类型（如 ["politics", "violence"]）
  categories?: string[];
  /// 命中的关键词 / 描述
  hits?: string[];
  /// 审核分数（0-100，越高越违规；不同 provider 含义不同，仅供日志）
  score?: number;
  /// 友好的错误描述（中文，可直接给用户看）
  userMessage?: string;
  /// 完整 provider 响应（仅 admin/debug）
  rawResponse?: unknown;
}

export interface ContentReviewProvider {
  readonly id: "noop" | "openai_moderation";
  readonly displayName: string;

  /// 是否已配置可用（noop 永远返回 true）
  isConfigured(): boolean;

  reviewText(input: TextReviewInput): Promise<ReviewResult>;
  reviewMedia(input: MediaReviewInput): Promise<ReviewResult>;
}
