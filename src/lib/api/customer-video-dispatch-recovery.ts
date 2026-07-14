import type { CustomerRecoveryAction } from "@/lib/contracts/customer-api";

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
