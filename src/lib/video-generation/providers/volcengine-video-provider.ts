/**
 * 火山 / 即梦 / Seedance 视频生成 Provider 适配器。
 *
 * 实现策略：复用现有 src/lib/providers/seedance.ts。
 * 现有 seedance.ts 已支持：
 *   - submitSeedanceJobResilient (T2V/I2V 自动 fallback)
 *   - getSeedanceStatus (4 态映射)
 *   - VIDEO_ENGINE_MOCK 兜底 + mockHints
 *
 * 本适配器只做接口对齐 + 状态归一（4 态 → 6 态）+ cancel 占位。
 * 不复制业务逻辑，避免双线维护。
 */

import { isDryRun } from "@/lib/config/dry-run";
import {
  getSeedanceStatus,
  isSeedanceConfigured,
  submitSeedanceJobResilient,
} from "@/lib/providers/seedance";
import type {
  CreateVideoJobOptions,
  CreateVideoJobResult,
  NormalizedVideoStatus,
  VideoJobStatusResult,
  VideoProvider,
} from "./types";
import { normalizeStatusBuiltin } from "./types";

export class VolcengineVideoProvider implements VideoProvider {
  readonly id = "volcengine" as const;
  readonly displayName = "火山引擎 (即梦 / Seedance)";

  isConfigured(): boolean {
    return isSeedanceConfigured();
  }

  /// AIVORA_DRY_RUN / VIDEO_ENGINE_MOCK 显式 true，或 ARK_API_KEY 缺失且未显式 false
  isMockMode(): boolean {
    if (isDryRun()) return true;
    const flag = process.env.VIDEO_ENGINE_MOCK?.toLowerCase();
    if (flag === "1" || flag === "true" || flag === "yes") return true;
    if (flag === "0" || flag === "false" || flag === "no") return false;
    return !process.env.ARK_API_KEY;
  }

  async createVideoJob(
    options: CreateVideoJobOptions,
  ): Promise<CreateVideoJobResult> {
    const refUrls = (options.referenceImages ?? [])
      .map((r) => r.url)
      .filter(Boolean);
    const prompt = options.negativePrompt?.trim()
      ? `${options.prompt}\nNegative constraints: ${options.negativePrompt.trim()}`
      : options.prompt;

    const { jobId } = await submitSeedanceJobResilient({
      prompt,
      referenceImageUrls: refUrls.length > 0 ? refUrls : undefined,
      duration: options.durationSec,
      resolution: options.resolution,
      ratio: options.aspectRatio,
      model: options.model,
      generateAudio: options.generateAudio,
      returnLastFrame: options.returnLastFrame,
      mockHints: options.mockHints,
    });
    return { providerJobId: jobId, providerId: this.id };
  }

  async getVideoJobStatus(
    providerJobId: string,
  ): Promise<VideoJobStatusResult> {
    const r = await getSeedanceStatus(providerJobId);
    return {
      providerJobId: r.jobId,
      normalizedStatus: this.normalizeProviderStatus(r.rawProviderStatus),
      rawProviderStatus: r.rawProviderStatus,
      videoUrl: r.videoUrl,
      thumbnailUrl: r.thumbnailUrl,
      lastFrameUrl: r.lastFrameUrl,
      errorMessage: r.errorMessage,
      progress: r.progress,
      rawProviderResponse: r.rawProviderResponse,
    };
  }

  async cancelVideoJob(
    _providerJobId: string,
  ): Promise<{ supported: boolean; cancelled?: boolean; error?: string }> {
    /// 火山方舟 Seedance v3 暂未公开"取消任务"接口；过期任务靠 expired 状态自动结束。
    return {
      supported: false,
      error: "Seedance v3 暂不支持显式取消任务（任务过期会被服务端自动标记 expired）",
    };
  }

  getGeneratedVideoUrl(status: VideoJobStatusResult): string | null {
    return status.videoUrl ?? null;
  }

  normalizeProviderStatus(raw: string): NormalizedVideoStatus {
    return normalizeStatusBuiltin(raw);
  }
}
