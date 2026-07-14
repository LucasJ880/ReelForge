-- Billing-safe provider submission state and request-level dispatch idempotency.
CREATE TYPE "ProviderSubmissionState" AS ENUM (
  'NOT_STARTED',
  'SUBMITTING',
  'ACCEPTED',
  'REJECTED',
  'ACK_UNKNOWN'
);

CREATE TYPE "VideoDispatchRequestState" AS ENUM (
  'PROCESSING',
  'COMPLETED',
  'FAILED'
);

ALTER TABLE "VideoJob"
  ADD COLUMN "logicalJobKey" TEXT,
  ADD COLUMN "providerRequestKey" TEXT,
  ADD COLUMN "submissionState" "ProviderSubmissionState" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "submissionErrorClass" TEXT,
  ADD COLUMN "providerUnitPriceUsd" DECIMAL(12,6);

-- Historical rows are classified conservatively. A running row without an
-- external id may already have reached the provider and therefore cannot be
-- treated as safe to replay.
UPDATE "VideoJob"
SET "submissionState" = CASE
  WHEN "externalJobId" IS NOT NULL THEN 'ACCEPTED'::"ProviderSubmissionState"
  WHEN "status" = 'RUNNING' THEN 'ACK_UNKNOWN'::"ProviderSubmissionState"
  ELSE 'NOT_STARTED'::"ProviderSubmissionState"
END;

CREATE UNIQUE INDEX "VideoJob_logicalJobKey_key"
  ON "VideoJob"("logicalJobKey");
CREATE UNIQUE INDEX "VideoJob_providerRequestKey_key"
  ON "VideoJob"("providerRequestKey");

CREATE TABLE "VideoDispatchRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "state" "VideoDispatchRequestState" NOT NULL DEFAULT 'PROCESSING',
  "responseStatus" INTEGER,
  "responseBody" JSONB,
  "quotaConsumedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VideoDispatchRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VideoDispatchRequest_userId_idempotencyKey_key"
  ON "VideoDispatchRequest"("userId", "idempotencyKey");
CREATE INDEX "VideoDispatchRequest_state_createdAt_idx"
  ON "VideoDispatchRequest"("state", "createdAt");

ALTER TABLE "VideoDispatchRequest"
  ADD CONSTRAINT "VideoDispatchRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AdminUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
