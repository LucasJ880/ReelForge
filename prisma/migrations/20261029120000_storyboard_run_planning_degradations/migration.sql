-- 2026-10-29 出方案降级可见：故事板 run 记下建故事板时哪几步 AI 没用上、退回了兜底（镜头卡 → 模板节奏）。
-- 形状同 VideoBrief.videoGenerationPlan 里的 planningDegradations。只加一个可空 JSONB 列，不改不删。
-- 拿不到锁就快速失败，不在高峰排队阻塞线上查询。
SET lock_timeout = '5s';

ALTER TABLE "StoryboardRun" ADD COLUMN "planningDegradations" JSONB;
