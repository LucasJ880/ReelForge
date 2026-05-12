-- =========================================================
-- Phase 5 Unified Input: persona discriminator + asset classification
-- =========================================================
-- 兼容性铁律：
--   * 所有新列对旧行使用 NULL 或默认值（不会破坏 Sunny Shutter / wizard / brief 现有 query）。
--   * AdminUser.userType 默认 "OPERATOR" 让存量账号自动落到 internal shell，不强跳 /persona。
--   * VideoBrief.persona 留 NULL 表示历史 brief 无 persona 信息（analytics 兜底）。
--   * RawAsset.inferredRole 与现有 assetRole 共存：assetRole 是客户手动标记，inferredRole 是 asset-classifier 输出。

-- 1. AdminUser.userType（persona discriminator）
ALTER TABLE "AdminUser"
  ADD COLUMN IF NOT EXISTS "userType" TEXT DEFAULT 'OPERATOR';

-- 2. VideoBrief.persona / videoGenerationPlan
ALTER TABLE "VideoBrief"
  ADD COLUMN IF NOT EXISTS "persona" TEXT;
ALTER TABLE "VideoBrief"
  ADD COLUMN IF NOT EXISTS "videoGenerationPlan" JSONB;

-- 3. RawAsset.inferredRole / roleConfidence
ALTER TABLE "RawAsset"
  ADD COLUMN IF NOT EXISTS "inferredRole" TEXT;
ALTER TABLE "RawAsset"
  ADD COLUMN IF NOT EXISTS "roleConfidence" DOUBLE PRECISION;
