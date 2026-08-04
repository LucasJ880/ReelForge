import {
  getShuyuVideoTask,
  SHUYU_VIDEO_MODEL,
  shuyuApiKey,
  createShuyuVideoTask,
  isShuyuVideoPlanCoolingDown,
  markShuyuVideoPlanRejected,
  resolveShuyuVideoPlans,
  resolveShuyuVideoPlanWithCooldown,
  shuyuVideoPlanPointsForDuration,
  ShuyuApiError,
  type AuditedShuyuVideoPlan,
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

    /// 套餐从 /prices 动态解析:默认取审计清单首位(最便宜的 720P,跳过
    /// 提交被拒后处于冷却中的套餐);调用方显式指定的套餐必须在审计清单内,
    /// 否则 fail-closed,且显式选择绝不静默替换。
    const explicitPlanId = options.providerPlanId?.trim() || null;
    let plan: AuditedShuyuVideoPlan;
    try {
      plan = await resolveShuyuVideoPlanWithCooldown({
        ...this.options,
        planId: explicitPlanId,
      });
    } catch (error) {
      throw new ProviderSubmissionError(
        error instanceof Error
          ? error.message
          : "No audited Shuyu video plan is available",
        {
          providerId: this.id,
          stage: "preflight",
          retryable:
            error instanceof ShuyuApiError && error.code !== "not_found",
          cause: error,
        },
      );
    }
    const availability = await getShuyuRouteRuntimeAvailability({
      ...this.options,
      requiredPoints: shuyuVideoPlanPointsForDuration(plan, duration),
    });
    if (!availability.available) {
      /// 预检只拦「确定性不可用」:余额不足/未配置/价目失配/鉴权拒绝。
      /// 探针自身抖动(超时/限流/残缺响应)不判死——提交才是真探针,
      /// 幂等键保证重复提交安全;0804 真机:探针瞬时失败连环误杀了
      /// 三条本可成功的任务。
      const definitiveBlock = [
        "insufficient_balance",
        "not_configured",
        "price_contract_mismatch",
        "authentication_rejected",
      ].includes(availability.reason ?? "");
      if (definitiveBlock) {
        throw new ProviderSubmissionError(
          availability.reason === "insufficient_balance"
            ? "Shuyu provider balance is insufficient"
            : `Shuyu provider route is not ready (${availability.reason})`,
          {
            providerId: this.id,
            stage: "preflight",
            code: availability.reason ?? undefined,
            retryable: false,
          },
        );
      }
      console.warn("[shuyu] availability probe flaky; proceeding to submit", {
        reason: availability.reason,
      });
    }

    /// Shuyu 代理会拒绝显式 generate_audio 字段，因此不把 options.generateAudio
    /// 写入请求体。原生口播意图已经包含在 prompt 的 Dialogue / Audio 指令里；
    /// 历史原始成片证明代理在省略开关时仍可返回自带音轨的视频。
    /// 提交级套餐降级:/prices 说 available 的套餐仍可能在提交时被
    /// 「video option is unavailable」拒绝(0804 真机:限时特价档大面积拒单)。
    /// 默认套餐被拒 → 冷却该套餐并按顺位换下一档重试(至多 3 档);
    /// 显式选择的套餐被拒 → 如实失败,不做静默替换。
    const attemptedPlanIds: string[] = [];
    for (;;) {
      try {
        const created = await createShuyuVideoTask({
          ...this.options,
          providerRequestKey: requestKey,
          model: this.model,
          planId: plan.planId,
          prompt,
          duration,
          aspectRatio: options.aspectRatio ?? "9:16",
          inputImages,
        });
        return {
          providerJobId: created.taskId,
          providerId: this.id,
          providerPlanId: plan.planId,
          providerUnitPoints: shuyuVideoPlanPointsForDuration(plan, duration),
        };
      } catch (error) {
        const optionUnavailable =
          error instanceof ProviderSubmissionError &&
          /video option is unavailable/i.test(error.message);
        if (!optionUnavailable || explicitPlanId) throw error;
        markShuyuVideoPlanRejected(plan.planId);
        attemptedPlanIds.push(plan.planId);
        if (attemptedPlanIds.length >= 3) throw error;
        const plans = await resolveShuyuVideoPlans(this.options);
        const next = plans.find(
          (candidate) =>
            !attemptedPlanIds.includes(candidate.planId) &&
            !isShuyuVideoPlanCoolingDown(candidate.planId),
        );
        if (!next) throw error;
        console.warn("[shuyu] plan rejected at submit; falling back", {
          from: plan.planId,
          to: next.planId,
        });
        plan = next;
      }
    }
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
