CREATE TYPE "StoryboardApprovalPolicy" AS ENUM ('MANUAL', 'AUTO');
CREATE TYPE "StoryboardRunStatus" AS ENUM ('GENERATING', 'AWAITING_APPROVAL', 'APPROVED', 'FAILED');
CREATE TYPE "StoryboardFrameStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "StoryboardRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "approvalPolicy" "StoryboardApprovalPolicy" NOT NULL,
    "status" "StoryboardRunStatus" NOT NULL DEFAULT 'GENERATING',
    "durationSec" INTEGER NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "sourcePrompt" TEXT NOT NULL,
    "inputAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inputImageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "videoBriefId" TEXT,
    "videoJobId" TEXT,
    "dispatchReservationKey" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoryboardRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoryboardFrame" (
    "id" TEXT NOT NULL,
    "storyboardRunId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "beat" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" "StoryboardFrameStatus" NOT NULL DEFAULT 'QUEUED',
    "providerRequestKey" TEXT NOT NULL,
    "externalTaskId" TEXT,
    "submissionState" "ProviderSubmissionState" NOT NULL DEFAULT 'NOT_STARTED',
    "provider" TEXT NOT NULL DEFAULT 'shuyu',
    "planId" TEXT,
    "modelSnapshot" TEXT,
    "resolutionSnapshot" TEXT,
    "pointsSnapshot" INTEGER,
    "outputUrl" TEXT,
    "outputAssetId" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3),
    "lastProviderStatus" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "pollErrors" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoryboardFrame_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoryboardRun_videoBriefId_key" ON "StoryboardRun"("videoBriefId");
CREATE UNIQUE INDEX "StoryboardRun_videoJobId_key" ON "StoryboardRun"("videoJobId");
CREATE UNIQUE INDEX "StoryboardRun_dispatchReservationKey_key" ON "StoryboardRun"("dispatchReservationKey");
CREATE UNIQUE INDEX "StoryboardRun_userId_idempotencyKey_key" ON "StoryboardRun"("userId", "idempotencyKey");
CREATE INDEX "StoryboardRun_userId_createdAt_idx" ON "StoryboardRun"("userId", "createdAt" DESC);
CREATE INDEX "StoryboardRun_status_updatedAt_idx" ON "StoryboardRun"("status", "updatedAt");

CREATE UNIQUE INDEX "StoryboardFrame_providerRequestKey_key" ON "StoryboardFrame"("providerRequestKey");
CREATE UNIQUE INDEX "StoryboardFrame_externalTaskId_key" ON "StoryboardFrame"("externalTaskId");
CREATE UNIQUE INDEX "StoryboardFrame_outputAssetId_key" ON "StoryboardFrame"("outputAssetId");
CREATE UNIQUE INDEX "StoryboardFrame_storyboardRunId_ordinal_attempt_key" ON "StoryboardFrame"("storyboardRunId", "ordinal", "attempt");
CREATE INDEX "StoryboardFrame_storyboardRunId_isCurrent_ordinal_idx" ON "StoryboardFrame"("storyboardRunId", "isCurrent", "ordinal");
CREATE INDEX "StoryboardFrame_status_availableAt_idx" ON "StoryboardFrame"("status", "availableAt");
CREATE INDEX "StoryboardFrame_status_leaseExpiresAt_idx" ON "StoryboardFrame"("status", "leaseExpiresAt");

ALTER TABLE "StoryboardRun" ADD CONSTRAINT "StoryboardRun_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryboardRun" ADD CONSTRAINT "StoryboardRun_videoBriefId_fkey"
FOREIGN KEY ("videoBriefId") REFERENCES "VideoBrief"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoryboardRun" ADD CONSTRAINT "StoryboardRun_videoJobId_fkey"
FOREIGN KEY ("videoJobId") REFERENCES "VideoJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoryboardRun" ADD CONSTRAINT "StoryboardRun_approvedById_fkey"
FOREIGN KEY ("approvedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoryboardFrame" ADD CONSTRAINT "StoryboardFrame_storyboardRunId_fkey"
FOREIGN KEY ("storyboardRunId") REFERENCES "StoryboardRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryboardFrame" ADD CONSTRAINT "StoryboardFrame_outputAssetId_fkey"
FOREIGN KEY ("outputAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
