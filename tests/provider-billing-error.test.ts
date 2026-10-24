import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isProviderBillingError } from "../src/lib/providers/provider-billing-error";

test("1025：账户层错误（无额度 / 无权限）识别为不可重试", () => {
  assert.equal(isProviderBillingError({ status: 429, message: "429 You have no credits remaining. Add credits to continue" }), true);
  assert.equal(isProviderBillingError({ status: 429, code: "insufficient_quota", message: "quota" }), true);
  assert.equal(isProviderBillingError({ status: 403, message: "Project does not have access to model gpt-4o-mini-tts" }), true);
  // 普通限流 / 网络抖动仍可重试
  assert.equal(isProviderBillingError({ status: 429, message: "Rate limit reached for requests" }), false);
  assert.equal(isProviderBillingError(new Error("ECONNRESET")), false);
  assert.equal(isProviderBillingError(null), false);
});

test("实拍线路：账户层错误回 503 + 不可重试 + 人话，不再是 500「请稍后重试」", async () => {
  const route = await readFile("src/app/api/broll/dispatch/route.ts", "utf8");
  assert.match(route, /if \(isProviderBillingError\(err\)\) \{[\s\S]*?code: "PROVIDER_UNAVAILABLE"[\s\S]*?retryable: false,[\s\S]*?status: 503/);
});
