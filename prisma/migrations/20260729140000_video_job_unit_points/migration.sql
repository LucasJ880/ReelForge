-- 单条成片成本快照（PRD C1）。
-- 加可空列：不锁表、不回填、不影响现有行；历史任务保持 NULL，
-- 统计层只从有快照的行计算平均成本。
ALTER TABLE "VideoJob" ADD COLUMN IF NOT EXISTS "providerUnitPoints" INTEGER;
