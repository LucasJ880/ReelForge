import { isProviderBillingError } from "@/lib/providers/provider-billing-error";
import type { CapabilityObservation } from "./registry";

/**
 * C4 · 把一次探测或一次生产调用的结果归到四种能力状态之一。
 *
 * 规则（探测与生产回写共用一套，免得两处口径打架）：
 *  - 2xx → 正常
 *  - 429 且是额度 / 欠费（insufficient_quota、no credits）→ 暂停（quota）；普通 429 限流 → 不稳定
 *  - 402 → 暂停（quota）；401 → 暂停（auth）；403 → 暂停（没有模型权限 = permission，否则 auth）
 *  - 404 且是模型不存在 → 暂停（permission）；其它 404 / 400 / 422 → 不稳定（多半是探测本身的问题，不拦客户）
 *  - 5xx、超时、网络错误 → 不稳定
 *
 * 纯函数，不引服务端模块。
 */

const QUOTA_PATTERN =
  /insufficient_quota|no credits|exceeded your current quota|billing_hard_limit|insufficient[ _](?:balance|credits)|payment required|out of credits/i;
const PERMISSION_PATTERN =
  /does not have access to model|model_not_found|not have access|permission|not allowed|unsupported_country|model[^\n]{0,80}(?:does not exist|not found)/i;

/** 截断 + 抹掉疑似密钥，给运维看的 note 用。 */
export function safeNote(value: string | null | undefined, max = 160): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[REDACTED]")
    .replace(/(bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1[REDACTED]")
    .replace(/([?&]key=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
}

export function classifyHttpStatus(status: number, body = ""): CapabilityObservation {
  const detail = { httpStatus: status };
  if (status >= 200 && status < 300) return { status: "available", reason: "ok", detail };
  if (status === 402 || QUOTA_PATTERN.test(body)) {
    /// 额度用完无论包成 429 还是 403，重试都必然再失败：一律按暂停处理。
    if (status === 402 || status === 429 || status === 403 || status === 401 || status === 400) {
      return { status: "unavailable", reason: "quota", detail };
    }
  }
  if (status === 429) return { status: "degraded", reason: "rate_limited", detail };
  if (status === 401) return { status: "unavailable", reason: "auth", detail };
  if (status === 403) {
    return { status: "unavailable", reason: PERMISSION_PATTERN.test(body) ? "permission" : "auth", detail };
  }
  if (status === 404 && /model/i.test(body) && PERMISSION_PATTERN.test(body)) {
    return { status: "unavailable", reason: "permission", detail };
  }
  if (status === 408 || status >= 500) return { status: "degraded", reason: "upstream", detail };
  return { status: "degraded", reason: "unknown", detail };
}

/** 探测连不上（DNS、超时、TLS、连接被拒）：上游不稳定，不是我们配置错了。 */
export function classifyNetworkError(error: unknown): CapabilityObservation {
  const name = error instanceof Error ? error.name : "";
  return {
    status: "degraded",
    reason: "upstream",
    detail: { note: name === "AbortError" || name === "TimeoutError" ? "timeout" : safeNote((error as Error)?.message) },
  };
}

type ErrorShape = { status?: unknown; httpStatus?: unknown; code?: unknown; message?: unknown };

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 生产调用失败时要不要改能力状态。只认「账户层」错误（额度、欠费、key、模型权限）：
 * 一次超时或 5xx 不改状态，否则一个抖动就会把整站标成暂停。返回 null = 不回写。
 */
export function classifyRuntimeFailure(error: unknown): CapabilityObservation | null {
  if (!error || typeof error !== "object") return null;
  const e = error as ErrorShape;
  const status = numeric(e.status) ?? numeric(e.httpStatus);
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  /// 没有 HTTP 状态也没有错误码的（JSON 解析失败、网络断开、我们自己抛的 Error）不是供应商账户的结论：
  /// 解析失败的报错里可能夹着模型原文，原文里出现 "no credits" 不能把整站标成暂停。
  if (status === null && !code) return null;
  const note = safeNote(code || (status !== null ? `HTTP ${status}` : ""));
  const detail = {
    ...(status !== null ? { httpStatus: status } : {}),
    ...(note ? { note } : {}),
  };

  if (
    code === "insufficient_quota" ||
    code === "billing_hard_limit_reached" ||
    code === "insufficient_balance" ||
    status === 402 ||
    QUOTA_PATTERN.test(message)
  ) {
    return { status: "unavailable", reason: "quota", detail };
  }
  if (status === 401 || code === "authentication_rejected" || code === "invalid_api_key") {
    return { status: "unavailable", reason: "auth", detail };
  }
  if (code === "model_not_found" || /does not have access to model/i.test(message)) {
    return { status: "unavailable", reason: "permission", detail };
  }
  if (status === 403) {
    return { status: "unavailable", reason: PERMISSION_PATTERN.test(message) ? "permission" : "auth", detail };
  }
  if (isProviderBillingError(error)) {
    return { status: "unavailable", reason: "permission", detail };
  }
  return null;
}
