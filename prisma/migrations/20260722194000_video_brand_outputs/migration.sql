-- Expand-only storage for optional tenant branding. The original provider
-- output remains the clean master; these columns only reference a packaged
-- derivative when the customer explicitly enables logo/end-card delivery.
ALTER TABLE "VideoBrief"
ADD COLUMN IF NOT EXISTS "brandedVideoUrl" TEXT,
ADD COLUMN IF NOT EXISTS "brandedAt" TIMESTAMP(3);

ALTER TABLE "VideoJob"
ADD COLUMN IF NOT EXISTS "brandedVideoUrl" TEXT,
ADD COLUMN IF NOT EXISTS "brandedAt" TIMESTAMP(3);

-- Prisma's @updatedAt fields are application-managed. Match the datamodel so
-- direct inserts cannot silently get a database timestamp that Prisma did not
-- write.
ALTER TABLE "ProductImageProviderTask"
ALTER COLUMN "updatedAt" DROP DEFAULT;
