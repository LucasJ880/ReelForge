import {
  getShuyuVideoTask,
  SHUYU_VIDEO_MODEL,
  SHUYU_VIDEO_POINTS_PER_GENERATION,
  shuyuApiKey,
  createShuyuVideoTask,
  ShuyuApiError,
  type ShuyuFetchOptions,
} from "@/lib/providers/shuyu";
import { ProviderSubmissionError } from "./submission-error";
import type {
  CreateVideoJobOptions,
  CreateVideoJobResult,
  NormalizedVideoStatus,
  VideoJobStatusResult,
  VideoProvider,
} from "./types";
import { getShuyuRouteRuntimeAvailability } from "../shuyu-runtime";

const MAX_REFERENCE_IMAGES = 9;

export class ShuyuVideoProvider implements VideoProvider {
  readonly id = "shuyu" as const;
  readonly displayName = "Shuyu API (Seedance partner route)";
  readonly manualRetryBillingRisk = "possible" as const;

  constructor(
    private readonly model: string = SHUYU_VIDEO_MODEL,
    private readonly options: ShuyuFetchOptions = {},
  ) {}

  isConfigured(): boolean {
    return Boolean(shuyuApiKey(this.options.env));
  }

  isMockMode(): boolean {
    return false;
  }

  async createVideoJob(
    options: CreateVideoJobOptions,
  ): Promise<CreateVideoJobResult> {
    const requestKey = options.providerRequestKey?.trim();
    if (!requestKey || requestKey.length < 8 || requestKey.length > 120) {
      throw new ProviderSubmissionError(
        "Shuyu submission requires an 8-120 character persisted provider request key",
        { providerId: this.id, stage: "preflight", retryable: false },
      );
    }
    const duration = options.durationSec ?? 5;
    if (!Number.isInteger(duration) || duration < 5 || duration > 15) {
      throw new ProviderSubmissionError(
        "Shuyu video duration must be an integer from 5 to 15 seconds",
        { providerId: this.id, stage: "preflight", retryable: false },
      );
    }
    if (
      this.model !== SHUYU_VIDEO_MODEL ||
      (options.model && options.model !== this.model)
    ) {
      throw new ProviderSubmissionError(
        "The persisted Shuyu model is not the audited public model",
        { providerId: this.id, stage: "preflight", retryable: false },
      );
    }
    const prompt = options.negativePrompt?.trim()
      ? `${options.prompt}\nNegative constraints: ${options.negativePrompt.trim()}`
      : options.prompt;
    if (!prompt.trim() || prompt.length > 5_000) {
      throw new ProviderSubmissionError(
        prompt.length > 5_000
          ? "Shuyu prompt must not exceed 5000 characters after negative constraints"
          : "Shuyu prompt is required",
        {
          providerId: this.id,
          stage: "preflight",
          retryable: false,
        },
      );
    }
    const inputImages = (options.referenceImages ?? [])
      .map((image) => image.url.trim())
      .filter(Boolean);
    if (
      inputImages.length > MAX_REFERENCE_IMAGES ||
      inputImages.some((url) => {
        try {
          return new URL(url).protocol !== "https:";
        } catch {
          return true;
        }
      })
    ) {
      throw new ProviderSubmissionError(
        "Shuyu accepts at most 9 HTTPS reference images",
        { providerId: this.id, stage: "preflight", retryable: false },
      );
    }

    try {
      const { reviewTextOrThrow } = await import("@/lib/content-review");
      await reviewTextOrThrow({
        kind: "generation_prompt",
        text: prompt,
      });
    } catch (error) {
      throw new ProviderSubmissionError(
        error instanceof Error
          ? error.message
          : "Shuyu prompt content review failed",
        {
          providerId: this.id,
          stage: "preflight",
          retryable: false,
          cause: error,
        },
      );
    }

    const availability = await getShuyuRouteRuntimeAvailability({
      ...this.options,
      requiredPoints: SHUYU_VIDEO_POINTS_PER_GENERATION,
    });
    if (!availability.available) {
      const transientFailure = [
        "rate_limited",
        "timeout",
        "upstream_unavailable",
      ].includes(availability.reason ?? "");
      throw new ProviderSubmissionError(
        availability.reason === "insufficient_balance"
          ? "Shuyu provider balance is insufficient"
          : "Shuyu provider route is not ready",
        {
          providerId: this.id,
          stage: "preflight",
          code: availability.reason ?? undefined,
          retryable: transientFailure,
        },
      );
    }

    const created = await createShuyuVideoTask({
      ...this.options,
      providerRequestKey: requestKey,
      model: this.model,
      prompt,
      duration,
      aspectRatio: options.aspectRatio ?? "9:16",
      inputImages,
    });
    return { providerJobId: created.taskId, providerId: this.id };
  }

  async getVideoJobStatus(
    providerJobId: string,
  ): Promise<VideoJobStatusResult> {
    const task = await getShuyuVideoTask(providerJobId, this.options);
    const videoUrl = task.outputs?.[0]?.url;
    if (task.status === "completed" && !videoUrl) {
      throw new ShuyuApiError(
        "Shuyu completed task contains no output URL",
        "invalid_response",
        200,
      );
    }
    return {
      providerJobId,
      normalizedStatus: this.normalizeProviderStatus(task.status),
      rawProviderStatus: task.status,
      videoUrl,
      errorMessage:
        task.status === "refunded"
          ? "Shuyu generation failed and provider points were refunded"
          : task.status === "refund_error"
            ? "Shuyu generation failed and provider refund needs reconciliation"
            : undefined,
      rawProviderResponse: task,
    };
  }

  async cancelVideoJob(
    _providerJobId: string,
  ): Promise<{ supported: boolean; cancelled?: boolean; error?: string }> {
    void _providerJobId;
    return {
      supported: false,
      error: "Shuyu API does not document a task cancellation endpoint",
    };
  }

  getGeneratedVideoUrl(status: VideoJobStatusResult): string | null {
    return status.videoUrl ?? null;
  }

  normalizeProviderStatus(raw: string): NormalizedVideoStatus {
    switch (raw.trim().toLowerCase()) {
      case "queued":
        return "queued";
      case "processing":
        return "processing";
      case "completed":
        return "succeeded";
      // Retry remains sealed until the provider confirms the refund. Both
      // intermediate states keep polling instead of opening a second charge.
      case "refund_pending":
      case "refund_error":
      case "failed":
        return "processing";
      case "refunded":
        return "failed";
      default:
        return "unknown";
    }
  }
}
