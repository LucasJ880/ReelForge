import assert from "node:assert/strict";
import test from "node:test";
import { isProviderBillingError } from "../src/lib/providers/provider-billing-error";
import { ShuyuApiError } from "../src/lib/providers/shuyu";
import { ProviderSubmissionError } from "../src/lib/video-generation/providers/submission-error";

function rejectedNoJob(status = 429): ProviderSubmissionError {
  return new ProviderSubmissionError("Shuyu said no", {
    providerId: "shuyu",
    stage: "provider_response",
    httpStatus: status,
    providerConfirmedNoJob: true,
  });
}

test("1025：账户层错误（无额度 / 无权限）识别为不可重试", () => {
  assert.equal(isProviderBillingError({ status: 429, message: "429 You have no credits remaining. Add credits to continue" }), true);
  assert.equal(isProviderBillingError({ status: 429, code: "insufficient_quota", message: "quota" }), true);
  assert.equal(isProviderBillingError({ status: 403, message: "Project does not have access to model gpt-4o-mini-tts" }), true);
  // 普通限流 / 网络抖动仍可重试
  assert.equal(isProviderBillingError({ status: 429, message: "Rate limit reached for requests" }), false);
  assert.equal(isProviderBillingError(new Error("ECONNRESET")), false);
  assert.equal(isProviderBillingError(null), false);
});

/// 原来在图文帖出图的用例里（出图服务 2026-11-16 删除）；识别函数本身还给能力状态分类用，用例留下。
test("账户层错误识别：Shuyu 401/402/403、积分不足、没配 key 都算；普通限流 / 超时不算", () => {
  assert.equal(isProviderBillingError(new ShuyuApiError("Shuyu balance request failed (402)", "insufficient_balance", 402)), true);
  assert.equal(isProviderBillingError(new ShuyuApiError("bad key", "authentication_rejected", 401)), true);
  assert.equal(isProviderBillingError(new ShuyuApiError("Shuyu API key is not configured", "not_configured")), true);
  assert.equal(isProviderBillingError(rejectedNoJob(402)), true);
  assert.equal(isProviderBillingError(rejectedNoJob(403)), true);
  assert.equal(isProviderBillingError({ message: "提交被拒绝: 积分不足，请充值" }), true);
  assert.equal(isProviderBillingError(rejectedNoJob(429)), false);
  assert.equal(isProviderBillingError(new ShuyuApiError("Shuyu request timed out", "timeout")), false);
});
