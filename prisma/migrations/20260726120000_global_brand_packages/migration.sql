ALTER TABLE "WorkspaceBrandPackage"
ADD COLUMN "isGlobal" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "WorkspaceBrandPackage_isGlobal_isActive_updatedAt_idx"
ON "WorkspaceBrandPackage"("isGlobal", "isActive", "updatedAt" DESC);
