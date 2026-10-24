-- 2026-10-25 可靠性 + 获客闭环：只加列 / 加表 / 加枚举值，不删不改。
-- 拿不到锁就快速失败，不在高峰排队阻塞线上查询。
SET lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'BOOKED', 'WON', 'LOST');

-- AlterEnum
ALTER TYPE "StoryboardRunStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "disabledReason" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "failuresAckedAt" TIMESTAMP(3),
ADD COLUMN     "leadPageConfig" JSONB,
ADD COLUMN     "leadPageEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicSlug" TEXT;

-- AlterTable
ALTER TABLE "VideoBrief" ADD COLUMN     "quotaRefundedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BatchJob" ADD COLUMN     "quotaRefundedAt" TIMESTAMP(3),
ADD COLUMN     "quotaRefundedCount" INTEGER,
ADD COLUMN     "tickLeaseOwner" TEXT,
ADD COLUMN     "tickLeaseUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VideoJob" ADD COLUMN     "frameQaCheckedAt" TIMESTAMP(3),
ADD COLUMN     "frameQaDetail" JSONB,
ADD COLUMN     "frameQaStatus" TEXT,
ADD COLUMN     "quotaRefundedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ContentPost" ADD COLUMN     "renderStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "trackedLinkId" TEXT,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "serviceInterest" TEXT,
    "preferredTime" TEXT,
    "message" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "selfReportedSource" TEXT,
    "dedupeKey" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "contactedAt" TIMESTAMP(3),
    "bookedAt" TIMESTAMP(3),
    "wonAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "consentAt" TIMESTAMP(3),
    "consentVersion" TEXT,
    "meta" JSONB,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "channel" TEXT,
    "destinationUrl" TEXT,
    "contentPostId" TEXT,
    "videoJobId" TEXT,
    "deliveryOrderId" TEXT,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkClick" (
    "id" TEXT NOT NULL,
    "trackedLinkId" TEXT NOT NULL,
    "referrerHost" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "uaFamily" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotApplication" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "email" TEXT,
    "whatsapp" TEXT,
    "wechat" TEXT,
    "externalRef" TEXT,
    "consentJson" JSONB,
    "notifiedAt" TIMESTAMP(3),
    "phone" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "city" TEXT,
    "monthlyLeadSpend" TEXT,
    "message" TEXT,
    "locale" TEXT,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_workspaceId_createdAt_idx" ON "Lead"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Lead_workspaceId_status_idx" ON "Lead"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_dedupeKey_idx" ON "Lead"("workspaceId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_code_key" ON "TrackedLink"("code");

-- CreateIndex
CREATE INDEX "TrackedLink_workspaceId_createdAt_idx" ON "TrackedLink"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LinkClick_trackedLinkId_createdAt_idx" ON "LinkClick"("trackedLinkId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PilotApplication_externalRef_key" ON "PilotApplication"("externalRef");

-- CreateIndex
CREATE INDEX "PilotApplication_createdAt_idx" ON "PilotApplication"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_publicSlug_key" ON "Workspace"("publicSlug");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_trackedLinkId_fkey" FOREIGN KEY ("trackedLinkId") REFERENCES "TrackedLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkClick" ADD CONSTRAINT "LinkClick_trackedLinkId_fkey" FOREIGN KEY ("trackedLinkId") REFERENCES "TrackedLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

