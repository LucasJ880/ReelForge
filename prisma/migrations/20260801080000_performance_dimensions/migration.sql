-- R3 的其余分组维度（PRD §4.3：钩子类型 / 模板 / 时长 / 画幅 / 植入档位）。
--
-- 与 recipeId 同样是从 subject 复制的快照，回流方不能指定。
-- 只加可空列，历史行保持 NULL —— NULL 在该维度上表示「未知」，
-- 会被排除出该维度的比较，而不是归进某个默认桶。
ALTER TABLE "ContentPerformance" ADD COLUMN IF NOT EXISTS "hookType" TEXT;
ALTER TABLE "ContentPerformance" ADD COLUMN IF NOT EXISTS "templateId" TEXT;
ALTER TABLE "ContentPerformance" ADD COLUMN IF NOT EXISTS "durationSec" INTEGER;
ALTER TABLE "ContentPerformance" ADD COLUMN IF NOT EXISTS "aspectRatio" TEXT;
ALTER TABLE "ContentPerformance" ADD COLUMN IF NOT EXISTS "brandPlacement" TEXT;

-- 决策 3 的验证维度要能单独扫。
CREATE INDEX IF NOT EXISTS "ContentPerformance_brandPlacement_windowHours_idx"
  ON "ContentPerformance"("brandPlacement", "windowHours");
