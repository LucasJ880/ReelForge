/**
 * 全局品牌包种子（幂等）。
 *
 * 产品决策 0724 #3：全局品牌包对所有用户永久开放且只读。
 * 带 clientProfileId 的全局包同时进入「已服务客户展示墙」；平台自有预设仍可
 * 全局选用但不会冒充客户。工作区私有 Logo 永不出现在墙上。
 *
 * 用法：
 *   npx dotenv -e .env.local -- npx tsx scripts/seed-global-brand-packages.ts
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { AdminRole, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type GlobalPack = {
  /** WorkspaceBrandPackage.name —— 与 workspaceId 组成唯一键 */
  name: string;
  brandName: string;
  slogan: string | null;
  cta: string | null;
  website: string | null;
  contactLines: string[];
  clientProfileId: string | null;
  logo: { file: string; url: string; key: string; width: number; height: number };
  endCard: { file: string; url: string; key: string; width: number; height: number } | null;
};

const PACKS: GlobalPack[] = [
  {
    name: "Aivora Clean",
    brandName: "Aivora",
    slogan: "From one idea to reliable delivery.",
    cta: "Create your next product story",
    website: "aivora.app",
    contactLines: [],
    clientProfileId: null,
    logo: {
      file: "public/demo/pet/aivora-logo-endcard.png",
      url: "/demo/pet/aivora-logo-endcard.png",
      key: "seed/global-brand/aivora-logo-endcard.png",
      width: 1536,
      height: 1024,
    },
    endCard: null,
  },
  {
    /// 客户展示墙首位：真实交付客户，尾卡电话/地址由 end-card renderer 烧录。
    name: "SunnyShutter",
    brandName: "SUNNY Shutters",
    slogan: "Custom plantation shutters, measured and installed.",
    cta: "Book your free in-home quote",
    website: null,
    contactLines: ["Call/Text 647-857-8669", "690 Progress Ave Unit 7&8, Scarborough"],
    clientProfileId: "sunnyshutter",
    logo: {
      file: "public/brand/sunny-logo.png",
      url: "/brand/sunny-logo.png",
      key: "seed/global-brand/sunnyshutter-logo.png",
      width: 1316,
      height: 1316,
    },
    endCard: {
      file: "public/brand/sunnyshutter-end-card-9x16.png",
      url: "/brand/sunnyshutter-end-card-9x16.png",
      key: "seed/global-brand/sunnyshutter-end-card-9x16.png",
      width: 1536,
      height: 2752,
    },
  },
];

async function upsertAsset(
  spec: GlobalPack["logo"],
  userId: string,
  workspaceId: string,
): Promise<string> {
  const bytes = await readFile(spec.file);
  const common = {
    userId,
    workspaceId,
    url: spec.url,
    mimeType: "image/png",
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width: spec.width,
    height: spec.height,
  };
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

  for (const pack of PACKS) {
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

    await prisma.workspaceBrandPackage.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name: pack.name } },
      create: { workspaceId: workspace.id, name: pack.name, ...data },
      update: data,
    });
    console.log(`✅ 全局品牌包：${pack.name}（${pack.brandName}）`);
  }

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
