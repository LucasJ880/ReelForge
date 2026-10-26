-- 2026-11 视频核心链路做稳轮 · P05-B 只重拼回滚依据补齐（PR #16 审查 blocker 1）。
-- 只加一列可空 JSONB，不改不删。拿不到锁就快速失败，不在高峰排队阻塞线上查询。
SET lock_timeout = '5s';

-- FinalVideo：只重拼期间保留上一版后期快照（回滚时写回 postProduction）。
ALTER TABLE "FinalVideo" ADD COLUMN "previousPostProduction" JSONB;
