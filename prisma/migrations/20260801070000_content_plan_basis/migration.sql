-- 排期依据（PRD §3 O4 / §4 R4）。
-- 借同行结构排的一周和按自己战绩排的一周，对商家意义完全不同，
-- 必须能说清楚这一周为什么这么排。可空列，历史计划保持 NULL。
ALTER TABLE "ContentPlan" ADD COLUMN IF NOT EXISTS "planBasis" TEXT;
