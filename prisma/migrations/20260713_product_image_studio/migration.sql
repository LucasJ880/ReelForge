-- Product Image Studio: audited GPT Image generation/editing jobs.
CREATE TYPE "ProductImageMode" AS ENUM ('GENERATE', 'OPTIMIZE');
CREATE TYPE "ProductImageStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "ProductImageJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "mode" "ProductImageMode" NOT NULL,
  "status" "ProductImageStatus" NOT NULL DEFAULT 'QUEUED',
  "prompt" TEXT NOT NULL,
  "preset" TEXT NOT NULL,
  "aspectRatio" TEXT NOT NULL,
  "quality" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "sourceImageUrl" TEXT,
  "sourceMimeType" TEXT,
  "outputImageUrl" TEXT,
  "fromMock" BOOLEAN NOT NULL DEFAULT false,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductImageJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductImageJob_userId_idempotencyKey_key"
  ON "ProductImageJob"("userId", "idempotencyKey");
CREATE INDEX "ProductImageJob_userId_createdAt_idx"
  ON "ProductImageJob"("userId", "createdAt" DESC);
CREATE INDEX "ProductImageJob_status_createdAt_idx"
  ON "ProductImageJob"("status", "createdAt");

ALTER TABLE "ProductImageJob"
  ADD CONSTRAINT "ProductImageJob_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AdminUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
