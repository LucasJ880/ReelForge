-- B3 · Brand Kit 补齐 + B4 · 品类锁（PRD §5.2 / M6）。全部可空列，历史行 NULL。
ALTER TABLE "WorkspaceBrandPackage" ADD COLUMN IF NOT EXISTS "paletteJson" JSONB;
ALTER TABLE "WorkspaceBrandPackage" ADD COLUMN IF NOT EXISTS "fontFamily" TEXT;
ALTER TABLE "WorkspaceBrandPackage" ADD COLUMN IF NOT EXISTS "logoSafeZoneJson" JSONB;
ALTER TABLE "WorkspaceBrandPackage" ADD COLUMN IF NOT EXISTS "compositionRecipeJson" JSONB;
ALTER TABLE "WorkspaceBrandPackage" ADD COLUMN IF NOT EXISTS "photographyStyleJson" JSONB;
ALTER TABLE "WorkspaceBrandPackage" ADD COLUMN IF NOT EXISTS "productCategoryId" TEXT;
