import { classifyCustomerGenerationError } from "./customer-generation-error";
import { z } from "zod";
import {
  customerApiError,
  customerApiErrorCodes,
  customerRecoveryActions,
  type CustomerApiErrorCode,
  type CustomerRecoveryAction,
} from "@/lib/contracts/customer-api";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

const customerApiErrorCodeSet = new Set<string>(customerApiErrorCodes);

function normalizeDispatchErrorCode(value: unknown): CustomerApiErrorCode {
  if (typeof value === "string" && customerApiErrorCodeSet.has(value)) {
    return value as CustomerApiErrorCode;
  }
  // Normalize persisted responses written before the shared customer contract
  // was introduced. Replays must be as safe and predictable as first replies.
  switch (value) {
    case "IDEMPOTENCY_KEY_CONFLICT":
      return "IDEMPOTENCY_CONFLICT";
    case "PROVIDER_UNAVAILABLE":
      // The legacy code did not distinguish a pre-submit outage from an
      // accepted/billable provider job. Treat it as acknowledgement-unknown.
      return "SUBMISSION_ACK_UNKNOWN";
    case "RATE_LIMIT_EXCEEDED":
      return "RATE_LIMITED";
    case "DISPATCH_FAILED":
      // Historical DISPATCH_FAILED rows do not prove whether the provider
      // accepted or billed the original attempt. Replays must therefore keep
      // the original idempotency key and enter support-led reconciliation.
      return "SUBMISSION_ACK_UNKNOWN";
    default:
      // Unknown persisted codes carry no trustworthy submission-stage proof.
      return "SUBMISSION_ACK_UNKNOWN";
  }
}

type DispatchNeverRetryCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "RESOURCE_NOT_FOUND"
  | "INVALID_STATE"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "REQUEST_IN_PROGRESS"
  | "QUALITY_BLOCKED"
  | "QUOTA_EXCEEDED"
  | "SUBMISSION_ACK_UNKNOWN"
  | "ASSET_MISSING";

const dispatchNeverRetryCodes = new Set<CustomerApiErrorCode>([
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "VALIDATION_FAILED",
  "RESOURCE_NOT_FOUND",
  "INVALID_STATE",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "REQUEST_IN_PROGRESS",
  "QUALITY_BLOCKED",
  "QUOTA_EXCEEDED",
  "SUBMISSION_ACK_UNKNOWN",
  "ASSET_MISSING",
]);

function normalizeDispatchRetryable(
  code: CustomerApiErrorCode,
  value: unknown,
): boolean {
  return !dispatchNeverRetryCodes.has(code) && value === true;
}

function defaultDispatchRecoveryAction(
  code: CustomerApiErrorCode,
  retryable: boolean,
): CustomerRecoveryAction {
  switch (code) {
    case "AUTH_REQUIRED":
      return "sign_in";
    case "VALIDATION_FAILED":
    case "IDEMPOTENCY_KEY_REQUIRED":
    case "IDEMPOTENCY_CONFLICT":
    case "QUALITY_BLOCKED":
      return "fix_request";
    case "REQUEST_IN_PROGRESS":
    case "INVALID_STATE":
      return "refresh_status";
    case "QUOTA_EXCEEDED":
      return "view_usage";
    case "ASSET_MISSING":
      return "replace_asset";
    case "SERVICE_UNAVAILABLE":
      return retryable ? "wait" : "contact_support";
    case "FORBIDDEN":
    case "RESOURCE_NOT_FOUND":
    case "SUBMISSION_ACK_UNKNOWN":
      return "contact_support";
    default:
      return retryable ? "retry" : "contact_support";
  }
}

function normalizeDispatchRecoveryAction(
  _value: unknown,
  code: CustomerApiErrorCode,
  retryable: boolean,
): CustomerRecoveryAction {
  // Recovery behavior is derived from the machine code, not trusted from a
  // persisted legacy action. This prevents a stale replay from advertising a
  // retry that the route would reject or from sending the user to a dead path.
  return defaultDispatchRecoveryAction(code, retryable);
}

type DispatchErrorDetails = {
  blockers?: string[];
  resource?: string;
  used?: number;
  limit?: number;
  periodKey?: string;
};

type RetryableDispatchError = {
  code: Exclude<CustomerApiErrorCode, DispatchNeverRetryCode>;
  message: string;
  retryable: true;
  action: "retry" | "wait";
};

type NonRetryableDispatchError = {
  code: CustomerApiErrorCode;
  message: string;
  retryable: false;
  action: Exclude<CustomerRecoveryAction, "retry" | "wait">;
};

export type CustomerVideoDispatchErrorInput = DispatchErrorDetails &
  (RetryableDispatchError | NonRetryableDispatchError);

/**
 * Deliberately small customer contract for a dispatched VideoJob. Provider
 * identifiers, prompts, request keys, prices, leases, quarantine decisions and
 * raw failures are incident-response data and must never leave customer APIs.
 */
export interface CustomerVideoDispatchJob {
  id: string | null;
  status: string | null;
  segmentIndex: number | null;
  segmentDurationSec: number | null;
  outputVideoUrl: string | null;
  outputThumbUrl: string | null;
  lastProgress: number | null;
  retryCount: number | null;
  createdAt: string | null;
  submittedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  userSafeError: string | null;
  error: ReturnType<typeof classifyCustomerGenerationError>;
}

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Job asset URLs must use http(s)");

const customerVideoDispatchJobErrorSchema = z
  .object({
    code: z.enum(customerApiErrorCodes),
    message: z.string().min(1),
    retryable: z.boolean(),
    action: z.enum(customerRecoveryActions),
  })
  .strict()
  .nullable();

export const customerVideoDispatchJobSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    segmentIndex: z.number().int().nonnegative().nullable(),
    segmentDurationSec: z.number().positive().nullable(),
    outputVideoUrl: httpUrlSchema.nullable(),
    outputThumbUrl: httpUrlSchema.nullable(),
    lastProgress: z.number().min(0).max(100).nullable(),
    retryCount: z.number().int().nonnegative().nullable(),
    createdAt: z.string().datetime().nullable(),
    submittedAt: z.string().datetime().nullable(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
    userSafeError: z.string().nullable(),
    error: customerVideoDispatchJobErrorSchema,
  })
  .strict();

const customerVideoDispatchBatchItemSchema = z
  .object({
    briefId: z.string().min(1),
    deliveryOrderId: z.string().min(1),
  })
  .strict();

const customerVideoDispatchPlanPreviewSchema = z
  .object({
    summary: z.string().min(1),
    breakdown: z
      .object({
        aiClipCount: z.number().int().nonnegative(),
        uploadedClipCount: z.number().int().nonnegative(),
        hasBrandEndCard: z.boolean(),
        finalDurationSec: z.number().positive(),
        aspectRatio: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const customerVideoDispatchUserStatusSchema = z
  .object({
    status: z.enum(["planning", "generating", "assembling", "ready", "failed"]),
    label: z.string().min(1),
    shortLabel: z.string().min(1),
    progressHint: z.number().min(0).max(1),
    cta: z.string().nullable(),
    assemblingPhase: z.enum(["waiting", "active"]).nullable(),
  })
  .strict();

/**
 * A persisted success is trusted only when the complete customer contract is
 * present. This prevents a truncated JSON replay such as `{ ok: true }` from
 * being interpreted as a successful (and potentially billable) submission.
 */
export const customerVideoDispatchSuccessSchema = z
  .object({
    ok: z.literal(true),
    deliveryOrderId: z.string().min(1),
    briefId: z.string().min(1),
    videoJobs: z.array(customerVideoDispatchJobSchema).min(1),
    batch: z.array(customerVideoDispatchBatchItemSchema).min(1),
    planPreview: customerVideoDispatchPlanPreviewSchema,
    nextUrl: z.string().min(1),
    userStatus: customerVideoDispatchUserStatusSchema,
  })
  .strict();

export type CustomerVideoDispatchSuccess = z.infer<
  typeof customerVideoDispatchSuccessSchema
>;

export type CustomerVideoDispatchFailure = {
  ok: false;
  code: CustomerApiErrorCode;
  error: string;
  retryable: boolean;
  action: CustomerRecoveryAction;
  blockers?: string[];
  resource?: string | null;
  used?: number | null;
  limit?: number | null;
  periodKey?: string | null;
};

export type CustomerVideoDispatchResponse =
  | CustomerVideoDispatchSuccess
  | CustomerVideoDispatchFailure;

function httpUrlOrNull(value: unknown): string | null {
  const candidate = stringOrNull(value);
  if (candidate == null) return null;
  const parsed = httpUrlSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function toCustomerVideoDispatchJob(
  value: unknown,
): CustomerVideoDispatchJob {
  const job = asRecord(value);
  const status = stringOrNull(job.status);
  const userSafeError = stringOrNull(job.userSafeError);
  return {
    id: stringOrNull(job.id),
    status,
    segmentIndex: numberOrNull(job.segmentIndex),
    segmentDurationSec: numberOrNull(job.segmentDurationSec),
    outputVideoUrl: httpUrlOrNull(job.outputVideoUrl),
    outputThumbUrl: httpUrlOrNull(job.outputThumbUrl),
    lastProgress: numberOrNull(job.lastProgress),
    retryCount: numberOrNull(job.retryCount),
    createdAt: dateOrNull(job.createdAt),
    submittedAt: dateOrNull(job.submittedAt),
    startedAt: dateOrNull(job.startedAt),
    finishedAt: dateOrNull(job.finishedAt),
    userSafeError,
    error: classifyCustomerGenerationError({
      status: status ?? "",
      submissionState: stringOrNull(job.submissionState),
      submissionErrorClass: stringOrNull(job.submissionErrorClass),
      errorMessage: stringOrNull(job.errorMessage),
      userSafeError,
    }),
  };
}

function customerPlanPreview(value: unknown) {
  const preview = asRecord(value);
  const breakdown = asRecord(preview.breakdown);
  return {
    summary: stringOrNull(preview.summary),
    breakdown: {
      aiClipCount: numberOrNull(breakdown.aiClipCount),
      uploadedClipCount: numberOrNull(breakdown.uploadedClipCount),
      hasBrandEndCard:
        typeof breakdown.hasBrandEndCard === "boolean"
          ? breakdown.hasBrandEndCard
          : null,
      finalDurationSec: numberOrNull(breakdown.finalDurationSec),
      aspectRatio: stringOrNull(breakdown.aspectRatio),
    },
  };
}

function customerUserStatus(value: unknown) {
  const status = asRecord(value);
  return {
    status: stringOrNull(status.status),
    label: stringOrNull(status.label),
    shortLabel: stringOrNull(status.shortLabel),
    progressHint: numberOrNull(status.progressHint),
    cta: stringOrNull(status.cta),
    assemblingPhase: stringOrNull(status.assemblingPhase),
  };
}

function corruptedDispatchSuccessResponse(): CustomerVideoDispatchFailure {
  return {
    ok: false as const,
    code: "SUBMISSION_ACK_UNKNOWN" as const,
    error:
      "生成结果记录不完整。为避免重复计费，系统已停止重试，请联系支持核对。",
    retryable: false as const,
    action: "contact_support" as const,
  };
}

/**
 * One allowlist is used for both the first response and persisted idempotent
 * replay. This also scrubs legacy responseBody rows that may contain complete
 * Prisma VideoJob objects.
 */
export function toCustomerVideoDispatchResponse(
  body: unknown,
): CustomerVideoDispatchResponse {
  const response = asRecord(body);
  if (response.ok === true) {
    const candidate = {
      ok: true as const,
      deliveryOrderId: stringOrNull(response.deliveryOrderId),
      briefId: stringOrNull(response.briefId),
      videoJobs: Array.isArray(response.videoJobs)
        ? response.videoJobs.map(toCustomerVideoDispatchJob)
        : null,
      batch: Array.isArray(response.batch)
        ? response.batch.map((entry) => {
            const item = asRecord(entry);
            return {
              briefId: stringOrNull(item.briefId),
              deliveryOrderId: stringOrNull(item.deliveryOrderId),
            };
          })
        : null,
      planPreview: isRecord(response.planPreview)
        ? customerPlanPreview(response.planPreview)
        : null,
      nextUrl: stringOrNull(response.nextUrl),
      userStatus: isRecord(response.userStatus)
        ? customerUserStatus(response.userStatus)
        : null,
    };
    const parsed = customerVideoDispatchSuccessSchema.safeParse(candidate);
    return parsed.success ? parsed.data : corruptedDispatchSuccessResponse();
  }

  const blockers = Array.isArray(response.blockers)
    ? response.blockers.filter(
        (item): item is string => typeof item === "string",
      )
    : undefined;
  const code = normalizeDispatchErrorCode(response.code);
  const retryable = normalizeDispatchRetryable(code, response.retryable);
  const action = normalizeDispatchRecoveryAction(
    response.action,
    code,
    retryable,
  );
  return {
    ok: false as const,
    code,
    error:
      stringOrNull(response.error) ??
      "暂时无法开始生成视频，请稍后重试",
    retryable,
    action,
    ...(stringOrNull(response.resource)
      ? { resource: stringOrNull(response.resource) }
      : {}),
    ...(numberOrNull(response.used) != null
      ? { used: numberOrNull(response.used) }
      : {}),
    ...(numberOrNull(response.limit) != null
      ? { limit: numberOrNull(response.limit) }
      : {}),
    ...(stringOrNull(response.periodKey)
      ? { periodKey: stringOrNull(response.periodKey) }
      : {}),
    ...(blockers ? { blockers } : {}),
  };
}

/**
 * Typed construction path for every dispatch failure. The discriminated input
 * prevents a route from pairing `retryable: false` with a retry/wait action.
 */
export function toCustomerVideoDispatchError(
  args: CustomerVideoDispatchErrorInput,
): CustomerVideoDispatchFailure {
  const { blockers, resource, used, limit, periodKey, ...error } = args;
  const response = toCustomerVideoDispatchResponse({
    ...customerApiError(error),
    ...(blockers ? { blockers } : {}),
    ...(resource ? { resource } : {}),
    ...(used != null ? { used } : {}),
    ...(limit != null ? { limit } : {}),
    ...(periodKey ? { periodKey } : {}),
  });
  if (response.ok) {
    throw new Error("Dispatch error serializer produced a success envelope");
  }
  return response;
}
