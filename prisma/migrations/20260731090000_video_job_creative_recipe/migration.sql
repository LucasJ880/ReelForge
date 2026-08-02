-- 创意配方快照（PRD §9.4）。赛马按「哪种结构在赢」归因的唯一依据。
--
-- 全部为可空列 + 不带 DEFAULT：Postgres 不做表重写、不锁表、不回填。
-- 历史行保持 NULL —— NULL 表示「未知」，不是某个默认配方，
-- 配方维度统计必须把它们排除，绝不能用模板现状反推回填。
ALTER TABLE "VideoJob" ADD COLUMN IF NOT EXISTS "recipeId" TEXT;
ALTER TABLE "VideoJob" ADD COLUMN IF NOT EXISTS "hookType" TEXT;
ALTER TABLE "VideoJob" ADD COLUMN IF NOT EXISTS "templateId" TEXT;
ALTER TABLE "VideoJob" ADD COLUMN IF NOT EXISTS "aspectRatio" TEXT;
ALTER TABLE "VideoJob" ADD COLUMN IF NOT EXISTS "brandPlacement" TEXT;

-- 青砚 aivora-sync 按完成时间倒序增量拉取（约 200 条/天）。
CREATE INDEX IF NOT EXISTS "VideoJob_status_finishedAt_idx"
  ON "VideoJob"("status", "finishedAt");

-- 赛马按配方分组统计。
CREATE INDEX IF NOT EXISTS "VideoJob_recipeId_idx" ON "VideoJob"("recipeId");
