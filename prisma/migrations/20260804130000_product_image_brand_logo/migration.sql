-- 印上品牌 Logo（路径 B：产品照没印 logo，AI 印上去）。
-- 产品图任务快照品牌包 logo 参考输入（与 sourceImageUrl 同为不可变已计费请求输入）。
-- 纯加法：三列 nullable，不动任何行。
ALTER TABLE "ProductImageJob" ADD COLUMN IF NOT EXISTS "brandPackageId" TEXT;
ALTER TABLE "ProductImageJob" ADD COLUMN IF NOT EXISTS "brandLogoAssetId" TEXT;
ALTER TABLE "ProductImageJob" ADD COLUMN IF NOT EXISTS "brandLogoUrl" TEXT;
