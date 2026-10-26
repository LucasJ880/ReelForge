-- 2026-11 视频核心链路做稳轮 · M1（计划 docs/roadmap/2026-10-26-core-round-plan.md §3 链 M）。
-- 只加可空列 / 带默认值的数组列 / 一个普通索引，不改不删。
-- 拿不到锁就快速失败，不在高峰排队阻塞线上查询。
SET lock_timeout = '5s';

-- VideoJob：段重做候选行（P05-C）与实际套餐回写（P03-B）。
-- replacesJobId 故意不加唯一约束：同一旧行可被多次重做；在途唯一由事务 + logicalJobKey 保证。
ALTER TABLE "VideoJob" ADD COLUMN "replacesJobId" TEXT,
ADD COLUMN "supersededAt" TIMESTAMP(3),
ADD COLUMN "providerPlanId" TEXT;

CREATE INDEX "VideoJob_replacesJobId_idx" ON "VideoJob"("replacesJobId");

-- FinalVideo：只重拼期间保留上一版成片 URL（P05-B 回滚依据）。
ALTER TABLE "FinalVideo" ADD COLUMN "previousStitchedVideoUrl" TEXT;

-- StoryboardRun：参考图按角色显式存（P0-2）；AI 审帧 run 级汇总（P0-1）。
ALTER TABLE "StoryboardRun" ADD COLUMN "personAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "anchorCutoutUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "aiReviewSummary" JSONB;

-- StoryboardFrame：帧级参考图（P05-A 换参考图）；AI 审帧结论（P0-1）。
ALTER TABLE "StoryboardFrame" ADD COLUMN "inputAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "inputImageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "aiReview" JSONB;
