# 实施计划 · 产品图印上品牌 Logo

Spec：`docs/superpowers/specs/2026-08-04-product-image-brand-logo-design.md`
分支：`feat/product-image-brand-logo`。步骤按依赖排序，每步以可验证产物收口。

1. **Schema + 迁移**：`prisma/schema.prisma` ProductImageJob 加
   `brandPackageId / brandLogoAssetId / brandLogoUrl`（全 nullable）；
   `prisma/migrations/20260804130000_product_image_brand_logo/migration.sql`
   三条 `ADD COLUMN IF NOT EXISTS`；`npm run db:generate`。
2. **Service**：`product-image-service.ts` —— `ProductImageRequest.brandLogo`；
   create 持久化快照；submit/重放 `inputImages=[source, logo]`（快照列取值）；
   `buildProductImagePrompt({ hasBrandLogo })` 印制块；PROMPT_VERSION → v3。
   单测（node --test，monkey-patch db 模型 + `__setRuntimeDependenciesForTests`）。
3. **Route**：`api/product-images/route.ts` —— zod 加 `brandPackageId`；
   `findWorkspaceBrandPackageForUser` 解析；400 `BRAND_LOGO_REQUIRES_SOURCE` /
   404 `RESOURCE_NOT_FOUND`；`productImageJobView` 暴露 `brandLogo`。
   合同测试三例进 `product-image-ui-contract.test.ts`。
4. **UI + i18n**：`create/images/page.tsx` 预载品牌包精简列表；
   `product-image-studio.tsx` 开关行（缩略图/下拉/禁用态/空态链接）；
   `platform-copy.ts` zh+en 文案。
5. **交付门**：`npm run typecheck` + `npm run lint` +
   `node --import tsx --test tests/shuyu-product-image-service.test.ts
   tests/product-image-ui-contract.test.ts tests/product-image-studio.test.ts`。
6. **上线与真机验收**：`npm run db:migrate:deploy`（owner 直连）→ dev 真机模式 →
   SunnyShutter 窗帘图印 logo → 单条视频全流程出一条完整带货视频（语音字幕齐且对齐、
   产品带 logo）；产出视频交付给 Evan 审看后发青砚。
