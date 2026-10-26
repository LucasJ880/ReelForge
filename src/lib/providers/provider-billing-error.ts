/**
 * 供应商「账户层」错误：额度用完 / 欠费 / key 没有该模型权限。
 * 这类错误原样重试必然再失败——给客户的应是「暂不可用、我们在处理」，不是「请稍后重试」。
 * 1025 真机验收：OpenAI 账户 429「no credits remaining」在实拍线路被包成 500 + retryable。
 *
 * C2 · 也认 Shuyu 的同类错误（图文配图改走 Shuyu 之后，它的账户故障同样不能引导客户反复重试）：
 * - `ShuyuApiError`（GET /prices、/tasks）：code `authentication_rejected`（401/403）、
 *   `insufficient_balance`（402）、`not_configured`（没配 key，请求根本没发出去），带 `httpStatus`；
 * - `ProviderSubmissionError`（POST 提交被拒）：`httpStatus` 401/402/403，`code` 是 Shuyu 的错误 type；
 * - Shuyu 中文错误文案里的「积分不足 / 余额不足」。
 * 普通 429 限流、网络抖动、5xx 不算账户层错误（仍可重试）。
 */
export function isProviderBillingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    status?: unknown;
    httpStatus?: unknown;
    code?: unknown;
    message?: unknown;
  };
  const code = typeof e.code === "string" ? e.code : "";
  const status = typeof e.status === "number" ? e.status : null;
  const httpStatus = typeof e.httpStatus === "number" ? e.httpStatus : null;
  const message = typeof e.message === "string" ? e.message : "";
  if (code === "insufficient_quota" || code === "billing_hard_limit_reached" || code === "model_not_found") return true;
  if (status === 401 || status === 403) return true;
  /// Shuyu：ShuyuApiError 的账户层 code，以及提交被拒时的 HTTP 状态（402 = 积分不足）。
  if (code === "authentication_rejected" || code === "insufficient_balance" || code === "not_configured") return true;
  if (code === "insufficient_points" || code === "insufficient_credits") return true;
  if (status === 402 || httpStatus === 401 || httpStatus === 402 || httpStatus === 403) return true;
  return /no credits remaining|insufficient_quota|exceeded your current quota|does not have access to model|积分不足|余额不足|insufficient (?:points|balance)|api key is not configured/i.test(message);
}
