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

export const customerApiErrorSchema = z
  .object({
    ok: z.literal(false),
    code: z.enum(customerApiErrorCodes),
    error: z.string().min(1),
    retryable: z.boolean(),
    action: z.enum(customerRecoveryActions),
  })
  .passthrough();

export type CustomerApiError = z.infer<typeof customerApiErrorSchema>;

export function customerApiError(args: {
  code: CustomerApiErrorCode;
  message: string;
  retryable: boolean;
  action: CustomerRecoveryAction;
}) {
  return {
    ok: false as const,
    code: args.code,
    error: args.message,
    retryable: args.retryable,
    action: args.action,
  };
}

