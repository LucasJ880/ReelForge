-- 出方案并成一次（第二步）：建故事板时那次看图调用的视觉盘点（商品 / 场所描述）存在 run 上，
-- 派发视频时直接读回，不再重新看图。只加一个可空列，不改不删既有数据；历史行为 NULL（派发时照旧现看）。
-- 拿不到锁就快速失败，不在高峰排队阻塞线上查询。
SET lock_timeout = '5s';

ALTER TABLE "StoryboardRun" ADD COLUMN IF NOT EXISTS "visualReference" JSONB;
