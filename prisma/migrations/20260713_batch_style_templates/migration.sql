-- 批量视频风格模板：ACTIVE 行为不可变版本，变更必须新增 version。
CREATE TYPE "StyleTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE');

CREATE TABLE "StyleTemplate" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "nameZh" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "coverImage" TEXT NOT NULL,
  "promptSkeleton" TEXT NOT NULL,
  "negativePrompt" TEXT NOT NULL,
  "lockedParams" JSONB NOT NULL,
  "imagesPerVideo" JSONB NOT NULL,
  "status" "StyleTemplateStatus" NOT NULL DEFAULT 'DRAFT',
  "activatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StyleTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StyleTemplate_slug_version_key"
  ON "StyleTemplate"("slug", "version");
CREATE INDEX "StyleTemplate_status_category_idx"
  ON "StyleTemplate"("status", "category");
