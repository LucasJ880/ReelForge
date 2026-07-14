import assert from "node:assert/strict";
import test from "node:test";
import {
  customerApiError,
  customerApiErrorCodes,
  customerApiErrorSchema,
  customerRecoveryActions,
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

test("H1 contract: every declared machine code and recovery action is schema-valid", () => {
  for (const code of customerApiErrorCodes) {
    for (const action of customerRecoveryActions) {
      assert.equal(
        customerApiErrorSchema.safeParse(
          customerApiError({
            code,
            message: "客户可见错误",
            retryable: action === "retry",
            action,
          }),
        ).success,
        true,
      );
    }
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

