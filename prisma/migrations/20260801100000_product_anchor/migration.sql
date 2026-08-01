-- B1 · 产品身份锚定（PRD §5 / M5）。一个 SKU 做一次，之后所有内容复用。
-- 只加表。商用抠图 key 未配置时锚点停在 PENDING_CUTOUT，不做假成功。

CREATE TYPE "ProductAnchorStatus" AS ENUM ('PENDING_CUTOUT', 'READY', 'FAILED');

CREATE TABLE "ProductAnchor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "sourceImageUrl" TEXT NOT NULL,
    "cutoutUrl" TEXT,
    "maskUrl" TEXT,
    "logoBoxJson" JSONB,
    "brandName" TEXT,
    "status" "ProductAnchorStatus" NOT NULL DEFAULT 'PENDING_CUTOUT',
    "cutoutProvider" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductAnchor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductAnchor_userId_sku_key" ON "ProductAnchor"("userId", "sku");
CREATE INDEX "ProductAnchor_status_idx" ON "ProductAnchor"("status");

ALTER TABLE "ProductAnchor" ADD CONSTRAINT "ProductAnchor_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
