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
