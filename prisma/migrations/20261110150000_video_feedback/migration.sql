-- 商家对成片的评价（满意 / 不满意 + 原因）：成片画面质检关掉之后，这是唯一来自真人的质量读数。
-- 只新建一张独立的表，不改不删任何既有表与数据；没有外键，不给既有表加锁。
-- 表没建之前，评价接口会如实告诉商家「暂时没记上」，其它功能不受影响。
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "VideoFeedback" (
    "id" TEXT NOT NULL,
    "videoBriefId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VideoFeedback_videoBriefId_key" ON "VideoFeedback"("videoBriefId");
CREATE INDEX IF NOT EXISTS "VideoFeedback_userId_createdAt_idx" ON "VideoFeedback"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "VideoFeedback_rating_createdAt_idx" ON "VideoFeedback"("rating", "createdAt" DESC);
