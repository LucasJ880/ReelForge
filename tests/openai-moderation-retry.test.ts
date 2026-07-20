import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "../src/lib/content-review/providers/openai-moderation-provider";

const { withTransientRetries, isTransientModerationError, TRANSIENT_RETRY_DELAYS_MS } =
  __test__;

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

test("moderation retry: 429 限流后重试成功（批量连发不再一击致死）", async () => {
  let calls = 0;
  const result = await withTransientRetries(async () => {
    calls += 1;
    if (calls === 1) throw httpError(429);
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("moderation retry: 永久性 4xx（如 400）不重试，立即抛出", async () => {
  let calls = 0;
  await assert.rejects(
    withTransientRetries(async () => {
      calls += 1;
      throw httpError(400);
    }),
    /HTTP 400/,
  );
  assert.equal(calls, 1);
});

test("moderation retry: 瞬时错误重试穷尽后仍抛出（保持 fail-closed 语义）", async () => {
  let calls = 0;
  await assert.rejects(
    withTransientRetries(async () => {
      calls += 1;
      throw httpError(503);
    }),
    /HTTP 503/,
  );
  assert.equal(calls, TRANSIENT_RETRY_DELAYS_MS.length + 1);
});

test("moderation retry: 无 status 的网络层错误视为瞬时", () => {
  assert.equal(isTransientModerationError(new Error("fetch failed")), true);
  assert.equal(isTransientModerationError(httpError(429)), true);
  assert.equal(isTransientModerationError(httpError(500)), true);
  assert.equal(isTransientModerationError(httpError(403)), false);
});
