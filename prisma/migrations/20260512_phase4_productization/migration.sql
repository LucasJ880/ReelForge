-- =========================================================
-- Phase 4 Productization: 多段视频 + Logo 生成
-- =========================================================
-- 兼容性铁律：
--   * 所有新列对旧行使用默认值或 NULL（Sunny Shutter brief / VideoJob 不会受影响）。
--   * 旧的单段 VideoJob 行的 segmentIndex / finalVideoId 保持 NULL；
--     syncBriefStatus 据此走兼容旧逻辑分支。

-- 1. FinalVideoStatus enum
DO $$ BEGIN
  CREATE TYPE "FinalVideoStatus" AS ENUM ('PENDING', 'STITCHING', 'READY', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. FinalVideo 表
CREATE TABLE IF NOT EXISTS "FinalVideo" (
  "id"                TEXT PRIMARY KEY,
  "targetDurationSec" INTEGER NOT NULL,
  "segmentCount"      INTEGER NOT NULL,
  "status"            "FinalVideoStatus" NOT NULL DEFAULT 'PENDING',
  "stitchedVideoUrl"  TEXT,
  "thumbnailUrl"      TEXT,
  "ffmpegError"       TEXT,
  "stitchAttempts"    INTEGER NOT NULL DEFAULT 0,
  "startedAt"         TIMESTAMP(3),
  "finishedAt"        TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "FinalVideo_status_idx" ON "FinalVideo" ("status");

-- 3. LogoGeneration 表
CREATE TABLE IF NOT EXISTS "LogoGeneration" (
  "id"              TEXT PRIMARY KEY,
  "deliveryOrderId" TEXT NOT NULL,
  "prompt"          TEXT NOT NULL,
  "styleHint"       TEXT,
  "model"           TEXT NOT NULL,
  "generatedUrls"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "selectedUrl"     TEXT,
  "errorMessage"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LogoGeneration_deliveryOrderId_fkey"
    FOREIGN KEY ("deliveryOrderId")
    REFERENCES "DeliveryOrder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LogoGeneration_deliveryOrderId_idx" ON "LogoGeneration" ("deliveryOrderId");
CREATE INDEX IF NOT EXISTS "LogoGeneration_createdAt_idx" ON "LogoGeneration" ("createdAt" DESC);

-- 4. VideoBrief: targetDurationSec / directorPlan / finalVideoId
ALTER TABLE "VideoBrief"
  ADD COLUMN IF NOT EXISTS "targetDurationSec" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "directorPlan" JSONB,
  ADD COLUMN IF NOT EXISTS "finalVideoId" TEXT;

DO $$ BEGIN
  ALTER TABLE "VideoBrief"
    ADD CONSTRAINT "VideoBrief_finalVideoId_fkey"
    FOREIGN KEY ("finalVideoId") REFERENCES "FinalVideo"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "VideoBrief_finalVideoId_key" ON "VideoBrief" ("finalVideoId");
CREATE INDEX IF NOT EXISTS "VideoBrief_finalVideoId_idx" ON "VideoBrief" ("finalVideoId");

-- 5. VideoJob: segmentIndex / segmentDurationSec / finalVideoId
ALTER TABLE "VideoJob"
  ADD COLUMN IF NOT EXISTS "segmentIndex" INTEGER,
  ADD COLUMN IF NOT EXISTS "segmentDurationSec" INTEGER,
  ADD COLUMN IF NOT EXISTS "finalVideoId" TEXT;

DO $$ BEGIN
  ALTER TABLE "VideoJob"
    ADD CONSTRAINT "VideoJob_finalVideoId_fkey"
    FOREIGN KEY ("finalVideoId") REFERENCES "FinalVideo"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "VideoJob_finalVideoId_segmentIndex_idx" ON "VideoJob" ("finalVideoId", "segmentIndex");

-- 6. Backfill: 老 VideoBrief.targetDurationSec ← 既有 durationSec（若 >0）
UPDATE "VideoBrief"
   SET "targetDurationSec" = "durationSec"
 WHERE "targetDurationSec" = 30
   AND "durationSec" IS NOT NULL
   AND "durationSec" > 0;
