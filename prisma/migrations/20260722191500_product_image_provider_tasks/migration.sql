-- Add one durable provider task per requested product-image result. This is an
-- expand-only follow-up to 20260722191000_shuyu_image_jobs.
CREATE TABLE "ProductImageProviderTask" (
    "id" TEXT NOT NULL,
    "productImageJobId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "requestKey" TEXT NOT NULL,
    "externalTaskId" TEXT,
    "submissionState" "ProviderSubmissionState" NOT NULL DEFAULT 'NOT_STARTED',
    "status" "ProductImageStatus" NOT NULL DEFAULT 'QUEUED',
    "submitAttempts" INTEGER NOT NULL DEFAULT 0,
    "submissionErrorClass" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'shuyu',
    "planId" TEXT,
    "modelSnapshot" TEXT,
    "resolutionSnapshot" TEXT,
    "pointsSnapshot" INTEGER,
    "finalPoints" INTEGER,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastProviderStatus" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "pollErrors" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImageProviderTask_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProductImageResult" ADD COLUMN "providerTaskId" TEXT;

-- Preserve the owned primary output of jobs created before ProductImageResult
-- existed or before the first reconciliation write completed.
INSERT INTO "ProductImageResult" (
    "id", "productImageJobId", "assetId", "position", "outputImageUrl", "createdAt"
)
SELECT
    'legacy-result-' || job."id",
    job."id",
    job."outputAssetId",
    0,
    COALESCE(job."outputImageUrl", asset."url"),
    COALESCE(job."completedAt", job."updatedAt", job."createdAt")
FROM "ProductImageJob" job
JOIN "MediaAsset" asset ON asset."id" = job."outputAssetId"
WHERE job."outputAssetId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ProductImageResult" result
    WHERE result."assetId" = job."outputAssetId"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ProductImageResult" result
    WHERE result."productImageJobId" = job."id" AND result."position" = 0
  );

-- Historical provider correlation is retained on ordinal zero. Missing
-- ordinals fail closed instead of creating new paid work during backfill.
INSERT INTO "ProductImageProviderTask" (
    "id", "productImageJobId", "ordinal", "requestKey", "externalTaskId",
    "submissionState", "status", "submitAttempts", "provider", "planId",
    "modelSnapshot", "resolutionSnapshot", "pointsSnapshot", "finalPoints",
    "lastProviderStatus", "lastCheckedAt", "pollErrors", "submittedAt",
    "completedAt", "errorCode", "errorMessage", "createdAt", "updatedAt"
)
SELECT
    'legacy-provider-task-' || job."id" || '-' || ordinal.value,
    job."id",
    ordinal.value,
    CASE WHEN ordinal.value = 0 AND job."providerRequestKey" IS NOT NULL
      THEN job."providerRequestKey"
      ELSE 'legacy-product-image-' || job."id" || '-' || ordinal.value
    END,
    CASE WHEN ordinal.value = 0 THEN job."externalTaskId" ELSE NULL END,
    CASE
      WHEN ordinal.value = 0 AND job."externalTaskId" IS NOT NULL THEN 'ACCEPTED'::"ProviderSubmissionState"
      WHEN job."status" = 'QUEUED' THEN 'NOT_STARTED'::"ProviderSubmissionState"
      ELSE 'ACK_UNKNOWN'::"ProviderSubmissionState"
    END,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM "ProductImageResult" result
        WHERE result."productImageJobId" = job."id" AND result."position" = ordinal.value
      ) THEN 'SUCCEEDED'::"ProductImageStatus"
      WHEN ordinal.value = 0 AND job."status" = 'PROCESSING' AND job."externalTaskId" IS NOT NULL
        THEN 'PROCESSING'::"ProductImageStatus"
      WHEN job."status" = 'QUEUED' THEN 'QUEUED'::"ProductImageStatus"
      ELSE 'FAILED'::"ProductImageStatus"
    END,
    CASE WHEN ordinal.value = 0 AND job."providerRequestKey" IS NOT NULL THEN 1 ELSE 0 END,
    COALESCE(job."provider", 'historical'),
    job."planId", job."modelSnapshot", job."resolutionSnapshot",
    job."pointsSnapshot", job."finalPoints", job."lastProviderStatus",
    job."lastCheckedAt", job."pollErrors", job."startedAt", job."completedAt",
    CASE WHEN job."status" = 'FAILED' THEN COALESCE(job."errorCode", 'HISTORICAL_FAILURE') ELSE NULL END,
    CASE WHEN job."status" = 'FAILED' THEN job."errorMessage" ELSE NULL END,
    job."createdAt", job."updatedAt"
FROM "ProductImageJob" job
CROSS JOIN LATERAL generate_series(0, GREATEST(job."resultCount", 1) - 1) AS ordinal(value);

UPDATE "ProductImageResult" result
SET "providerTaskId" = task."id"
FROM "ProductImageProviderTask" task
WHERE task."productImageJobId" = result."productImageJobId"
  AND task."ordinal" = result."position";

CREATE UNIQUE INDEX "ProductImageProviderTask_requestKey_key" ON "ProductImageProviderTask"("requestKey");
CREATE UNIQUE INDEX "ProductImageProviderTask_externalTaskId_key" ON "ProductImageProviderTask"("externalTaskId");
CREATE UNIQUE INDEX "ProductImageProviderTask_productImageJobId_ordinal_key" ON "ProductImageProviderTask"("productImageJobId", "ordinal");
CREATE INDEX "ProductImageProviderTask_status_availableAt_idx" ON "ProductImageProviderTask"("status", "availableAt");
CREATE INDEX "ProductImageProviderTask_status_leaseExpiresAt_idx" ON "ProductImageProviderTask"("status", "leaseExpiresAt");
CREATE INDEX "ProductImageProviderTask_productImageJobId_status_idx" ON "ProductImageProviderTask"("productImageJobId", "status");
CREATE UNIQUE INDEX "ProductImageResult_providerTaskId_key" ON "ProductImageResult"("providerTaskId");

ALTER TABLE "ProductImageProviderTask"
ADD CONSTRAINT "ProductImageProviderTask_productImageJobId_fkey"
FOREIGN KEY ("productImageJobId") REFERENCES "ProductImageJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductImageResult"
ADD CONSTRAINT "ProductImageResult_providerTaskId_fkey"
FOREIGN KEY ("providerTaskId") REFERENCES "ProductImageProviderTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
