import { z } from "zod";

export const customerApiErrorCodes = [
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "VALIDATION_FAILED",
  "RESOURCE_NOT_FOUND",
  "INVALID_STATE",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "REQUEST_IN_PROGRESS",
  "QUALITY_BLOCKED",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "QUOTA_CHECK_UNAVAILABLE",
  "STORAGE_UNAVAILABLE",
  "SUBMISSION_ACK_UNKNOWN",
  "PROVIDER_TIMEOUT",
  "PROVIDER_ERROR",
  "ASSET_MISSING",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export const customerRecoveryActions = [
  "sign_in",
  "fix_request",
  "retry",
  "replace_asset",
  "view_usage",
  "contact_support",
  "wait",
  "refresh_status",
] as const;

export type CustomerApiErrorCode = (typeof customerApiErrorCodes)[number];
export type CustomerRecoveryAction = (typeof customerRecoveryActions)[number];

const allowedRecoveryPairs: Record<CustomerApiErrorCode, ReadonlySet<string>> = {
  AUTH_REQUIRED: new Set(["false:sign_in"]),
  FORBIDDEN: new Set(["false:contact_support"]),
  VALIDATION_FAILED: new Set(["false:fix_request"]),
  RESOURCE_NOT_FOUND: new Set(["false:contact_support"]),
  INVALID_STATE: new Set(["false:refresh_status", "false:contact_support"]),
  IDEMPOTENCY_KEY_REQUIRED: new Set(["false:fix_request"]),
  IDEMPOTENCY_CONFLICT: new Set([
    "false:fix_request",
    "false:contact_support",
  ]),
  REQUEST_IN_PROGRESS: new Set(["false:refresh_status"]),
  QUALITY_BLOCKED: new Set(["false:fix_request", "false:replace_asset"]),
  RATE_LIMITED: new Set(["true:retry"]),
  QUOTA_EXCEEDED: new Set(["false:view_usage"]),
  QUOTA_CHECK_UNAVAILABLE: new Set(["true:retry", "true:wait"]),
  STORAGE_UNAVAILABLE: new Set([
    "true:retry",
    "true:wait",
    "false:contact_support",
  ]),
  SUBMISSION_ACK_UNKNOWN: new Set(["false:contact_support"]),
  PROVIDER_TIMEOUT: new Set(["true:retry", "false:contact_support"]),
  PROVIDER_ERROR: new Set(["true:retry", "false:contact_support"]),
  ASSET_MISSING: new Set(["false:replace_asset"]),
  SERVICE_UNAVAILABLE: new Set([
    "true:retry",
    "true:wait",
    "false:contact_support",
  ]),
  INTERNAL_ERROR: new Set(["true:retry", "false:contact_support"]),
};

export function isCustomerRecoverySemanticallyValid(args: {
  code: CustomerApiErrorCode;
  retryable: boolean;
  action: CustomerRecoveryAction;
}): boolean {
  return allowedRecoveryPairs[args.code].has(
    `${String(args.retryable)}:${args.action}`,
  );
}

export const customerApiErrorSchema = z
  .object({
    ok: z.literal(false),
    code: z.enum(customerApiErrorCodes),
    error: z.string().min(1),
    retryable: z.boolean(),
    action: z.enum(customerRecoveryActions),
  })
  .strict();

export type CustomerApiError = z.infer<typeof customerApiErrorSchema>;

export function customerApiError(args: {
  code: CustomerApiErrorCode;
  message: string;
  retryable: boolean;
  action: CustomerRecoveryAction;
}) {
  if (!isCustomerRecoverySemanticallyValid(args)) {
    throw new TypeError(
      `Invalid customer recovery semantics for ${args.code}: retryable=${String(args.retryable)}, action=${args.action}`,
    );
  }
  return {
    ok: false as const,
    code: args.code,
    error: args.message,
    retryable: args.retryable,
    action: args.action,
  };
}
