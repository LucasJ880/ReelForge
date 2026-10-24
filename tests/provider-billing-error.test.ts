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

test("图文出图：账户层错误回 503 + 稍后再来（不是「出图失败，请重试」），已出的图保留", async () => {
  const service = await readFile("src/lib/services/content-post-render-service.ts", "utf8");
  assert.match(service, /isProviderBillingError\(failure\)[\s\S]*?"provider_unavailable"/);
  const route = await readFile("src/app/api/content-plans/[id]/posts/[postId]/render/route.ts", "utf8");
  assert.match(route, /err\.reason === "provider_unavailable"[\s\S]*?code: "SERVICE_UNAVAILABLE"[\s\S]*?action: "wait"/);
});

test("内容计划：「重新排一周」每次点击一个新幂等键（同一句话不再永远回放旧计划）", async () => {
  const timeline = await readFile("src/components/content-plan/plan-timeline.tsx", "utf8");
  assert.match(timeline, /idempotencyKey: `plan-\$\{crypto\.randomUUID\(\)\}`/);
  assert.doesNotMatch(timeline, /btoa\(unescape\(encodeURIComponent\(input\)\)\)/);
});
