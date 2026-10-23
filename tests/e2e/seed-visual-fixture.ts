import bcrypt from "bcryptjs";
import { Prisma, StyleTemplateStatus } from "@prisma/client";
import { db } from "../../src/lib/db";
import { BATCH_STYLE_TEMPLATE_SEEDS } from "../../src/lib/video-generation/batch-style-templates";
import { isDemoAccountEmail, isReservedTestEmail } from "../../src/lib/demo-account";

/// playwright.config.ts 的 webServer 会带着 .env.local（= 生产库）跑本脚本。
/// 以前这里写死演示账号和它的公开密码，每跑一次视觉测试就把生产上的密码重置回
/// 公开值。现在：凭据只从环境变量来；只允许写保留测试域名（*@aivora.test 等）的
/// 专用账号，这类账号在真实生产里本来就登录不了（src/lib/demo-account.ts）；
/// 新建的是普通客户而不是内部员工。
const email = process.env.E2E_LOGIN_EMAIL;
const password = process.env.E2E_LOGIN_PASSWORD;

async function main() {
  if (!email || !password) {
    console.log("[visual-fixture] 未设置 E2E_LOGIN_EMAIL / E2E_LOGIN_PASSWORD，跳过测试账号写入");
  } else if (!isReservedTestEmail(email) || isDemoAccountEmail(email)) {
    throw new Error(
      `[visual-fixture] E2E_LOGIN_EMAIL 必须是专用测试账号（如 visual-qa@aivora.test），拒绝改写 ${email}`,
    );
  } else {
    await upsertFixtureUser(email, password);
  }
  await upsertFixtureTemplate();
}

async function upsertFixtureUser(email: string, password: string) {
  const hashedPassword = await bcrypt.hash(password, 10);
  await db.adminUser.upsert({
    where: { email },
    update: { name: "Editorial Studio QA", userType: "PERSONAL", hashedPassword },
    create: {
      email,
      name: "Editorial Studio QA",
      userType: "PERSONAL",
      role: "CUSTOMER",
      hashedPassword,
    },
  });
}

async function upsertFixtureTemplate() {
  const template = BATCH_STYLE_TEMPLATE_SEEDS[0];
  await db.styleTemplate.upsert({
    where: {
      slug_version: { slug: template.slug, version: template.version },
    },
    update: {
      status: StyleTemplateStatus.ACTIVE,
      activatedAt: new Date(),
    },
    create: {
      ...template,
      lockedParams: template.lockedParams as unknown as Prisma.InputJsonValue,
      imagesPerVideo:
        template.imagesPerVideo as unknown as Prisma.InputJsonValue,
      status: StyleTemplateStatus.ACTIVE,
      activatedAt: new Date(),
    },
  });
}

main()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error("[visual-fixture] seed failed", error);
    process.exitCode = 1;
  });
