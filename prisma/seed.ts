import {
  Prisma,
  PrismaClient,
  AdminRole,
  StyleTemplateStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { BATCH_STYLE_TEMPLATE_SEEDS } from "../src/lib/video-generation/batch-style-templates";

const prisma = new PrismaClient();

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
        userType: "PERSONAL",
        hashedPassword: await bcrypt.hash(password, 10),
      },
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
      role: AdminRole.OPERATOR,
      userType: "PERSONAL",
    },
  });
  console.log(`✅ 已创建 Demo 个人账号：${demo.email}（密码：${password}）`);
}

async function seedStyleTemplates() {
  const result = await prisma.styleTemplate.createMany({
    data: BATCH_STYLE_TEMPLATE_SEEDS.map((template) => ({
      ...template,
      lockedParams: template.lockedParams as unknown as Prisma.InputJsonValue,
      imagesPerVideo:
        template.imagesPerVideo as unknown as Prisma.InputJsonValue,
      status: StyleTemplateStatus.ACTIVE,
      activatedAt: new Date(),
    })),
    skipDuplicates: true,
  });
  console.log(
    `✅ 批量风格模板：新增 ${result.count}，总定义 ${BATCH_STYLE_TEMPLATE_SEEDS.length}`,
  );
}

async function main() {
  await seedAdmin();
  await seedDemoPersonalUser();
  await seedStyleTemplates();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
