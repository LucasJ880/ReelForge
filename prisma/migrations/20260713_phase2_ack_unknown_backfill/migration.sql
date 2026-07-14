-- Historical rows without an external id are not replay-safe when a submit
-- attempt or submission timestamp proves that the provider call may have
-- started. Classify them conservatively before retry code is enabled.
UPDATE "VideoJob"
SET
  "submissionState" = 'ACK_UNKNOWN'::"ProviderSubmissionState",
  "submissionErrorClass" = COALESCE(
    "submissionErrorClass",
    'historical_submission_without_ack'
  )
WHERE "externalJobId" IS NULL
  AND "submissionState" = 'NOT_STARTED'::"ProviderSubmissionState"
  AND ("submitAttempts" > 0 OR "submittedAt" IS NOT NULL);
