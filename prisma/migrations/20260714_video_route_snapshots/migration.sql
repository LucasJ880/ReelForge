-- Expand-only routing evidence for multi-provider video generation.
--
-- Intentionally nullable and without defaults/backfill: historical rows do not
-- prove which runtime route, model, or adapter produced them. Application code
-- must treat the all-NULL shape as historical unknown and fail closed for any
-- operation that requires an explicit route.

ALTER TABLE "VideoBrief"
  ADD COLUMN "videoRouteSnapshot" TEXT,
  ADD COLUMN "videoModelSnapshot" TEXT,
  ADD COLUMN "videoProviderAdapterSnapshot" TEXT;

ALTER TABLE "BatchJob"
  ADD COLUMN "videoRouteSnapshot" TEXT,
  ADD COLUMN "videoModelSnapshot" TEXT,
  ADD COLUMN "videoProviderAdapterSnapshot" TEXT;

ALTER TABLE "VideoJob"
  ADD COLUMN "videoRouteSnapshot" TEXT,
  ADD COLUMN "videoModelSnapshot" TEXT,
  ADD COLUMN "videoProviderAdapterSnapshot" TEXT;

ALTER TABLE "VideoDispatchRequest"
  ADD COLUMN "videoRouteSnapshot" TEXT,
  ADD COLUMN "videoModelSnapshot" TEXT,
  ADD COLUMN "videoProviderAdapterSnapshot" TEXT;
