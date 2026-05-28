/**
 * 视频生成 Provider 抽象接口。
 *
 * 设计目标：
 * - 业务代码 (video-service / cron) 只 import 这里的 type + getVideoProvider()，
 *   不再直接 import 任何 seedance.ts / volcengine sdk。
 * - 不同 provider 的"原始状态"全部归一到统一 6 态（normalizeProviderStatus）。
 * - VideoJob DB 记录至少携带：provider / providerJobId / providerRawStatus /
 *   normalizedStatus / errorMessage / createdAt / updatedAt / finishedAt
 *   （Prisma VideoJob 已经有大部分字段，本次新增 `provider` enum 已存在 + lastProviderStatus）。
 */

export type NormalizedVideoStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

export interface VideoJobReferenceImage {
  url: string;
  /// "first_frame" | "last_frame" | 任意辅助
  role?: "first_frame" | "last_frame" | "content";
}

export interface CreateVideoJobOptions {
  prompt: string;
  referenceImages?: VideoJobReferenceImage[];
  durationSec?: number;
  /// "9:16" | "16:9" | "1:1" | "21:9"...
  aspectRatio?: string;
  /// "720p" | "1080p"
  resolution?: string;
  /// 显式覆盖模型（如 doubao-seedance-2-0-pro / -262）
  model?: string;
  /// Seedance 2+ 是否生成原生音频；保留通用名让 caller 友好
  generateAudio?: boolean;
  /// 是否返回末帧（用于段间衔接）
  returnLastFrame?: boolean;
  /// 公网可达回调（如有）
  callbackUrl?: string;

  /**
   * Mock 模式下渲染唯一 placeholder 视频的提示（briefId / segmentIndex 等）。
   * 真实 provider 永远忽略此字段。
   */
  mockHints?: {
    briefId: string;
    segmentIndex: number;
    segmentCount: number;
    durationSec: number;
    aspectRatio: string;
    purpose?: string;
  };
}

export interface CreateVideoJobResult {
  providerJobId: string;
  /// Provider 标识（写入 VideoJob.provider 时只取 SEEDANCE_T2V/I2V/FFMPEG_EDIT；这里返回的是字符串）
  providerId: string;
}

export interface VideoJobStatusResult {
  providerJobId: string;
  /// 6 态归一
  normalizedStatus: NormalizedVideoStatus;
  /// Provider 原始状态字符串（queued / running / succeeded / failed / expired / ...）
  rawProviderStatus: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  lastFrameUrl?: string;
  errorMessage?: string;
  progress?: number;
  /// 完整 Provider 响应（仅 admin/debug 区使用）
  rawProviderResponse?: unknown;
}

export interface VideoProvider {
  readonly id: "volcengine";
  readonly displayName: string;

  isConfigured(): boolean;
  isMockMode(): boolean;

  createVideoJob(options: CreateVideoJobOptions): Promise<CreateVideoJobResult>;
  getVideoJobStatus(providerJobId: string): Promise<VideoJobStatusResult>;

  /**
   * 取消任务（如果 provider 支持）。
   * 不支持时返回 { supported: false }，caller 决定是否标记为 CANCELLED。
   */
  cancelVideoJob(
    providerJobId: string,
  ): Promise<{ supported: boolean; cancelled?: boolean; error?: string }>;

  /**
   * 从完成的 status 结果中提取视频 URL。
   * 多数 provider 直接读 `videoUrl`；保留为 method 是为了未来某些 provider 需要二次解析。
   */
  getGeneratedVideoUrl(status: VideoJobStatusResult): string | null;

  /**
   * 把 provider 原始字符串映射到统一 6 态。
   * 暴露为 method 方便 caller 在迁移历史数据时复用。
   */
  normalizeProviderStatus(raw: string): NormalizedVideoStatus;
}

export function normalizeStatusBuiltin(raw: string): NormalizedVideoStatus {
  const v = raw.toLowerCase().trim();
  if (["succeeded", "success", "completed", "done"].includes(v)) {
    return "succeeded";
  }
  if (["failed", "error", "expired"].includes(v)) return "failed";
  if (["cancelled", "canceled"].includes(v)) return "cancelled";
  if (["queued", "pending", "waiting"].includes(v)) return "queued";
  if (["running", "processing", "in_progress"].includes(v)) return "processing";
  return "unknown";
}
