-- R2/R3 · 表现回流与配方维度胜负判定（PRD §4 / M2）。
--
-- 只加表与枚举。旧的 racing/scoring 相关表原样不动 —— PRD §10.3 要求新赛马
-- 按新模型重写、旧实现降级为参考，两者会并存一段时间。

CREATE TYPE "PerformanceSubjectType" AS ENUM ('VIDEO', 'POST');

CREATE TABLE "ContentPerformance" (
    "id" TEXT NOT NULL,
    "subjectType" "PerformanceSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "recipeId" TEXT,
    "platform" TEXT NOT NULL,
    "externalPostId" TEXT,
    "windowHours" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "impressions" INTEGER,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "clicks" INTEGER,
    "conversions" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentPerformance_pkey" PRIMARY KEY ("id")
);

-- 同一条内容 + 同一平台 + 同一窗口只允许一行；重复回流走 upsert 覆盖数值，
-- 但**不同窗口各存一行不覆盖**：12h 下结论和 48h 下结论是两回事。
CREATE UNIQUE INDEX "ContentPerformance_subject_platform_window_key"
  ON "ContentPerformance"("subjectType", "subjectId", "platform", "windowHours");
CREATE INDEX "ContentPerformance_recipeId_windowHours_idx"
  ON "ContentPerformance"("recipeId", "windowHours");
CREATE INDEX "ContentPerformance_observedAt_idx" ON "ContentPerformance"("observedAt");
