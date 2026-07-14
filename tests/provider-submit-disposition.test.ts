import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderSubmissionError,
  asProviderSubmissionError,
  classifyProviderSubmissionDisposition,
  isProviderSubmissionError,
  shouldAutomaticallyRetrySubmission,
  unverifiedSubmissionCapabilities,
} from "../src/lib/video-generation/providers/submission-error";

test("submission disposition defaults timeout, 5xx, decode and persistence failures to acknowledgement_unknown", () => {
  const ambiguousEvidence = [
    { stage: "transport" as const, code: "ETIMEDOUT" },
    { stage: "provider_response" as const, httpStatus: 500 },
    { stage: "provider_response" as const, httpStatus: 503 },
    { stage: "response_decode" as const, httpStatus: 200 },
    { stage: "persistence" as const },
  ];

  for (const evidence of ambiguousEvidence) {
    assert.equal(
      classifyProviderSubmissionDisposition(evidence),
      "acknowledgement_unknown",
    );
  }
});

test("an undocumented 4xx is not guessed to mean that no provider job exists", () => {
  assert.equal(
    classifyProviderSubmissionDisposition({
      stage: "provider_response",
      httpStatus: 400,
    }),
    "acknowledgement_unknown",
  );
  assert.equal(
    classifyProviderSubmissionDisposition({
      stage: "provider_response",
      httpStatus: 429,
    }),
    "acknowledgement_unknown",
  );
});

test("positive no-create evidence is classified as definitely_not_created", () => {
  assert.equal(
    classifyProviderSubmissionDisposition({ stage: "preflight" }),
    "definitely_not_created",
  );
  assert.equal(
    classifyProviderSubmissionDisposition({
      stage: "transport",
      requestDefinitelyNotSent: true,
    }),
    "definitely_not_created",
  );
  assert.equal(
    classifyProviderSubmissionDisposition({
      stage: "provider_response",
      httpStatus: 422,
      code: "VALIDATION_ERROR",
      providerConfirmedNoJob: true,
    }),
    "definitely_not_created",
  );
});

test("only retryable definitely-not-created failures permit automatic resubmission", () => {
  const safeTransient = new ProviderSubmissionError("connection refused", {
    providerId: "buddy",
    stage: "transport",
    requestDefinitelyNotSent: true,
    retryable: true,
  });
  assert.equal(safeTransient.disposition, "definitely_not_created");
  assert.equal(shouldAutomaticallyRetrySubmission(safeTransient), true);

  const validationFailure = new ProviderSubmissionError("invalid duration", {
    providerId: "byteplus",
    stage: "provider_response",
    httpStatus: 422,
    code: "VALIDATION_ERROR",
    providerConfirmedNoJob: true,
    retryable: false,
  });
  assert.equal(validationFailure.disposition, "definitely_not_created");
  assert.equal(shouldAutomaticallyRetrySubmission(validationFailure), false);

  const ambiguousTimeout = new ProviderSubmissionError("request timeout", {
    providerId: "buddy",
    stage: "transport",
    retryable: true,
  });
  assert.equal(ambiguousTimeout.disposition, "acknowledgement_unknown");
  assert.equal(shouldAutomaticallyRetrySubmission(ambiguousTimeout), false);
});

test("unknown adapter errors are wrapped conservatively and preserve their cause", () => {
  const cause = new Error("socket closed after upload");
  const wrapped = asProviderSubmissionError({
    error: cause,
    providerId: "byteplus",
  });

  assert.equal(isProviderSubmissionError(wrapped), true);
  assert.equal(wrapped.disposition, "acknowledgement_unknown");
  assert.equal(wrapped.stage, "transport");
  assert.equal(wrapped.retryable, false);
  assert.equal(wrapped.cause, cause);
});

test("BytePlus and Buddy remain explicitly unverified until contract tests prove idempotency", () => {
  for (const providerId of ["byteplus", "buddy"]) {
    assert.deepEqual(unverifiedSubmissionCapabilities(providerId), {
      providerId,
      idempotencySupport: "unknown",
      acceptsClientRequestKey: false,
      canLookupByRequestKey: false,
    });
  }
});
