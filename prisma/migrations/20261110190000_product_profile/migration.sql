-- 商品档案：商家常拍的一件商品（名字、卖点、尺寸、一组商品图的素材 id），存一次、以后直接拍。
-- 只新建一张独立的表，不改不删任何既有表与数据；没有外键，不给既有表加锁。
-- 表没建之前，「商品」页会如实说明还没开通，创作页照常可用。
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "ProductProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sellingPoints" TEXT NOT NULL DEFAULT '',
    "size" TEXT,
    "imageAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductProfile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProductProfile_userId_archivedAt_updatedAt_idx" ON "ProductProfile"("userId", "archivedAt", "updatedAt" DESC);
