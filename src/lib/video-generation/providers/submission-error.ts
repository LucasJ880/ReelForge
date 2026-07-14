/**
 * Billing-safe classification for provider submission failures.
 *
 * A caller may automatically submit again only when it has positive evidence
 * that the previous attempt did not create provider-side billable work.
 * Message matching is intentionally not used: a timeout, 5xx, malformed
 * success response, or local persistence failure can all happen after a
 * provider has accepted the request.
 */

export type ProviderSubmissionDisposition =
  | "definitely_not_created"
  | "acknowledgement_unknown";

export type ProviderIdempotencySupport =
  | "verified"
  | "unsupported"
  | "unknown";

export interface ProviderSubmissionCapabilities {
  providerId: string;
  /**
   * `verified` requires a tested provider contract, not merely a header name
   * appearing in documentation.
   */
  idempotencySupport: ProviderIdempotencySupport;
  /** Provider accepts a client-generated request key on create. */
  acceptsClientRequestKey: boolean;
  /** Provider can recover a job by that key after an acknowledgement loss. */
  canLookupByRequestKey: boolean;
}

export type ProviderSubmissionFailureStage =
  | "preflight"
  | "transport"
  | "provider_response"
  | "response_decode"
  | "persistence";

export interface ProviderSubmissionEvidence {
  stage: ProviderSubmissionFailureStage;
  httpStatus?: number;
  code?: string;
  /**
   * Set only when the transport can prove no request bytes were sent. A
   * generic `fetch` TypeError is not sufficient evidence.
   */
  requestDefinitelyNotSent?: boolean;
  /**
   * Set only for a provider error code whose contract explicitly guarantees
   * that no task was created and no generation charge can occur.
   */
  providerConfirmedNoJob?: boolean;
  /** Whether retrying the same logical attempt can succeed without user edits. */
  retryable?: boolean;
}

export interface ProviderSubmissionErrorOptions
  extends ProviderSubmissionEvidence {
  providerId: string;
  cause?: unknown;
}

export class ProviderSubmissionError extends Error {
  readonly providerId: string;
  readonly disposition: ProviderSubmissionDisposition;
  readonly stage: ProviderSubmissionFailureStage;
  readonly httpStatus?: number;
  readonly code?: string;
  readonly retryable: boolean;

  constructor(message: string, options: ProviderSubmissionErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "ProviderSubmissionError";
    this.providerId = options.providerId;
    this.disposition = classifyProviderSubmissionDisposition(options);
    this.stage = options.stage;
    this.httpStatus = options.httpStatus;
    this.code = options.code;
    this.retryable = options.retryable === true;
  }
}

/**
 * Conservative classifier shared by BytePlus, Buddy, and future adapters.
 * Unknown or incomplete evidence always fails closed.
 */
export function classifyProviderSubmissionDisposition(
  evidence: ProviderSubmissionEvidence,
): ProviderSubmissionDisposition {
  if (evidence.stage === "preflight") {
    return "definitely_not_created";
  }
  if (evidence.requestDefinitelyNotSent === true) {
    return "definitely_not_created";
  }
  if (
    evidence.stage === "provider_response" &&
    evidence.providerConfirmedNoJob === true
  ) {
    return "definitely_not_created";
  }
  return "acknowledgement_unknown";
}

export function isProviderSubmissionError(
  error: unknown,
): error is ProviderSubmissionError {
  return error instanceof ProviderSubmissionError;
}

/**
 * Wrap unknown adapter failures without inventing certainty. Callers may pass
 * stronger evidence only when it comes from a verified local/provider
 * contract.
 */
export function asProviderSubmissionError(args: {
  error: unknown;
  providerId: string;
  evidence?: ProviderSubmissionEvidence;
}): ProviderSubmissionError {
  if (isProviderSubmissionError(args.error)) return args.error;

  const message =
    args.error instanceof Error
      ? args.error.message
      : "Video provider submission failed";
  const evidence = args.evidence ?? { stage: "transport" as const };
  return new ProviderSubmissionError(message, {
    ...evidence,
    providerId: args.providerId,
    cause: args.error,
  });
}

/**
 * Current policy deliberately does not auto-replay acknowledgement-unknown
 * attempts, even if a future provider advertises idempotency. Such replay is
 * unlocked only after its contract and lookup behavior have dedicated tests.
 */
export function shouldAutomaticallyRetrySubmission(
  error: ProviderSubmissionError,
): boolean {
  return (
    error.disposition === "definitely_not_created" && error.retryable === true
  );
}

/** Safe default for BytePlus/Buddy until their create-idempotency contract is verified. */
export function unverifiedSubmissionCapabilities(
  providerId: string,
): ProviderSubmissionCapabilities {
  return {
    providerId,
    idempotencySupport: "unknown",
    acceptsClientRequestKey: false,
    canLookupByRequestKey: false,
  };
}

