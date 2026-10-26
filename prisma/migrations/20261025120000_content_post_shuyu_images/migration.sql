-- 2026-10-25 C2 · 图文帖配图改走 Shuyu 异步出图：只加列 / 加表 / 加枚举，不删不改。
-- 新列可空、新表新枚举：存量行与线上写入都不受影响；同步 OpenAI 回滚线路不读这些列。
-- 拿不到锁就快速失败，不在高峰排队阻塞线上查询。
SET lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "ContentPostImageStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ContentPost" ADD COLUMN     "renderRunId" TEXT;

-- CreateTable
CREATE TABLE "ContentPostImageTask" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "renderRunId" TEXT NOT NULL,
    "slideIndex" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "prompt" TEXT NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "status" "ContentPostImageStatus" NOT NULL DEFAULT 'QUEUED',
    "providerRequestKey" TEXT NOT NULL,
    "externalTaskId" TEXT,
    "submissionState" "ProviderSubmissionState" NOT NULL DEFAULT 'NOT_STARTED',
    "provider" TEXT NOT NULL DEFAULT 'shuyu',
    "submitAttempts" INTEGER NOT NULL DEFAULT 0,
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
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPostImageTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentPostImageTask_providerRequestKey_key" ON "ContentPostImageTask"("providerRequestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPostImageTask_externalTaskId_key" ON "ContentPostImageTask"("externalTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPostImageTask_outputAssetId_key" ON "ContentPostImageTask"("outputAssetId");

-- CreateIndex
CREATE INDEX "ContentPostImageTask_postId_isCurrent_slideIndex_idx" ON "ContentPostImageTask"("postId", "isCurrent", "slideIndex");

-- CreateIndex
CREATE INDEX "ContentPostImageTask_status_availableAt_idx" ON "ContentPostImageTask"("status", "availableAt");

-- CreateIndex
CREATE INDEX "ContentPostImageTask_status_leaseExpiresAt_idx" ON "ContentPostImageTask"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "ContentPostImageTask_renderRunId_idx" ON "ContentPostImageTask"("renderRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPostImageTask_postId_slideIndex_attempt_key" ON "ContentPostImageTask"("postId", "slideIndex", "attempt");

-- AddForeignKey
ALTER TABLE "ContentPostImageTask" ADD CONSTRAINT "ContentPostImageTask_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ContentPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPostImageTask" ADD CONSTRAINT "ContentPostImageTask_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
