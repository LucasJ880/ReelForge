-- 2026-10-25 C4 · 能力注册表当前状态：每个能力一行（text / vision / image / graphics / video /
-- voice / moderation / stock / scrape / cutout / email）。只加表，不动任何现有表。
-- 拿不到锁就快速失败，不在高峰排队阻塞线上查询。
SET lock_timeout = '5s';

-- CreateTable
CREATE TABLE "CapabilityStatus" (
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "failingSince" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapabilityStatus_pkey" PRIMARY KEY ("key")
);
