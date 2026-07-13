ALTER TYPE "VideoProvider" ADD VALUE IF NOT EXISTS 'MOCK';
ALTER TYPE "VideoJobStatus" ADD VALUE IF NOT EXISTS 'PAUSED' BEFORE 'RUNNING';

CREATE TYPE "BatchJobStatus" AS ENUM (
  'EXPANDING',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'PARTIAL_FAILED',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "BatchJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "templateVersion" INTEGER NOT NULL,
  "imageIds" TEXT[],
  "imageUrls" TEXT[],
  "productName" TEXT,
  "requestedCount" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "BatchJobStatus" NOT NULL DEFAULT 'EXPANDING',
  "queuedCount" INTEGER NOT NULL DEFAULT 0,
  "pausedCount" INTEGER NOT NULL DEFAULT 0,
  "runningCount" INTEGER NOT NULL DEFAULT 0,
  "completedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "cancelledCount" INTEGER NOT NULL DEFAULT 0,
  "statusReason" TEXT,
  "breakerPausedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BatchJob_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "VideoJob" ALTER COLUMN "videoBriefId" DROP NOT NULL;
ALTER TABLE "VideoJob"
  ADD COLUMN "batchJobId" TEXT,
  ADD COLUMN "batchIndex" INTEGER,
  ADD COLUMN "batchItemKey" TEXT,
  ADD COLUMN "assignedAssets" JSONB,
  ADD COLUMN "templateSnapshot" JSONB,
  ADD COLUMN "promptText" TEXT,
  ADD COLUMN "negativePrompt" TEXT,
  ADD COLUMN "seed" INTEGER,
  ADD COLUMN "submitAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "availableAt" TIMESTAMP(3),
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "heartbeatAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "BatchJob_userId_idempotencyKey_key"
  ON "BatchJob"("userId", "idempotencyKey");
CREATE INDEX "BatchJob_userId_createdAt_idx"
  ON "BatchJob"("userId", "createdAt" DESC);
CREATE INDEX "BatchJob_status_createdAt_idx"
  ON "BatchJob"("status", "createdAt");
CREATE UNIQUE INDEX "VideoJob_batchItemKey_key"
  ON "VideoJob"("batchItemKey");
CREATE INDEX "VideoJob_batchJobId_status_batchIndex_idx"
  ON "VideoJob"("batchJobId", "status", "batchIndex");
CREATE INDEX "VideoJob_status_availableAt_idx"
  ON "VideoJob"("status", "availableAt");

ALTER TABLE "BatchJob"
  ADD CONSTRAINT "BatchJob_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AdminUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BatchJob"
  ADD CONSTRAINT "BatchJob_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "StyleTemplate"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VideoJob"
  ADD CONSTRAINT "VideoJob_batchJobId_fkey"
  FOREIGN KEY ("batchJobId") REFERENCES "BatchJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
