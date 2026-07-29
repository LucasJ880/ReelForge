/**
 * 全局品牌包种子（幂等）。
 *
 * 产品决策 0724 #3：全局品牌包对所有用户永久开放且只读。
 * 带 clientProfileId 的全局包同时进入「已服务客户展示墙」；平台自有预设仍可
 * 全局选用但不会冒充客户。工作区私有 Logo 永不出现在墙上。
 *
 * 资产投递（见 src/lib/brand/global-brand-packs.ts）：
 *   - delivery=static —— 文件已提交进仓库，直接用 /public 路径
 *   - delivery=blob   —— 文件被 .gitignore 排除（真实客户 Logo），必须上传到
 *     Vercel Blob，DB 里存绝对 https URL。否则线上取 /brand/*.png 会 404 裂图。
 *
 * 用法：
 *   npx dotenv -e .env.local -- npx tsx scripts/seed-global-brand-packages.ts
 *   加 --dry-run 只打印将要写入的 URL，不落库、不上传。
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { AdminRole, PrismaClient } from "@prisma/client";
import {
  GLOBAL_BRAND_PACKS,
  type GlobalBrandAssetSpec,
} from "../src/lib/brand/global-brand-packs";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

async function resolveAssetUrl(
  spec: GlobalBrandAssetSpec,
  bytes: Buffer,
): Promise<string> {
  if (spec.delivery === "static") {
    if (!spec.publicUrl) {
      throw new Error(`[seed] ${spec.key} 声明为 static 但缺少 publicUrl`);
    }
    return spec.publicUrl;
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      `[seed] ${spec.key} 需要上传对象存储，但未配置 BLOB_READ_WRITE_TOKEN。` +
        "（这些资产不进仓库，缺少 token 会让线上渲染成裂图。）",
    );
  }
  if (DRY_RUN) return `blob://${spec.key}（dry-run，未上传）`;
  /// 固定 key + 覆盖写 → URL 稳定，重复执行不会产生新对象
  const blob = await put(spec.key, bytes, {
    access: "public",
    token,
    contentType: "image/png",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 31536000,
  });
  return blob.url;
}

async function upsertAsset(
  spec: GlobalBrandAssetSpec,
  userId: string,
  workspaceId: string,
): Promise<string> {
  const bytes = await readFile(spec.file);
  const url = await resolveAssetUrl(spec, bytes);
  const common = {
    userId,
    workspaceId,
    url,
    mimeType: "image/png",
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width: spec.width,
    height: spec.height,
  };
  console.log(`   ↳ ${spec.key} → ${url}`);
  if (DRY_RUN) return `dry-run:${spec.key}`;
  const asset = await prisma.mediaAsset.upsert({
    where: { storageKey: spec.key },
    create: { storageKey: spec.key, ...common },
    update: common,
  });
  return asset.id;
}

async function main() {
  const owner =
    (await prisma.adminUser.findFirst({
      where: { role: AdminRole.SUPER_ADMIN },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.adminUser.findUnique({
      where: { email: process.env.SEED_DEMO_EMAIL || "demo@aivora.app" },
    }));
  if (!owner) throw new Error("找不到平台账号，无法挂载全局品牌包");

  const workspace = await prisma.workspace.findUnique({
    where: { ownerId: owner.id },
    select: { id: true },
  });
  if (!workspace) throw new Error("平台账号没有工作区，无法挂载全局品牌包");

  for (const pack of GLOBAL_BRAND_PACKS) {
    const logoAssetId = await upsertAsset(pack.logo, owner.id, workspace.id);
    const endCardAssetId = pack.endCard
      ? await upsertAsset(pack.endCard, owner.id, workspace.id)
      : null;

    const data = {
      brandName: pack.brandName,
      slogan: pack.slogan,
      cta: pack.cta,
      website: pack.website,
      contactLines: pack.contactLines,
      clientProfileId: pack.clientProfileId,
      logoAssetId,
      endCardAssetId,
      /// 全局包只读：isGlobal 同时驱动 canEdit=false 与展示墙可见性
      isGlobal: true,
      isActive: true,
      isDefault: false,
    };

    if (DRY_RUN) {
      console.log(`🔍 dry-run 全局品牌包：${pack.name}（${pack.brandName}）`);
      continue;
    }

    await prisma.workspaceBrandPackage.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name: pack.name } },
      create: { workspaceId: workspace.id, name: pack.name, ...data },
      update: data,
    });
    console.log(`✅ 全局品牌包：${pack.name}（${pack.brandName}）`);
  }

  if (DRY_RUN) return;
  const total = await prisma.workspaceBrandPackage.count({
    where: { isGlobal: true, isActive: true },
  });
  console.log(`\n全局品牌包合计：${total}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
