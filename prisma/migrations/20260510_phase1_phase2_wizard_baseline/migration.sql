-- CreateEnum
CREATE TYPE "CreativeEvidenceStatus" AS ENUM ('DRAFT', 'REVIEWED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssetQAStatus" AS ENUM ('PENDING', 'USABLE', 'BARELY_USABLE', 'RETAKE_RECOMMENDED', 'MISSING_SHOT');

-- CreateEnum
CREATE TYPE "AIUsageStatus" AS ENUM ('SUCCESS', 'FAILED', 'MOCK');

-- CreateEnum
CREATE TYPE "WizardRenderJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'DRAFT_READY', 'MOCK', 'FAILED');

-- CreateEnum
CREATE TYPE "WizardRenderJobMode" AS ENUM ('REAL', 'DRAFT', 'MOCK');

-- AlterEnum
ALTER TYPE "RealFootageDemoLeadStatus" ADD VALUE 'TEST';

-- AlterTable
ALTER TABLE "DeliveryOrder" ADD COLUMN     "clientBrief" JSONB,
ADD COLUMN     "selectedCreativeCardId" TEXT;

-- AlterTable
ALTER TABLE "RawAsset" ADD COLUMN     "assetRole" TEXT,
ADD COLUMN     "matchedShotId" TEXT,
ADD COLUMN     "qaResult" JSONB,
ADD COLUMN     "qaStatus" "AssetQAStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "RealFootageDemoLead" ADD COLUMN     "hiddenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ScenePlan" ADD COLUMN     "humanRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiredFlag" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "shootingGuide" JSONB;

-- CreateTable
CREATE TABLE "CreativeEvidenceCard" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "sourcePlatform" TEXT,
    "referenceUrl" TEXT,
    "thumbnailUrl" TEXT,
    "publicMetricsJson" JSONB,
    "hookPattern" JSONB,
    "structureBreakdownJson" JSONB,
    "whyItWorks" TEXT,
    "visualStyle" TEXT,
    "suggestedUseCase" TEXT,
    "riskNotes" TEXT,
    "recommendationScore" INTEGER,
    "clientPreviewSummary" TEXT,
    "status" "CreativeEvidenceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeEvidenceCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIUsageLog" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "model" TEXT,
    "deliveryOrderId" TEXT,
    "creativeCardId" TEXT,
    "actorUserId" TEXT,
    "inputSummary" TEXT,
    "outputSummary" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "costEstimateUsd" DOUBLE PRECISION,
    "promptVersion" TEXT,
    "status" "AIUsageStatus" NOT NULL DEFAULT 'SUCCESS',
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WizardRenderJob" (
    "id" TEXT NOT NULL,
    "deliveryOrderId" TEXT NOT NULL,
    "status" "WizardRenderJobStatus" NOT NULL DEFAULT 'QUEUED',
    "mode" "WizardRenderJobMode" NOT NULL DEFAULT 'DRAFT',
    "aspectRatio" TEXT NOT NULL DEFAULT '9:16',
    "durationSec" INTEGER NOT NULL DEFAULT 30,
    "timeline" JSONB NOT NULL,
    "briefSnapshot" JSONB,
    "outputVideoUrl" TEXT,
    "outputThumbnailUrl" TEXT,
    "manifestUrl" TEXT,
    "fallbackReason" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WizardRenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreativeEvidenceCard_slug_key" ON "CreativeEvidenceCard"("slug");

-- CreateIndex
CREATE INDEX "CreativeEvidenceCard_industry_idx" ON "CreativeEvidenceCard"("industry");

-- CreateIndex
CREATE INDEX "CreativeEvidenceCard_platform_idx" ON "CreativeEvidenceCard"("platform");

-- CreateIndex
CREATE INDEX "CreativeEvidenceCard_objective_idx" ON "CreativeEvidenceCard"("objective");

-- CreateIndex
CREATE INDEX "CreativeEvidenceCard_status_idx" ON "CreativeEvidenceCard"("status");

-- CreateIndex
CREATE INDEX "CreativeEvidenceCard_recommendationScore_idx" ON "CreativeEvidenceCard"("recommendationScore" DESC);

-- CreateIndex
CREATE INDEX "AIUsageLog_feature_idx" ON "AIUsageLog"("feature");

-- CreateIndex
CREATE INDEX "AIUsageLog_provider_idx" ON "AIUsageLog"("provider");

-- CreateIndex
CREATE INDEX "AIUsageLog_deliveryOrderId_idx" ON "AIUsageLog"("deliveryOrderId");

-- CreateIndex
CREATE INDEX "AIUsageLog_creativeCardId_idx" ON "AIUsageLog"("creativeCardId");

-- CreateIndex
CREATE INDEX "AIUsageLog_status_idx" ON "AIUsageLog"("status");

-- CreateIndex
CREATE INDEX "AIUsageLog_createdAt_idx" ON "AIUsageLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "WizardRenderJob_deliveryOrderId_idx" ON "WizardRenderJob"("deliveryOrderId");

-- CreateIndex
CREATE INDEX "WizardRenderJob_status_idx" ON "WizardRenderJob"("status");

-- CreateIndex
CREATE INDEX "WizardRenderJob_mode_idx" ON "WizardRenderJob"("mode");

-- CreateIndex
CREATE INDEX "WizardRenderJob_createdAt_idx" ON "WizardRenderJob"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "DeliveryOrder_selectedCreativeCardId_idx" ON "DeliveryOrder"("selectedCreativeCardId");

-- CreateIndex
CREATE INDEX "RawAsset_qaStatus_idx" ON "RawAsset"("qaStatus");

-- CreateIndex
CREATE INDEX "RawAsset_matchedShotId_idx" ON "RawAsset"("matchedShotId");

-- CreateIndex
CREATE INDEX "RealFootageDemoLead_hiddenAt_idx" ON "RealFootageDemoLead"("hiddenAt");

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_selectedCreativeCardId_fkey" FOREIGN KEY ("selectedCreativeCardId") REFERENCES "CreativeEvidenceCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawAsset" ADD CONSTRAINT "RawAsset_matchedShotId_fkey" FOREIGN KEY ("matchedShotId") REFERENCES "ScenePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsageLog" ADD CONSTRAINT "AIUsageLog_deliveryOrderId_fkey" FOREIGN KEY ("deliveryOrderId") REFERENCES "DeliveryOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WizardRenderJob" ADD CONSTRAINT "WizardRenderJob_deliveryOrderId_fkey" FOREIGN KEY ("deliveryOrderId") REFERENCES "DeliveryOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

