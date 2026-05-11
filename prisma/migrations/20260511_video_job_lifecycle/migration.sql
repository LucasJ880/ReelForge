-- VideoJob lifecycle reconciliation fields
ALTER TABLE "VideoJob"
  ADD COLUMN IF NOT EXISTS "userSafeError" TEXT,
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastProviderStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "timeoutAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pollErrors" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "VideoJob_videoBriefId_idx" ON "VideoJob" ("videoBriefId");
