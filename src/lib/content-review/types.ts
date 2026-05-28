/**
 * 内容审核 Provider 抽象（lib/content-review）
 *
 * 中国大陆合规要求：
 * - 用户上传素材前/后必须经过内容审核
 * - 发送给视频生成模型的 prompt 必须先过审
 * - 视频生成结果保存后建议二次审核（视觉/合规风险大）
 *
 * 当前阶段：
 * - CONTENT_REVIEW_ENABLED=false 时使用 noop（一律放行，但仍记录调用点）
 * - CONTENT_REVIEW_ENABLED=true 且 CONTENT_REVIEW_PROVIDER=volcengine 时接火山内容安全
 *
 * 任何调用 review 接口的 service 都不应静默跳过；如果 provider 配置错误，
 * 必须返回 ReviewVerdict.FAILED_OPEN（或 throw，由 caller 决定）。
 */

export type ReviewVerdict =
  /// 通过
  | "approved"
  /// 拒绝（含敏感词 / 色情 / 政治等）
  | "rejected"
  /// 需要人工复审
  | "manual_review"
  /// Provider 调用失败但配置为 fail-open（默认放行）
  | "failed_open"
  /// Provider 调用失败且配置为 fail-closed（默认拒绝）
  | "failed_closed";

export type ReviewObjectKind =
  /// 用户上传的素材（视频/图片/音频/文档）
  | "user_upload"
  /// 发送给视频生成模型的 prompt 文本
  | "generation_prompt"
  /// 生成完毕的视频成品
  | "generated_video"
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
  readonly id: "noop" | "volcengine";
  readonly displayName: string;

  /// 是否已配置可用（noop 永远返回 true）
  isConfigured(): boolean;

  reviewText(input: TextReviewInput): Promise<ReviewResult>;
  reviewMedia(input: MediaReviewInput): Promise<ReviewResult>;
}
