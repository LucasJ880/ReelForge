CREATE TABLE "WorkspaceBrandPackage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "slogan" TEXT,
    "cta" TEXT,
    "contactLines" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "website" TEXT,
    "clientProfileId" TEXT,
    "logoAssetId" TEXT NOT NULL,
    "endCardAssetId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceBrandPackage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceBrandPackage_workspaceId_name_key"
ON "WorkspaceBrandPackage"("workspaceId", "name");
CREATE INDEX "WorkspaceBrandPackage_workspaceId_isActive_createdAt_idx"
ON "WorkspaceBrandPackage"("workspaceId", "isActive", "createdAt" DESC);
CREATE INDEX "WorkspaceBrandPackage_logoAssetId_idx"
ON "WorkspaceBrandPackage"("logoAssetId");
CREATE INDEX "WorkspaceBrandPackage_endCardAssetId_idx"
ON "WorkspaceBrandPackage"("endCardAssetId");

ALTER TABLE "WorkspaceBrandPackage" ADD CONSTRAINT "WorkspaceBrandPackage_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceBrandPackage" ADD CONSTRAINT "WorkspaceBrandPackage_logoAssetId_fkey"
FOREIGN KEY ("logoAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkspaceBrandPackage" ADD CONSTRAINT "WorkspaceBrandPackage_endCardAssetId_fkey"
FOREIGN KEY ("endCardAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
