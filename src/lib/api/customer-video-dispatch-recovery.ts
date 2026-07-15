import type {
  CustomerApiErrorCode,
  CustomerRecoveryAction,
} from "@/lib/contracts/customer-api";

export interface DispatchRecoveryInput {
  retryable: boolean;
  action: CustomerRecoveryAction;
}

/**
 * A fresh idempotency key is allowed only when the server explicitly offers an
 * immediate retry. Waiting, refreshing status, fixing input, and support-led
 * reconciliation must keep the original attempt identity.
 */
export function shouldResetDispatchAttempt(
  failure: DispatchRecoveryInput,
): boolean {
  return failure.retryable && failure.action === "retry";
}

export function dispatchRecoveryHint(
  action: CustomerRecoveryAction,
  locale: "zh-CN" | "en-US",
): string {
  const english = locale === "en-US";
  switch (action) {
    case "retry":
      return english
        ? "This action can be retried safely. Use the available retry control."
        : "该操作可以安全重试，请使用当前页面提供的重试入口。";
    case "fix_request":
      return english
        ? "Update the highlighted description or settings, then submit again."
        : "请修改描述或设置中标记的问题后再提交。";
    case "wait":
      return english
        ? "The service is congested. Wait a few minutes, then try the same request again."
        : "生成服务暂时拥堵，请等待几分钟后用同一内容重试。";
    case "refresh_status":
      return english
        ? "The request is already processing. Check the video library instead of submitting it again."
        : "该请求已在处理中，请到成品库查看状态，不要重复提交。";
    case "contact_support":
      return english
        ? "Keep this request open and contact support; do not submit it again until it is reconciled."
        : "请保留当前请求并联系支持；核对完成前不要重复提交。";
    case "view_usage":
      return english
        ? "Your plan limit has been reached. Contact your account owner to review usage or upgrade the plan."
        : "当前套餐额度已用尽，请联系账户负责人核对用量或升级套餐。";
    case "replace_asset":
      return english
        ? "Remove the unavailable asset, upload a valid replacement, and submit again."
        : "请移除失效素材，重新上传有效文件后再提交。";
    case "sign_in":
      return english
        ? "Sign in again before submitting this request."
        : "请重新登录后再提交此请求。";
  }
}

const unsafeCustomerCopyPattern =
  /(?:\b(?:401|403)\b|api[\s_-]*key|access[\s_-]*token|\btoken\b|authorization|bearer|secret|credential|provider|seedance|byteplus|modelark|ark\.|response\s*body|raw\s*body|stack\s*trace|https?:\/\/|[{}])/i;

/**
 * Quality blockers are the only server-authored dispatch copy a customer may
 * see. Keep the allowlist deliberately narrow: one short, single-line message
 * in the active UI language with no credential, provider, HTTP or raw-payload
 * vocabulary. All other dispatch copy is owned by the client below.
 */
function safeQualityBlocker(
  blockers: string[] | undefined,
  locale: "zh-CN" | "en-US",
): string | null {
  const candidate = blockers?.find((blocker) => {
    const value = blocker.trim();
    if (!value || value.length > 160 || /[\r\n\u0000-\u001f]/.test(value)) {
      return false;
    }
    if (unsafeCustomerCopyPattern.test(value)) return false;

    const containsChinese = /[\u3400-\u9fff]/.test(value);
    return locale === "zh-CN" ? containsChinese : !containsChinese;
  });
  return candidate?.trim() ?? null;
}

/**
 * Customer-owned direct-dispatch copy. Never use `failure.error` here: it is
 * retained in the transport contract for operational compatibility and may
 * contain a provider response, credential hint, HTTP status or other internal
 * detail. Machine code + locale + recovery action are the only display inputs.
 */
export function customerDirectDispatchMessage(
  failure: {
    code: CustomerApiErrorCode;
    action: CustomerRecoveryAction;
    blockers?: string[];
  },
  locale: "zh-CN" | "en-US",
): string {
  const english = locale === "en-US";
  const localized = (englishCopy: string, chineseCopy: string) =>
    english ? englishCopy : chineseCopy;

  let summary: string;
  switch (failure.code) {
    case "AUTH_REQUIRED":
      summary = localized(
        "Your session has expired, so this video was not submitted.",
        "登录状态已失效，本次视频未提交。",
      );
      break;
    case "FORBIDDEN":
      summary = localized(
        "This account cannot submit video generation requests.",
        "当前账号无法提交视频生成请求。",
      );
      break;
    case "VALIDATION_FAILED":
    case "IDEMPOTENCY_KEY_REQUIRED":
    case "IDEMPOTENCY_CONFLICT":
      summary = localized(
        "The video settings need to be reviewed before submission.",
        "视频设置需要复核后才能提交。",
      );
      break;
    case "RESOURCE_NOT_FOUND":
      summary = localized(
        "A required video resource is no longer available.",
        "本次生成所需的资源已不可用。",
      );
      break;
    case "INVALID_STATE":
    case "REQUEST_IN_PROGRESS":
      summary = localized(
        "This video request already has an active status.",
        "该视频请求已有进行中的状态。",
      );
      break;
    case "QUALITY_BLOCKED":
      summary =
        safeQualityBlocker(failure.blockers, locale) ??
        localized(
          "The video brief needs more detail before it can be submitted.",
          "视频需求需要补充细节后才能提交。",
        );
      break;
    case "RATE_LIMITED":
      summary = localized(
        "Too many video requests were submitted in a short time.",
        "短时间内提交的视频请求过多。",
      );
      break;
    case "QUOTA_EXCEEDED":
      summary = localized(
        "The current plan does not have enough video quota.",
        "当前套餐的视频额度不足。",
      );
      break;
    case "QUOTA_CHECK_UNAVAILABLE":
      summary = localized(
        "We could not verify video quota right now.",
        "暂时无法确认视频额度。",
      );
      break;
    case "STORAGE_UNAVAILABLE":
      summary = localized(
        "The uploaded assets are temporarily unavailable.",
        "上传素材暂时不可用。",
      );
      break;
    case "SUBMISSION_ACK_UNKNOWN":
      summary = localized(
        "We could not confirm whether the generation service received this request.",
        "暂时无法确认生成服务是否已接收该请求。",
      );
      break;
    case "PROVIDER_TIMEOUT":
      summary = localized(
        "The video generation service did not respond in time.",
        "视频生成服务未能及时响应。",
      );
      break;
    case "PROVIDER_ERROR":
      summary = localized(
        "The video generation service could not accept this request.",
        "视频生成服务暂时无法接收该请求。",
      );
      break;
    case "ASSET_MISSING":
      summary = localized(
        "A selected product asset is no longer available.",
        "所选产品素材已不可用。",
      );
      break;
    case "SERVICE_UNAVAILABLE":
      summary = localized(
        "Video generation is temporarily unavailable.",
        "视频生成服务暂时不可用。",
      );
      break;
    case "INTERNAL_ERROR":
      summary = localized(
        "We could not submit this video request right now.",
        "暂时无法提交本次视频请求。",
      );
      break;
  }

  return `${summary} ${dispatchRecoveryHint(failure.action, locale)}`.trim();
}

/**
 * Batch-create API bodies intentionally keep a Chinese server default for
 * operators and logs. Customer UI copy is selected from the machine code so
 * an English workspace never echoes that upstream-language message.
 */
export function batchCreateErrorMessage(
  code: CustomerApiErrorCode | undefined,
  locale: "zh-CN" | "en-US",
  serverMessage?: string,
): string {
  const english = locale === "en-US";
  const chineseFallback = serverMessage?.trim();
  const localized = (englishCopy: string, chineseCopy: string) =>
    english ? englishCopy : chineseFallback || chineseCopy;

  switch (code) {
    case "AUTH_REQUIRED":
      return localized(
        "Sign in again before creating this batch.",
        "请重新登录后再创建批次。",
      );
    case "FORBIDDEN":
      return localized(
        "This account cannot create batches. Contact your workspace owner.",
        "当前账号无法创建批次，请联系工作区负责人。",
      );
    case "VALIDATION_FAILED":
    case "IDEMPOTENCY_KEY_REQUIRED":
      return localized(
        "Check the selected style, product images, and batch settings before submitting again.",
        "请检查所选风格、产品图片与批次设置后重新提交。",
      );
    case "IDEMPOTENCY_CONFLICT":
      return localized(
        "This submission key was already used for different batch settings. Review the batch before submitting again.",
        "该提交标识已用于不同的批次设置，请复核后重新提交。",
      );
    case "RATE_LIMITED":
      return localized(
        "Too many batch requests were submitted. Wait briefly, then try again.",
        "批次提交过于频繁，请稍后再试。",
      );
    case "QUOTA_EXCEEDED":
      return localized(
        "Your current plan does not have enough video quota for this batch.",
        "当前套餐的视频额度不足以创建该批次。",
      );
    case "QUOTA_CHECK_UNAVAILABLE":
      return localized(
        "We could not verify your video quota. Try again in a moment.",
        "暂时无法确认视频额度，请稍后重试。",
      );
    case "SERVICE_UNAVAILABLE":
      return localized(
        "Video generation is temporarily unavailable. Wait a few minutes, then try again.",
        "视频生成服务暂时不可用，请等待几分钟后重试。",
      );
    default:
      return english
        ? "We could not create this batch. Review the settings and try again."
        : chineseFallback || "暂时无法创建批次，请检查设置后重试。";
  }
}
