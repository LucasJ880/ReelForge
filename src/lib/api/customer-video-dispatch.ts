import { classifyCustomerGenerationError } from "./customer-generation-error";

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
    outputVideoUrl: stringOrNull(job.outputVideoUrl),
    outputThumbUrl: stringOrNull(job.outputThumbUrl),
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
    summary: stringOrNull(preview.summary) ?? "",
    breakdown: {
      aiClipCount: numberOrNull(breakdown.aiClipCount) ?? 0,
      uploadedClipCount: numberOrNull(breakdown.uploadedClipCount) ?? 0,
      hasBrandEndCard: breakdown.hasBrandEndCard === true,
      finalDurationSec: numberOrNull(breakdown.finalDurationSec) ?? 0,
      aspectRatio: stringOrNull(breakdown.aspectRatio) ?? "9:16",
    },
  };
}

function customerUserStatus(value: unknown) {
  const status = asRecord(value);
  return {
    status: stringOrNull(status.status) ?? "planning",
    label: stringOrNull(status.label) ?? "正在准备您的视频",
    shortLabel: stringOrNull(status.shortLabel) ?? "筹备中",
    progressHint: numberOrNull(status.progressHint) ?? 0,
    cta: stringOrNull(status.cta),
    assemblingPhase: stringOrNull(status.assemblingPhase),
  };
}

/**
 * One allowlist is used for both the first response and persisted idempotent
 * replay. This also scrubs legacy responseBody rows that may contain complete
 * Prisma VideoJob objects.
 */
export function toCustomerVideoDispatchResponse(body: unknown) {
  const response = asRecord(body);
  if (response.ok === true) {
    return {
      ok: true as const,
      ...(typeof response.deliveryOrderId === "string"
        ? { deliveryOrderId: response.deliveryOrderId }
        : {}),
      ...(typeof response.briefId === "string"
        ? { briefId: response.briefId }
        : {}),
      ...(Array.isArray(response.videoJobs)
        ? { videoJobs: response.videoJobs.map(toCustomerVideoDispatchJob) }
        : {}),
      ...(Array.isArray(response.batch)
        ? {
            batch: response.batch.map((entry) => {
              const item = asRecord(entry);
              return {
                briefId: stringOrNull(item.briefId),
                deliveryOrderId: stringOrNull(item.deliveryOrderId),
              };
            }),
          }
        : {}),
      ...(isRecord(response.planPreview)
        ? { planPreview: customerPlanPreview(response.planPreview) }
        : {}),
      ...(typeof response.nextUrl === "string"
        ? { nextUrl: response.nextUrl }
        : {}),
      ...(isRecord(response.userStatus)
        ? { userStatus: customerUserStatus(response.userStatus) }
        : {}),
    };
  }

  const blockers = Array.isArray(response.blockers)
    ? response.blockers.filter(
        (item): item is string => typeof item === "string",
      )
    : undefined;
  return {
    ok: false as const,
    code: stringOrNull(response.code) ?? "INTERNAL_ERROR",
    error:
      stringOrNull(response.error) ??
      "暂时无法开始生成视频，请稍后重试",
    retryable: response.retryable === true,
    action: stringOrNull(response.action),
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
