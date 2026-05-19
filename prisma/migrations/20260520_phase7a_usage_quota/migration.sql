-- Phase 7a: per-user monthly usage meters + rate limit buckets

CREATE TYPE "UsageResource" AS ENUM (
  'VIDEO_DISPATCH',
  'PLAN_PREVIEW',
  'BLOB_UPLOAD_BYTES',
  'SEEDANCE_SEGMENT'
);

CREATE TABLE "UserUsagePeriod" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "resource" "UsageResource" NOT NULL,
  "amount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserUsagePeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "resource" "UsageResource" NOT NULL,
  "amount" INTEGER NOT NULL DEFAULT 1,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RateLimitBucket" (
  "id" TEXT NOT NULL,
  "bucketKey" TEXT NOT NULL,
  "windowKey" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserUsagePeriod_userId_periodKey_resource_key" ON "UserUsagePeriod"("userId", "periodKey", "resource");
CREATE INDEX "UserUsagePeriod_userId_periodKey_idx" ON "UserUsagePeriod"("userId", "periodKey");

CREATE INDEX "UsageLog_userId_createdAt_idx" ON "UsageLog"("userId", "createdAt" DESC);
CREATE INDEX "UsageLog_resource_createdAt_idx" ON "UsageLog"("resource", "createdAt" DESC);

CREATE UNIQUE INDEX "RateLimitBucket_bucketKey_windowKey_key" ON "RateLimitBucket"("bucketKey", "windowKey");
CREATE INDEX "RateLimitBucket_bucketKey_idx" ON "RateLimitBucket"("bucketKey");

ALTER TABLE "UserUsagePeriod" ADD CONSTRAINT "UserUsagePeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
