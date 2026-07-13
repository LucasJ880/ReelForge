-- Phase 1 expand-only migration: historical dispatch quarantine audit fields.
-- Rollback (before any human decision is recorded): drop the two indexes, then
-- drop these nullable columns. Once decisions exist, export them before rollback.

ALTER TABLE "BatchJob"
  ADD COLUMN "dispatchQuarantineDecision" TEXT,
  ADD COLUMN "dispatchQuarantineAt" TIMESTAMP(3),
  ADD COLUMN "dispatchQuarantineBy" TEXT;

ALTER TABLE "VideoJob"
  ADD COLUMN "dispatchQuarantineDecision" TEXT,
  ADD COLUMN "dispatchQuarantineAt" TIMESTAMP(3),
  ADD COLUMN "dispatchQuarantineBy" TEXT;

CREATE INDEX "BatchJob_status_createdAt_dispatchQuarantineDecision_idx"
  ON "BatchJob"("status", "createdAt", "dispatchQuarantineDecision");

CREATE INDEX "VideoJob_status_createdAt_dispatchQuarantineDecision_idx"
  ON "VideoJob"("status", "createdAt", "dispatchQuarantineDecision");

ALTER TABLE "BatchJob"
  ADD CONSTRAINT "BatchJob_dispatchQuarantineDecision_check"
  CHECK ("dispatchQuarantineDecision" IS NULL OR "dispatchQuarantineDecision" IN ('RELEASED', 'EXPIRED'));

ALTER TABLE "VideoJob"
  ADD CONSTRAINT "VideoJob_dispatchQuarantineDecision_check"
  CHECK ("dispatchQuarantineDecision" IS NULL OR "dispatchQuarantineDecision" IN ('RELEASED', 'EXPIRED'));
