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

test("图文出图：账户层错误在服务层归为「暂不可用」（出图接口 2026-11-16 随本周内容删除）", async () => {
  const service = await readFile("src/lib/services/content-post-render-service.ts", "utf8");
  assert.match(service, /isProviderBillingError\(failure\)[\s\S]*?"provider_unavailable"/);
});
