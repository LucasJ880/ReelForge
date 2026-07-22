-- Add an immutable attempt ledger without changing the existing task/result
-- cardinality. Task columns remain the current-attempt summary for compatibility.
CREATE TABLE "ProductImageProviderAttempt" (
    "id" TEXT NOT NULL,
    "providerTaskId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "requestKey" TEXT NOT NULL,
    "externalTaskId" TEXT,
    "submissionState" "ProviderSubmissionState" NOT NULL DEFAULT 'SUBMITTING',
    "status" "ProductImageStatus" NOT NULL DEFAULT 'PROCESSING',
    "provider" TEXT NOT NULL DEFAULT 'shuyu',
    "planId" TEXT,
    "modelSnapshot" TEXT,
    "resolutionSnapshot" TEXT,
    "pointsSnapshot" INTEGER,
    "lastProviderStatus" TEXT,
    "pollErrors" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductImageProviderAttempt_pkey" PRIMARY KEY ("id")
);

-- Existing installations can only preserve the currently visible correlation;
-- future attempts are inserted before every paid submission and never overwrite it.
INSERT INTO "ProductImageProviderAttempt" (
    "id",
    "providerTaskId",
    "attemptNumber",
    "requestKey",
    "externalTaskId",
    "submissionState",
    "status",
    "provider",
    "planId",
    "modelSnapshot",
    "resolutionSnapshot",
    "pointsSnapshot",
    "lastProviderStatus",
    "pollErrors",
    "submittedAt",
    "acknowledgedAt",
    "lastCheckedAt",
    "completedAt",
    "errorCode",
    "errorMessage",
    "createdAt",
    "updatedAt"
)
SELECT
    'backfill-' || "id",
    "id",
    GREATEST("submitAttempts", 1),
    "requestKey",
    "externalTaskId",
    "submissionState",
    "status",
    "provider",
    "planId",
    "modelSnapshot",
    "resolutionSnapshot",
    "pointsSnapshot",
    "lastProviderStatus",
    "pollErrors",
    COALESCE("submittedAt", "createdAt"),
    CASE WHEN "externalTaskId" IS NOT NULL THEN COALESCE("lastCheckedAt", "updatedAt") ELSE NULL END,
    "lastCheckedAt",
    "completedAt",
    "errorCode",
    "errorMessage",
    "createdAt",
    "updatedAt"
FROM "ProductImageProviderTask"
WHERE "submitAttempts" > 0 OR "submittedAt" IS NOT NULL OR "externalTaskId" IS NOT NULL;

CREATE UNIQUE INDEX "ProductImageProviderAttempt_externalTaskId_key"
ON "ProductImageProviderAttempt"("externalTaskId");

CREATE UNIQUE INDEX "ProductImageProviderAttempt_providerTaskId_attemptNumber_key"
ON "ProductImageProviderAttempt"("providerTaskId", "attemptNumber");

CREATE INDEX "ProductImageProviderAttempt_requestKey_idx"
ON "ProductImageProviderAttempt"("requestKey");

CREATE INDEX "ProductImageProviderAttempt_submissionState_status_idx"
ON "ProductImageProviderAttempt"("submissionState", "status");

CREATE INDEX "ProductImageProviderAttempt_providerTaskId_createdAt_idx"
ON "ProductImageProviderAttempt"("providerTaskId", "createdAt");

ALTER TABLE "ProductImageProviderAttempt"
ADD CONSTRAINT "ProductImageProviderAttempt_providerTaskId_fkey"
FOREIGN KEY ("providerTaskId") REFERENCES "ProductImageProviderTask"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
