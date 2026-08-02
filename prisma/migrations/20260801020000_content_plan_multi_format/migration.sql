-- O1 · 一句话进，多形态出（PRD §3 / M3）。
--
-- 只加表、只加枚举，不动任何现有表：新形态是增量能力，
-- 出问题时下线入口即可，不需要回滚数据。

CREATE TYPE "ContentPlanSource" AS ENUM ('SENTENCE', 'PRODUCT_IMAGE', 'PRODUCT_URL');
CREATE TYPE "ContentFormat" AS ENUM ('TEXT', 'SINGLE_IMAGE', 'CAROUSEL', 'VIDEO');
CREATE TYPE "ContentPostStatus" AS ENUM ('DRAFT', 'READY', 'DISCARDED');

CREATE TABLE "ContentPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "ContentPlanSource" NOT NULL,
    "sourceInput" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "targetAudience" TEXT NOT NULL,
    "corePainPoint" TEXT NOT NULL,
    "productFactsJson" JSONB,
    "generatedBy" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentPost" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "dayOffset" INTEGER NOT NULL,
    "format" "ContentFormat" NOT NULL,
    "status" "ContentPostStatus" NOT NULL DEFAULT 'DRAFT',
    "copyHook" TEXT NOT NULL,
    "copyBody" TEXT NOT NULL,
    "copyCta" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "imagePrompt" TEXT,
    "slidesJson" JSONB,
    "renderedImageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "renderedAt" TIMESTAMP(3),
    "renderError" TEXT,
    "rationale" TEXT NOT NULL,
    "recipeId" TEXT,
    "hookType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentPost_pkey" PRIMARY KEY ("id")
);

-- 同一用户重复提交同一请求不重复计费、不重复生成。
CREATE UNIQUE INDEX "ContentPlan_userId_idempotencyKey_key"
  ON "ContentPlan"("userId", "idempotencyKey");
CREATE INDEX "ContentPlan_userId_createdAt_idx" ON "ContentPlan"("userId", "createdAt");

CREATE UNIQUE INDEX "ContentPost_planId_key_key" ON "ContentPost"("planId", "key");
CREATE INDEX "ContentPost_planId_dayOffset_idx" ON "ContentPost"("planId", "dayOffset");
-- 赛马按配方分组，与 VideoJob.recipeId 同一语义。
CREATE INDEX "ContentPost_recipeId_idx" ON "ContentPost"("recipeId");
CREATE INDEX "ContentPost_status_createdAt_idx" ON "ContentPost"("status", "createdAt");

ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
