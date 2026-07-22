-- Expand Product Image Studio into durable, auditable Shuyu Image 2 tasks.
ALTER TABLE "ProductImageJob"
ADD COLUMN "sourceAssetId" TEXT,
ADD COLUMN "provider" TEXT,
ADD COLUMN "providerRequestKey" TEXT,
ADD COLUMN "externalTaskId" TEXT,
ADD COLUMN "planId" TEXT,
ADD COLUMN "modelSnapshot" TEXT,
ADD COLUMN "resolutionSnapshot" TEXT,
ADD COLUMN "pointsSnapshot" INTEGER,
ADD COLUMN "finalPoints" INTEGER,
ADD COLUMN "resultCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "lastProviderStatus" TEXT,
ADD COLUMN "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN "pollErrors" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "ProductImageJob_providerRequestKey_key" ON "ProductImageJob"("providerRequestKey");
CREATE UNIQUE INDEX "ProductImageJob_externalTaskId_key" ON "ProductImageJob"("externalTaskId");
CREATE INDEX "ProductImageJob_status_lastCheckedAt_idx" ON "ProductImageJob"("status", "lastCheckedAt");

ALTER TABLE "ProductImageJob"
ADD CONSTRAINT "ProductImageJob_sourceAssetId_fkey"
FOREIGN KEY ("sourceAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProductImageResult" (
    "id" TEXT NOT NULL,
    "productImageJobId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "outputImageUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImageResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductImageResult_assetId_key" ON "ProductImageResult"("assetId");
CREATE UNIQUE INDEX "ProductImageResult_productImageJobId_position_key" ON "ProductImageResult"("productImageJobId", "position");
CREATE INDEX "ProductImageResult_productImageJobId_idx" ON "ProductImageResult"("productImageJobId");

ALTER TABLE "ProductImageResult"
ADD CONSTRAINT "ProductImageResult_productImageJobId_fkey"
FOREIGN KEY ("productImageJobId") REFERENCES "ProductImageJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductImageResult"
ADD CONSTRAINT "ProductImageResult_assetId_fkey"
FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
