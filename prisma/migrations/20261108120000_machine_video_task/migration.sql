-- 外部机器视频任务入口。只加表，不改不删既有数据。
-- 创建任务不代表开拍：供应商调用仍由创作台确认故事板之后的既有派发负责。
-- 拿不到锁就快速失败，不在高峰排队阻塞线上查询。
SET lock_timeout = '5s';

CREATE TABLE "MachineVideoTask" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "voiceoverScript" TEXT,
  "durationSec" INTEGER NOT NULL,
  "aspectRatio" TEXT NOT NULL,
  "assetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "storyboardRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MachineVideoTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MachineVideoTask_storyboardRunId_key" ON "MachineVideoTask"("storyboardRunId");
CREATE UNIQUE INDEX "MachineVideoTask_userId_idempotencyKey_key" ON "MachineVideoTask"("userId", "idempotencyKey");
CREATE INDEX "MachineVideoTask_userId_createdAt_idx" ON "MachineVideoTask"("userId", "createdAt" DESC);

ALTER TABLE "MachineVideoTask" ADD CONSTRAINT "MachineVideoTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineVideoTask" ADD CONSTRAINT "MachineVideoTask_storyboardRunId_fkey" FOREIGN KEY ("storyboardRunId") REFERENCES "StoryboardRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
