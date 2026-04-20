import { PrismaClient, AdminRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@reelforge.local";
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    console.log(
      "⚠️  SEED_ADMIN_PASSWORD 未设置，跳过 seed。请在 .env.local 中配置 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD 再运行 npm run db:seed。",
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
    },
  });
  console.log(`✅ 已创建超级管理员：${admin.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
