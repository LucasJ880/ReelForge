-- O4 · 同行广告情报（PRD §3 O4 / M4）。
--
-- 合规边界焊在表结构里：**这张表没有任何素材字段**，将来也不要加。
-- 我们保留的是结构标注，不是别人的素材。加一个 mediaUrl 就等于
-- 给「搬运换音轨重发」留了落脚点，而那条路的风险落在客户账号上。

CREATE TYPE "AdIntelSource" AS ENUM (
  'META_AD_LIBRARY', 'TIKTOK_AD_LIBRARY', 'GOOGLE_ADS_TRANSPARENCY', 'APIFY_ORGANIC'
);

CREATE TABLE "AdIntelRecipe" (
    "id" TEXT NOT NULL,
    "source" "AdIntelSource" NOT NULL,
    "externalRef" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "hookType" TEXT NOT NULL,
    "openingBeats" TEXT NOT NULL,
    "pacing" TEXT NOT NULL,
    "sellingPointOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "socialProof" TEXT,
    "ctaForm" TEXT,
    "durationSec" INTEGER,
    "aspectRatio" TEXT,
    "daysRunning" INTEGER,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdIntelRecipe_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdIntelRecipe_source_externalRef_key"
  ON "AdIntelRecipe"("source", "externalRef");
-- 按行业取「长期在投」的结构清单：daysRunning 是排序键，
-- 长期在投 = 还在赚钱，这是搬运拿不到的筛选依据。
CREATE INDEX "AdIntelRecipe_industry_daysRunning_idx"
  ON "AdIntelRecipe"("industry", "daysRunning");
CREATE INDEX "AdIntelRecipe_hookType_idx" ON "AdIntelRecipe"("hookType");
