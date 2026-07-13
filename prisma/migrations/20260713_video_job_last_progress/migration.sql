-- VideoJob.lastProgress: Provider 上报的真实进度（0-100）。
-- 纯 additive、可空，安全应用于现网。
ALTER TABLE "VideoJob" ADD COLUMN "lastProgress" INTEGER;
