import assert from "node:assert/strict";
import test from "node:test";
import { quotaErrorResponse } from "../src/lib/api-quota";
import {
  batchErrorResponseSchema,
  batchQuotaErrorSchema,
} from "../src/lib/contracts/batch-api";
import { customerApiErrorSchema } from "../src/lib/contracts/customer-api";
import {
  uploadBlobQuotaErrorSchema,
  uploadBlobResponseSchema,
} from "../src/lib/contracts/upload-blob";
import {
  QuotaExceededError,
  RateLimitExceededError,
} from "../src/lib/services/quota-service";

function baseEnvelope(value: Record<string, unknown>) {
  const metadata = new Set(["resource", "used", "limit", "periodKey"]);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !metadata.has(key)),
  );
}

test("H1 quota contract: upload 429 uses a strict shared envelope plus explicit byte metadata", async () => {
  const response = quotaErrorResponse(
    new QuotaExceededError({
      resource: "BLOB_UPLOAD_BYTES",
      used: 1024,
      limit: 1024,
      periodKey: "2026-07",
    }),
  );
  assert.ok(response);
  assert.equal(response.status, 429);
  const body = (await response.json()) as Record<string, unknown>;
  assert.deepEqual(uploadBlobQuotaErrorSchema.parse(body), body);
  assert.deepEqual(uploadBlobResponseSchema.parse(body), body);
  assert.deepEqual(
    customerApiErrorSchema.parse(baseEnvelope(body)),
    baseEnvelope(body),
  );
  assert.equal(body.code, "QUOTA_EXCEEDED");
});

test("H1 quota contract: batch 429 normalizes internal dispatch resource for customers", async () => {
  const response = quotaErrorResponse(
    new QuotaExceededError({
      resource: "VIDEO_DISPATCH",
      used: 250,
      limit: 250,
      periodKey: "2026-07",
    }),
  );
  assert.ok(response);
  assert.equal(response.status, 429);
  const body = (await response.json()) as Record<string, unknown>;
  assert.deepEqual(batchQuotaErrorSchema.parse(body), body);
  assert.deepEqual(batchErrorResponseSchema.parse(body), body);
  assert.deepEqual(
    customerApiErrorSchema.parse(baseEnvelope(body)),
    baseEnvelope(body),
  );
  assert.equal(body.code, "QUOTA_EXCEEDED");
  assert.equal(body.resource, "VIDEO_GENERATION");
});

test("H1 rate-limit contract: upload and batch receive RATE_LIMITED, never the legacy code", async () => {
  for (const endpointSchema of [
    uploadBlobResponseSchema,
    batchErrorResponseSchema,
  ]) {
    const response = quotaErrorResponse(
      new RateLimitExceededError("操作过于频繁，请稍后再试"),
    );
    assert.ok(response);
    assert.equal(response.status, 429);
    const body = await response.json();
    assert.deepEqual(customerApiErrorSchema.parse(body), body);
    assert.deepEqual(endpointSchema.parse(body), body);
    assert.equal(body.code, "RATE_LIMITED");
    assert.notEqual(body.code, "RATE_LIMIT_EXCEEDED");
  }
});

test("H1 endpoint extensions reject undeclared metadata instead of leaking it", () => {
  const quota = {
    ok: false,
    code: "QUOTA_EXCEEDED",
    error: "额度已用尽。",
    retryable: false,
    action: "view_usage",
    resource: "VIDEO_GENERATION",
    used: 250,
    limit: 250,
    periodKey: "2026-07",
    providerJobId: "must-not-leak",
  };
  assert.equal(batchErrorResponseSchema.safeParse(quota).success, false);

  const validation = {
    ok: false,
    code: "VALIDATION_FAILED",
    error: "批量生成参数不合法",
    retryable: false,
    action: "fix_request",
    issues: {
      formErrors: [],
      fieldErrors: { requestedCount: ["必须是整数"] },
    },
  };
  assert.deepEqual(batchErrorResponseSchema.parse(validation), validation);
  assert.equal(customerApiErrorSchema.safeParse(validation).success, false);
});
