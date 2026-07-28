/**
 * Shuyu「线路繁忙 · 积分已退回」必须判为确定未创建且可重试。
 *
 * 0728 真机实测：4 帧故事板里 3 帧收到
 *   HTTP 502 {"type":"generation_failed","message":"线路繁忙，请刷新或切换线路后重试。积分已退回。"}
 * 旧分类把它当 acknowledgement_unknown 且不可重试，于是该帧永不重投、
 * 故事板 FAILED、批次永久停在 QUEUED。供应商已明说退款，重投不会二次计费。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createShuyuImageTask } from "../src/lib/providers/shuyu";
import {
  isProviderSubmissionError,
  shouldAutomaticallyRetrySubmission,
} from "../src/lib/video-generation/providers/submission-error";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const baseInput = {
  providerRequestKey: "probe-key-1234567890",
  prompt: "A faithful product demonstration in a bright room.",
  inputImages: ["https://example.test/a.jpg"],
  aspectRatio: "9:16" as const,
  /// 显式指定套餐以跳过目录解析：本组用例只验证提交失败的分类，
  /// 档位回落策略另由 shuyu-image-plan-resolution.test.ts 覆盖。
  planId: "image-plan-08",
  resolution: "2K" as const,
};

const env = { SHUYU_API_KEY: "test-key", shuyu_api_key: "test-key" };

test("busy-route refund is treated as definitely-not-created and retryable", async () => {
  const error = await createShuyuImageTask({
    ...baseInput,
    env,
    fetchImpl: async () =>
      jsonResponse(502, {
        error: {
          type: "generation_failed",
          message: "线路繁忙，请刷新或切换线路后重试。积分已退回。",
        },
      }),
  } as Parameters<typeof createShuyuImageTask>[0]).then(
    () => null,
    (reason: unknown) => reason,
  );

  assert.ok(isProviderSubmissionError(error), "应抛出 ProviderSubmissionError");
  assert.equal(error.disposition, "definitely_not_created");
  assert.equal(error.retryable, true);
  assert.equal(
    shouldAutomaticallyRetrySubmission(error),
    true,
    "退款已确认的繁忙响应应允许自动重投",
  );
});

test("top-level busy-route refund payload is also classified as safe to retry", async () => {
  const error = await createShuyuImageTask({
    ...baseInput,
    env,
    fetchImpl: async () =>
      jsonResponse(502, {
        type: "generation_failed",
        message: "线路繁忙，请刷新或切换线路后重试。积分已退回。",
      }),
  } as Parameters<typeof createShuyuImageTask>[0]).then(
    () => null,
    (reason: unknown) => reason,
  );

  assert.ok(isProviderSubmissionError(error));
  assert.equal(error.disposition, "definitely_not_created");
  assert.equal(shouldAutomaticallyRetrySubmission(error), true);
});

test("5xx without an explicit refund stays acknowledgement-unknown", async () => {
  const error = await createShuyuImageTask({
    ...baseInput,
    env,
    fetchImpl: async () =>
      jsonResponse(502, {
        error: { type: "generation_failed", message: "upstream error" },
      }),
  } as Parameters<typeof createShuyuImageTask>[0]).then(
    () => null,
    (reason: unknown) => reason,
  );

  assert.ok(isProviderSubmissionError(error));
  assert.equal(
    error.disposition,
    "acknowledgement_unknown",
    "未声明退款的 5xx 仍可能已计费，必须保持保守",
  );
  assert.equal(shouldAutomaticallyRetrySubmission(error), false);
});

test("documented 4xx rejections remain non-retryable", async () => {
  const error = await createShuyuImageTask({
    ...baseInput,
    env,
    fetchImpl: async () =>
      jsonResponse(402, {
        error: { type: "insufficient_balance", message: "余额不足" },
      }),
  } as Parameters<typeof createShuyuImageTask>[0]).then(
    () => null,
    (reason: unknown) => reason,
  );

  assert.ok(isProviderSubmissionError(error));
  assert.equal(error.disposition, "definitely_not_created");
  assert.equal(
    shouldAutomaticallyRetrySubmission(error),
    false,
    "余额不足重投只会再次失败，不应自动重试",
  );
});
