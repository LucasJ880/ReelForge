-- 1025 整合轮 C1：自助注册 → 上手向导。只加可空列，不改不删。
-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "businessProfile" JSONB,
ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN "leadPageRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN "termsVersion" TEXT;
