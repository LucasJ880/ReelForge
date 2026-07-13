-- Phase 4 expand-only moderation report and reversible takedown support.
ALTER TABLE "VideoBrief"
  ADD COLUMN "takedownAt" TIMESTAMP(3),
  ADD COLUMN "takedownReason" TEXT,
  ADD COLUMN "takedownById" TEXT;

CREATE TYPE "ContentReportStatus" AS ENUM ('OPEN', 'REVIEWING', 'ACTIONED', 'DISMISSED');
CREATE TYPE "ContentReportReason" AS ENUM ('UNSAFE_CONTENT', 'IP_OR_BRAND', 'PRIVACY', 'MISLEADING', 'QUALITY_FAILURE', 'OTHER');

CREATE TABLE "ContentReport" (
  "id" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "targetBriefId" TEXT NOT NULL,
  "reason" "ContentReportReason" NOT NULL,
  "details" TEXT,
  "status" "ContentReportStatus" NOT NULL DEFAULT 'OPEN',
  "reviewedById" TEXT,
  "resolutionNote" TEXT,
  "actionedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentReport_status_createdAt_idx" ON "ContentReport"("status", "createdAt" DESC);
CREATE INDEX "ContentReport_reporterId_createdAt_idx" ON "ContentReport"("reporterId", "createdAt" DESC);
CREATE INDEX "ContentReport_targetBriefId_idx" ON "ContentReport"("targetBriefId");

ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
