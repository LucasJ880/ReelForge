import {
  customerApiError,
  type CustomerApiErrorCode,
  type CustomerRecoveryAction,
} from "@/lib/contracts/customer-api";

export { customerApiError };
export type { CustomerRecoveryAction };
export type CustomerGenerationErrorCode = CustomerApiErrorCode;

export interface CustomerGenerationError {
  code: CustomerGenerationErrorCode;
  message: string;
  retryable: boolean;
  action: CustomerRecoveryAction;
}

/**
 * 读旧记录用：成片画面质检（2026-11-16 整套删除）拦下一段时写进 VideoJob.errorMessage 的前缀。
 * 现在没有任何代码再写它；库里带这个前缀的失败行仍按「产物已判废、重试就是重新生成」处理
 *（本文件的报错文案、video-service 的单条重试、batch-service 的批量重试）。
 */
export const FRAME_QA_ERROR_PREFIX = "[frame-qa]";

export class SubmissionReconciliationRequiredError extends Error {
  readonly code = "SUBMISSION_ACK_UNKNOWN" as const;

  constructor() {
    super(
      "生成服务可能已接收任务。系统已停止重复提交以避免重复计费，请联系支持核对。",
    );
    this.name = "SubmissionReconciliationRequiredError";
  }
}

function looksLikeAssetFailure(message: string): boolean {
  return /(asset|source image|reference image|input image|素材|源图|参考图).*(missing|not found|unavailable|unreadable|expired|不存在|不可用|无法读取)/i.test(
    message,
  );
}

export function classifyCustomerGenerationError(args: {
  status: string;
  submissionState?: string | null;
  submissionErrorClass?: string | null;
  errorMessage?: string | null;
  userSafeError?: string | null;
  isStuck?: boolean;
  /**
   * When supplied by a mutation-owning service, this is the authoritative
   * billing-safety decision for another provider submission. Serializers must
   * not advertise a retry that the mutation will reject.
   */
  billingSafeToRetry?: boolean;
}): CustomerGenerationError | null {
  if (args.status !== "FAILED") return null;
  const raw = `${args.submissionErrorClass ?? ""} ${args.errorMessage ?? ""}`;
  if (
    args.submissionState === "ACK_UNKNOWN" ||
    args.submissionState === "SUBMITTING" ||
    /ack_unknown|acknowledgement_unknown|status_lookup_ack_unknown/i.test(raw)
  ) {
    return {
      code: "SUBMISSION_ACK_UNKNOWN",
      message:
        "生成服务可能已接收任务。系统已停止重复提交以避免重复计费，请联系支持核对。",
      retryable: false,
      action: "contact_support",
    };
  }
  /// 读旧记录：被已删除的成片画面质检拦下的段（errorMessage 以 FRAME_QA_ERROR_PREFIX 开头）。
  /// 供应商已确认完成、产物被判废，结果是确定的。不能落到下面「生成结果尚未确认」那句——
  /// 那是在说计费状态不明，对被质检拦下的段是错误的原因；也排在素材判据之前，
  /// 质检摘要里的画面文字不能被误认成「素材失效」。
  if ((args.errorMessage ?? "").startsWith(FRAME_QA_ERROR_PREFIX)) {
    const retryable = args.billingSafeToRetry !== false;
    return {
      code: "PROVIDER_ERROR",
      message: retryable
        ? (args.userSafeError ??
          "画面质检未通过（检测到异常文字），已自动拦截。点击「重试」可重新生成本段。")
        : "画面质检未通过（检测到异常文字），已自动拦截。本段暂时不能自动重新生成，请联系支持处理。",
      retryable,
      action: retryable ? "retry" : "contact_support",
    };
  }
  if (looksLikeAssetFailure(raw)) {
    return {
      code: "ASSET_MISSING",
      message: "原始素材已失效或无法读取，请替换素材后重新提交。",
      retryable: false,
      action: "replace_asset",
    };
  }
  if (
    args.isStuck ||
    /watchdog:(?:timeout|(?:provider_)?stalled)|\btimeout\b|超时|僵死/i.test(
      raw,
    )
  ) {
    const retryable = args.billingSafeToRetry !== false;
    return {
      code: "PROVIDER_TIMEOUT",
      message: retryable
        ? (args.userSafeError ?? "生成等待超时，请稍后重试。")
        : "生成状态尚未确认。为避免重复计费，系统已暂停重试，请联系支持核对。",
      retryable,
      action: retryable ? "retry" : "contact_support",
    };
  }
  const retryable = args.billingSafeToRetry !== false;
  return {
    code: "PROVIDER_ERROR",
    message: retryable
      ? (args.userSafeError ?? "视频生成失败，请稍后重试。")
      : "生成结果尚未确认。为避免重复计费，系统已暂停重试，请联系支持核对。",
    retryable,
    action: retryable ? "retry" : "contact_support",
  };
}
