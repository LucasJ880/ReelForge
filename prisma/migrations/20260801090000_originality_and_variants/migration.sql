-- O4 验收 2 与 3 的两个信号。
--
-- originalityScore：对参考素材的重复度。合规主张要有证据 ——
--   我们对外说生成内容是原创的，就得留下能证明的数字。
-- variantCount：同一广告主为这条创意跑过几个版本。反复迭代同一结构
--   = 广告主自己在往里投钱调优，比单看投放天数更强的有效性信号。
ALTER TABLE "ContentPlan" ADD COLUMN IF NOT EXISTS "originalityScore" DOUBLE PRECISION;
ALTER TABLE "AdIntelRecipe" ADD COLUMN IF NOT EXISTS "variantCount" INTEGER;
