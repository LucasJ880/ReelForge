import {
  getShuyuVideoTask,
  SHUYU_VIDEO_MODEL,
  shuyuApiKey,
  createShuyuVideoTask,
  isShuyuSameKeyRetryable,
  isShuyuVideoPlanCoolingDown,
  markShuyuVideoPlanRejected,
  resolveShuyuVideoPlans,
  resolveShuyuVideoPlanWithCooldown,
  SHUYU_MAX_REFERENCE_IMAGES,
  SHUYU_MAX_VIDEO_DURATION_SEC,
  isShuyuVideoPlanInLane,
  shuyuDefaultVideoLane,
  shuyuReferenceImageLimit,
  shuyuVideoPlanPointsForDuration,
  ShuyuApiError,
  type AuditedShuyuVideoPlan,
  type ShuyuFetchOptions,
  type ShuyuVideoPlanTier,
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

/**
 * 本次任务**诉求**的套餐档(P03-A1)。缺省不带 tier = 默认线路(Seedance 2.5 · 1080P,
 * 线路缺席回落 draft 首位);显式 "draft" 才取最便宜的 720P。
 *
 * 诉求 ≠ 授权。`qualityTier === "final"` 只表达「这次想要 1080P」,**不**推出「准许 1080P」:
 * 授权来自 resolveShuyuVideoPlan 的 allowFinal 闸门(服务端 env SHUYU_ALLOW_FINAL_TIER,
 * 生产忽略;或调用链显式 allowFinal:true)。适配器一律不传 allowFinal(交给闸门);
 * 将来若要按调用方放开 final 档,必须另设**独立的授权标记**,不得复用 qualityTier。
 *
 * **不能**从 `options.resolution === "1080p"` 推断:模板锁参(generic/sunnyshutter
 * commerce template)与 video-service 今天一律传 "1080p"(成片拉伸口径),按它推断
 * 会把全部客户任务静默切到 1080P 档计费,直接违反「默认档必须仍是最便宜的 720P」。
 */
function requestedShuyuVideoPlanTier(
  options: CreateVideoJobOptions,
): ShuyuVideoPlanTier | undefined {
  return options.qualityTier;
}

/**
 * 同键重投（Shuyu 明说没建任务、没扣点、要求用同一个 Idempotency-Key 重试的拒单，见
 * isShuyuSameKeyRetryable）：退避 2s、5s，最多重投两次，且必须在首次提交后 15s 内开始——
 * 批量任务的提交租约只有 60s（单次提交的确认上限 45s），单条派发是客户在等的同步请求。
 * 用完仍被拒就原样抛出（确认未建任务、可重试）：单条视频由派发入口改交 Runway，
 * 批量由队列按自己的上限换新键退避。
 */
const SAME_KEY_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000];
const SAME_KEY_RETRY_WINDOW_MS = 15_000;

/** 同键重投的计时与等待（测试注入；缺省真实计时器） */
export interface ShuyuSubmitRetryClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const SYSTEM_CLOCK: ShuyuSubmitRetryClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class ShuyuVideoProvider implements VideoProvider {
  readonly id = "shuyu" as const;
  readonly displayName = "Shuyu API (Seedance partner route)";
  readonly manualRetryBillingRisk = "possible" as const;
  /// Shuyu 请求体没有经过审计的音频/视频参考字段(P03-D″ 以 E2″ 实证为准再接)。
  readonly supportsReferenceAudio = false;
  readonly maxReferenceImages = SHUYU_MAX_REFERENCE_IMAGES;

  constructor(
    private readonly model: string = SHUYU_VIDEO_MODEL,
    private readonly options: ShuyuFetchOptions = {},
    private readonly clock: ShuyuSubmitRetryClock = SYSTEM_CLOCK,
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
    if (!Number.isInteger(duration) || duration < 5 || duration > SHUYU_MAX_VIDEO_DURATION_SEC) {
      throw new ProviderSubmissionError(
        `Shuyu video duration must be an integer from 5 to ${SHUYU_MAX_VIDEO_DURATION_SEC} seconds`,
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
      inputImages.length > SHUYU_MAX_REFERENCE_IMAGES ||
      inputImages.some((url) => {
        try {
          return new URL(url).protocol !== "https:";
        } catch {
          return true;
        }
      })
    ) {
      throw new ProviderSubmissionError(
        `Shuyu accepts at most ${SHUYU_MAX_REFERENCE_IMAGES} HTTPS reference images`,
        { providerId: this.id, stage: "preflight", retryable: false },
      );
    }
    /// 静默丢弃会让客户以为声音/动作参考生效了;必须在任何网络请求(含内容审核)前拒绝。
    if ((options.referenceAudios?.length ?? 0) > 0) {
      throw new ProviderSubmissionError(
        "Shuyu route does not support reference audio",
        { providerId: this.id, stage: "preflight", retryable: false },
      );
    }
    if ((options.referenceVideos?.length ?? 0) > 0) {
      throw new ProviderSubmissionError(
        "Shuyu route does not support reference videos",
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

    /// 套餐从 /prices 动态解析:默认取所在档审计清单首位(draft 档 = 最便宜的 720P,
    /// 跳过提交被拒后处于冷却中的套餐);调用方显式指定的套餐必须在审计清单内,
    /// 否则 fail-closed,且显式选择绝不静默替换。final 档(1080P)的授权只来自闸门
    /// (服务端 env SHUYU_ALLOW_FINAL_TIER,生产忽略)——
    /// 适配器不传 allowFinal,也不从 qualityTier 诉求推出授权;默认解析仍在 draft 档内。
    const requestedTier = requestedShuyuVideoPlanTier(options);
    const explicitPlanId = options.providerPlanId?.trim() || null;
    let plan: AuditedShuyuVideoPlan;
    try {
      plan = await resolveShuyuVideoPlanWithCooldown({
        ...this.options,
        planId: explicitPlanId,
        tier: requestedTier,
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
    /// 诉求 final 却解析出 draft(显式 planId 指向 720P/480P):如实拒绝,不静默降档出片。
    if (requestedTier === "final" && plan.tier !== "final") {
      throw new ProviderSubmissionError(
        `Shuyu plan ${plan.planId} is ${plan.tier} tier but a final-tier (1080P) video was requested`,
        { providerId: this.id, stage: "preflight", retryable: false },
      );
    }
    if (duration > plan.maxDurationSec) {
      throw new ProviderSubmissionError(
        `Shuyu plan ${plan.planId} supports at most ${plan.maxDurationSec}s per segment`,
        { providerId: this.id, stage: "preflight", retryable: false },
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
    /// 默认套餐被拒 → 冷却该套餐并按顺位换**同档**下一个套餐重试(至多 3 个);
    /// draft 档全被拒也不跳到 final(1080P)去扣费。
    /// 显式选择的套餐被拒 → 如实失败,不做静默替换。
    const attemptedPlanIds: string[] = [];
    const firstSubmitAt = this.clock.now();
    let sameKeyRetries = 0;
    for (;;) {
      try {
        /// 按「本次实际使用的套餐」截断参考图：降级到的下一档上限可能更小。
        /// 调用方已按优先级排序（实拍产品图在前），截掉的只会是队尾的故事板帧。
        const planInputImages = inputImages.slice(0, shuyuReferenceImageLimit(plan));
        if (planInputImages.length < inputImages.length) {
          console.warn("[shuyu] reference images truncated to plan limit", {
            planId: plan.planId,
            sent: planInputImages.length,
            dropped: inputImages.length - planInputImages.length,
          });
        }
        const created = await createShuyuVideoTask({
          ...this.options,
          providerRequestKey: requestKey,
          model: this.model,
          planId: plan.planId,
          prompt,
          duration,
          aspectRatio: options.aspectRatio ?? "9:16",
          inputImages: planInputImages,
        });
        return {
          providerJobId: created.taskId,
          providerId: this.id,
          providerPlanId: plan.planId,
          providerUnitPoints: shuyuVideoPlanPointsForDuration(plan, duration),
        };
      } catch (error) {
        /// 同一个套餐、同一份请求体、同一个键重投（规则见 SAME_KEY_RETRY_DELAYS_MS）；次数与时间窗按整次提交算。
        const delayMs = SAME_KEY_RETRY_DELAYS_MS[sameKeyRetries];
        if (
          isShuyuSameKeyRetryable(error) &&
          delayMs !== undefined &&
          this.clock.now() + delayMs - firstSubmitAt <= SAME_KEY_RETRY_WINDOW_MS
        ) {
          sameKeyRetries += 1;
          console.warn("[shuyu] submission rejected before creation; retrying with the same Idempotency-Key", {
            planId: plan.planId,
            code: error.code,
            retry: sameKeyRetries,
            delayMs,
          });
          await this.clock.sleep(delayMs);
          continue;
        }
        const optionUnavailable =
          error instanceof ProviderSubmissionError &&
          /video option is unavailable/i.test(error.message);
        if (!optionUnavailable || explicitPlanId) throw error;
        markShuyuVideoPlanRejected(plan.planId);
        attemptedPlanIds.push(plan.planId);
        if (attemptedPlanIds.length >= 3) throw error;
        const plans = await resolveShuyuVideoPlans(this.options);
        const rejectedPlan = plan;
        /// 默认线路内被拒只在线路内换档(不静默降到 2.0 / 720P);其余按同 tier 换。
        const lane = shuyuDefaultVideoLane(this.options.env ?? process.env);
        const rejectedInLane = isShuyuVideoPlanInLane(rejectedPlan, lane);
        const next = plans.find(
          (candidate) =>
            (rejectedInLane
              ? isShuyuVideoPlanInLane(candidate, lane)
              : candidate.tier === rejectedPlan.tier) &&
            candidate.maxDurationSec >= duration &&
            !attemptedPlanIds.includes(candidate.planId) &&
            !isShuyuVideoPlanCoolingDown(candidate.planId),
        );
        if (!next) throw error;
        console.warn("[shuyu] plan rejected at submit; falling back", {
          from: plan.planId,
          to: next.planId,
          tier: next.tier,
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
