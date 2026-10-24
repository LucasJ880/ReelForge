/**
 * 供应商「账户层」错误：额度用完 / 欠费 / key 没有该模型权限。
 * 这类错误原样重试必然再失败——给客户的应是「暂不可用、我们在处理」，不是「请稍后重试」。
 * 1025 真机验收：OpenAI 账户 429「no credits remaining」在实拍线路被包成 500 + retryable。
 */
export function isProviderBillingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const status = typeof e.status === "number" ? e.status : null;
  const message = typeof e.message === "string" ? e.message : "";
  if (code === "insufficient_quota" || code === "billing_hard_limit_reached" || code === "model_not_found") return true;
  if (status === 401 || status === 403) return true;
  return /no credits remaining|insufficient_quota|exceeded your current quota|does not have access to model/i.test(message);
}
