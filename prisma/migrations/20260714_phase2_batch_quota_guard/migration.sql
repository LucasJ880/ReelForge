-- Expand-only dispatch authorization guard. Existing batches predate the
-- guard and are treated as already authorized; new batches remain EXPANDING
-- until quota authorization and activation commit atomically.
ALTER TABLE "BatchJob"
ADD COLUMN "requestHash" TEXT,
ADD COLUMN "quotaConsumedAt" TIMESTAMP(3);

UPDATE "BatchJob"
SET "quotaConsumedAt" = "createdAt"
WHERE "quotaConsumedAt" IS NULL;

CREATE INDEX "BatchJob_status_quotaConsumedAt_createdAt_idx"
ON "BatchJob"("status", "quotaConsumedAt", "createdAt");
