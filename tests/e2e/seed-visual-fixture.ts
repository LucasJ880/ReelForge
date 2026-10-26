import bcrypt from "bcryptjs";
import { Prisma, StyleTemplateStatus } from "@prisma/client";
import { BATCH_STYLE_TEMPLATE_SEEDS } from "../../src/lib/video-generation/batch-style-templates";
import { isDemoAccountEmail, isReservedTestEmail } from "../../src/lib/demo-account";
import { decideE2eSeedTarget, readProductionDatabaseUrls } from "./e2e-db-guard";

/// playwright.config.ts 的 webServer 会带着 .env.local（= 生产库）跑本脚本。
/// 以前这里写死演示账号和它的公开密码，每跑一次视觉测试就把生产上的密码重置回
/// 公开值。现在：凭据只从环境变量来；只允许写保留测试域名（*@aivora.test 等）的
/// 专用账号，这类账号在真实生产里本来就登录不了（src/lib/demo-account.ts）；
/// 新建的是普通客户而不是内部员工。
///
/// 2026-10-25 审计 B9：在碰任何库之前先过 e2e-db-guard——没有专用 E2E 库
/// （E2E_DATABASE_URL）、也没有 CONFIRM_PRODUCTION_DB=e2e:seed 就退出码 1、一行不写。
/// db 改成动态 import：先把 DATABASE_URL 指到判定出来的库，再构造 Prisma 客户端。
const email = process.env.E2E_LOGIN_EMAIL;
const password = process.env.E2E_LOGIN_PASSWORD;

type Db = (typeof import("../../src/lib/db"))["db"];

/// 只有过了闸才会有值；finally 里据此断开连接。
let connected: Db | null = null;

async function main(): Promise<void> {
  const target = decideE2eSeedTarget(process.env, readProductionDatabaseUrls());
  if (!target.ok) {
    console.error(target.message);
    process.exitCode = 1;
    return;
  }
  if (target.target === "confirmed-production") {
    console.warn("[visual-fixture] CONFIRM_PRODUCTION_DB=e2e:seed：按确认写入 .env.local 指向的生产库");
  }
  process.env.DATABASE_URL = target.databaseUrl;
  const { db } = await import("../../src/lib/db");
  connected = db;

  if (!email || !password) {
    console.log("[visual-fixture] 未设置 E2E_LOGIN_EMAIL / E2E_LOGIN_PASSWORD，跳过测试账号写入");
  } else if (!isReservedTestEmail(email) || isDemoAccountEmail(email)) {
    throw new Error(
      `[visual-fixture] E2E_LOGIN_EMAIL 必须是专用测试账号（如 visual-qa@aivora.test），拒绝改写 ${email}`,
    );
  } else {
    await upsertFixtureUser(db, email, password);
  }
  await upsertFixtureTemplate(db);
}

async function upsertFixtureUser(db: Db, email: string, password: string) {
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

async function upsertFixtureTemplate(db: Db) {
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
  .catch((error) => {
    console.error("[visual-fixture] seed failed", error);
    process.exitCode = 1;
  })
  .finally(() => connected?.$disconnect());
