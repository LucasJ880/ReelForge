import {
  Prisma,
  PrismaClient,
  AdminRole,
  StyleTemplateStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { BATCH_STYLE_TEMPLATE_SEEDS } from "../src/lib/video-generation/batch-style-templates";

const prisma = new PrismaClient();

async function seedPlanEntitlements() {
  await prisma.planEntitlement.upsert({
    where: { id: "starter" },
    create: {
      id: "starter",
      monthlyVideoLimit: 30,
      batchConcurrencyLimit: 10,
      templateLibraryAccess: "standard",
      featureFlags: { digitalHuman: false },
    },
    update: {
      monthlyVideoLimit: 30,
      batchConcurrencyLimit: 10,
      templateLibraryAccess: "standard",
      featureFlags: { digitalHuman: false },
    },
  });
  await prisma.planEntitlement.upsert({
    where: { id: "studio" },
    create: {
      id: "studio",
      monthlyVideoLimit: 200,
      batchConcurrencyLimit: 10,
      templateLibraryAccess: "full",
      featureFlags: { digitalHuman: false },
    },
    update: {
      monthlyVideoLimit: 200,
      batchConcurrencyLimit: 10,
      templateLibraryAccess: "full",
      featureFlags: { digitalHuman: false },
    },
  });
}

async function ensureWorkspace(args: {
  userId: string;
  name: string;
  planId: "starter" | "studio";
}) {
  await prisma.workspace.upsert({
    where: { ownerId: args.userId },
    create: {
      ownerId: args.userId,
      name: args.name,
      planId: args.planId,
      isDefault: true,
    },
    update: { planId: args.planId, isDefault: true },
  });
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@aivora.internal";
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    console.log(
      "⚠️  SEED_ADMIN_PASSWORD 未设置，跳过 admin seed。请在 .env.local 中配置 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD 再运行 npm run db:seed。",
    );
    return;
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    await ensureWorkspace({
      userId: existing.id,
      name: existing.name || "Aivora Operations",
      planId: "starter",
    });
    console.log(`✅ Admin 已存在：${email}（role=${existing.role}）`);
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const admin = await prisma.adminUser.create({
    data: {
      email,
      name: "Super Admin",
      hashedPassword,
      role: AdminRole.SUPER_ADMIN,
      userType: "SUPER_ADMIN",
    },
  });
  await ensureWorkspace({
    userId: admin.id,
    name: "Aivora Operations",
    planId: "starter",
  });
  console.log(`✅ 已创建超级管理员：${admin.email}`);
}

/**
 * Demo 个人演示账号（客户端到端展示用）。
 * 登录页「一键体验」按钮使用同一组默认凭据；可用
 * SEED_DEMO_EMAIL / SEED_DEMO_PASSWORD 覆盖。
 */
async function seedDemoPersonalUser() {
  const email = process.env.SEED_DEMO_EMAIL || "demo@aivora.app";
  const password = process.env.SEED_DEMO_PASSWORD || "aivora2026";

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    /// 幂等：demo 账号每次 seed 都重置为已知凭据 + PERSONAL persona，
    /// 保证「一键体验」按钮永远能登录（demo 账号无真实数据，重置无风险）。
    await prisma.adminUser.update({
      where: { email },
      data: {
        role: AdminRole.CUSTOMER,
        userType: "PERSONAL",
        hashedPassword: await bcrypt.hash(password, 10),
      },
    });
    await ensureWorkspace({
      userId: existing.id,
      name: existing.name || "Aivora Demo",
      planId: "starter",
    });
    console.log(`✅ Demo 账号已重置凭据：${email}（密码：${password}）`);
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const demo = await prisma.adminUser.create({
    data: {
      email,
      name: "Aivora Demo",
      hashedPassword,
      role: AdminRole.CUSTOMER,
      userType: "PERSONAL",
    },
  });
  await ensureWorkspace({
    userId: demo.id,
    name: "Aivora Demo",
    planId: "starter",
  });
  console.log(`✅ 已创建 Demo 个人账号：${demo.email}（密码：${password}）`);
}

async function seedStyleTemplates() {
  let created = 0;
  for (const template of BATCH_STYLE_TEMPLATE_SEEDS) {
    created += await prisma.$transaction(async (tx) => {
      const existing = await tx.styleTemplate.findUnique({
        where: { slug_version: { slug: template.slug, version: template.version } },
        select: { id: true },
      });
      if (existing) return 0;
      await tx.styleTemplate.updateMany({
        where: { slug: template.slug, status: StyleTemplateStatus.ACTIVE },
        data: { status: StyleTemplateStatus.ARCHIVED },
      });
      await tx.styleTemplate.create({
        data: {
          ...template,
          lockedParams: template.lockedParams as unknown as Prisma.InputJsonValue,
          imagesPerVideo: template.imagesPerVideo as unknown as Prisma.InputJsonValue,
          status: StyleTemplateStatus.ACTIVE,
          activatedAt: new Date(),
        },
      });
      return 1;
    });
  }
  console.log(
    `✅ 批量风格模板：新增 ${created}，总定义 ${BATCH_STYLE_TEMPLATE_SEEDS.length}`,
  );
}

async function seedGlobalBrandPackages() {
  const platformOwner =
    (await prisma.adminUser.findFirst({
      where: { role: AdminRole.SUPER_ADMIN },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.adminUser.findUnique({
      where: { email: process.env.SEED_DEMO_EMAIL || "demo@aivora.app" },
    }));
  if (!platformOwner) {
    console.log("⚠️  无平台账号，跳过全局品牌包 seed。");
    return;
  }
  const workspace = await prisma.workspace.findUnique({
    where: { ownerId: platformOwner.id },
  });
  if (!workspace) {
    console.log("⚠️  平台账号无工作区，跳过全局品牌包 seed。");
    return;
  }

  const logoPath = "public/demo/pet/aivora-logo-endcard.png";
  const logoBytes = await readFile(logoPath);
  const logoAsset = await prisma.mediaAsset.upsert({
    where: { storageKey: "seed/global-brand/aivora-logo-endcard.png" },
    create: {
      userId: platformOwner.id,
      workspaceId: workspace.id,
      storageKey: "seed/global-brand/aivora-logo-endcard.png",
      url: "/demo/pet/aivora-logo-endcard.png",
      mimeType: "image/png",
      byteSize: logoBytes.byteLength,
      sha256: createHash("sha256").update(logoBytes).digest("hex"),
      width: 1536,
      height: 1024,
    },
    update: {
      userId: platformOwner.id,
      workspaceId: workspace.id,
      url: "/demo/pet/aivora-logo-endcard.png",
      byteSize: logoBytes.byteLength,
      sha256: createHash("sha256").update(logoBytes).digest("hex"),
      width: 1536,
      height: 1024,
    },
  });
  await prisma.workspaceBrandPackage.upsert({
    where: {
      workspaceId_name: {
        workspaceId: workspace.id,
        name: "Aivora Clean",
      },
    },
    create: {
      workspaceId: workspace.id,
      name: "Aivora Clean",
      brandName: "Aivora",
      slogan: "From one idea to reliable delivery.",
      cta: "Create your next product story",
      website: "aivora.app",
      logoAssetId: logoAsset.id,
      endCardAssetId: logoAsset.id,
      isGlobal: true,
      isDefault: false,
    },
    update: {
      logoAssetId: logoAsset.id,
      endCardAssetId: logoAsset.id,
      isGlobal: true,
      isActive: true,
    },
  });
  console.log("✅ 全局品牌包：Aivora Clean");
}

async function main() {
  await seedPlanEntitlements();
  await seedAdmin();
  await seedDemoPersonalUser();
  await seedStyleTemplates();
  await seedGlobalBrandPackages();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
