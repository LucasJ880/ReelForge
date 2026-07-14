import assert from "node:assert/strict";
import test from "node:test";
import {
  customerApiError,
  customerApiErrorCodes,
  customerApiErrorSchema,
} from "../src/lib/contracts/customer-api";

test("H1 contract: the customer error envelope has one stable required shape", () => {
  const payload = customerApiError({
    code: "RESOURCE_NOT_FOUND",
    message: "批次不存在。",
    retryable: false,
    action: "contact_support",
  });
  assert.deepEqual(customerApiErrorSchema.parse(payload), payload);
  assert.deepEqual(Object.keys(payload).sort(), [
    "action",
    "code",
    "error",
    "ok",
    "retryable",
  ]);
});

test("H1 contract: every machine code has an explicit safe recovery pair", () => {
  const canonical = {
    AUTH_REQUIRED: [false, "sign_in"],
    FORBIDDEN: [false, "contact_support"],
    VALIDATION_FAILED: [false, "fix_request"],
    RESOURCE_NOT_FOUND: [false, "contact_support"],
    INVALID_STATE: [false, "refresh_status"],
    IDEMPOTENCY_KEY_REQUIRED: [false, "fix_request"],
    IDEMPOTENCY_CONFLICT: [false, "fix_request"],
    REQUEST_IN_PROGRESS: [false, "refresh_status"],
    QUALITY_BLOCKED: [false, "replace_asset"],
    RATE_LIMITED: [true, "retry"],
    QUOTA_EXCEEDED: [false, "view_usage"],
    QUOTA_CHECK_UNAVAILABLE: [true, "retry"],
    STORAGE_UNAVAILABLE: [true, "retry"],
    SUBMISSION_ACK_UNKNOWN: [false, "contact_support"],
    PROVIDER_TIMEOUT: [false, "contact_support"],
    PROVIDER_ERROR: [false, "contact_support"],
    ASSET_MISSING: [false, "replace_asset"],
    SERVICE_UNAVAILABLE: [true, "wait"],
    INTERNAL_ERROR: [false, "contact_support"],
  } as const;

  assert.deepEqual(Object.keys(canonical).sort(), [...customerApiErrorCodes].sort());
  for (const code of customerApiErrorCodes) {
    const [retryable, action] = canonical[code];
    const payload = customerApiError({
      code,
      message: "客户可见错误",
      retryable,
      action,
    });
    assert.equal(customerApiErrorSchema.safeParse(payload).success, true);
  }
});

test("H1 contract: dangerous code/action combinations are rejected at construction", () => {
  for (const invalid of [
    { code: "SUBMISSION_ACK_UNKNOWN", retryable: true, action: "retry" },
    { code: "ASSET_MISSING", retryable: true, action: "retry" },
    { code: "QUOTA_EXCEEDED", retryable: true, action: "retry" },
    { code: "AUTH_REQUIRED", retryable: false, action: "contact_support" },
  ] as const) {
    assert.throws(
      () => customerApiError({ ...invalid, message: "invalid recovery" }),
      /Invalid customer recovery semantics/,
    );
  }
});

test("H1 contract: unknown codes/actions fail closed instead of drifting", () => {
  assert.equal(
    customerApiErrorSchema.safeParse({
      ok: false,
      code: "SOMETHING_NEW",
      error: "broken",
      retryable: true,
      action: "try_anything",
    }).success,
    false,
  );
});

test("H1 contract: the shared envelope rejects undeclared diagnostic fields", () => {
  const payload = customerApiError({
    code: "INTERNAL_ERROR",
    message: "服务暂不可用。",
    retryable: true,
    action: "retry",
  });
  for (const sensitive of [
    { stack: "private stack" },
    { providerJobId: "provider-secret" },
    { issues: ["raw internal issue"] },
    { resource: "UNDECLARED_RESOURCE" },
  ]) {
    assert.equal(
      customerApiErrorSchema.safeParse({ ...payload, ...sensitive }).success,
      false,
    );
  }
});
