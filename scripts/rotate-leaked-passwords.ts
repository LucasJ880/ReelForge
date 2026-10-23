/**
 * 一次性运维：让曾经公开过的口令在数据库层面彻底失效。
 *
 * 演示账号的口令曾打进客户端登录页，几个脚本也曾用写死口令在 .env.local（= 生产库）
 * 里建过 `*@aivora.test` 的 OPERATOR 账号。新代码已在登录和 middleware 两处拦截，
 * 但旧的 Vercel 部署 URL 和其他分支的预览部署跑的还是旧代码、连的还是同一个库，
 * 只有把库里的哈希换掉才算真正作废。
 *
 * 范围：演示账号名单（src/lib/demo-account.ts）+ 保留测试域名（.test/.invalid/
 * .example/.localhost）的账号。只换 hashedPassword 为随机值，不删账号、不打印口令。
 * 会写生产库，必须显式确认：
 *
 *   CONFIRM_PRODUCTION_DB=ops:rotate-leaked-passwords npm run ops:rotate-leaked-passwords
 *
 * 只列出会受影响的账号、不写库：在上面命令末尾加 `-- --dry-run`。
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { demoAccountEmails, isReservedTestEmail } from "../src/lib/demo-account";

const RESERVED_TEST_TLDS = [".test", ".invalid", ".example", ".localhost"];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const candidates = await db.adminUser.findMany({
    where: {
      OR: [
        { email: { in: demoAccountEmails(), mode: "insensitive" } },
        ...RESERVED_TEST_TLDS.map((tld) => ({
          email: { endsWith: tld, mode: "insensitive" as const },
        })),
      ],
    },
    select: { id: true, email: true, role: true },
  });
  const targets = candidates.filter(
    (user) =>
      demoAccountEmails().includes(user.email.trim().toLowerCase()) ||
      isReservedTestEmail(user.email),
  );

  console.log(`[rotate-leaked-passwords] ${targets.length} 个账号${dryRun ? "（dry-run，不写库）" : ""}：`);
  for (const user of targets) console.log(`  - ${user.email} (${user.role})`);
  if (dryRun || targets.length === 0) return;

  for (const user of targets) {
    await db.adminUser.update({
      where: { id: user.id },
      data: { hashedPassword: await bcrypt.hash(randomBytes(32).toString("base64url"), 10) },
    });
  }
  console.log("[rotate-leaked-passwords] 已全部换成随机口令（未打印、未保存）。");
}

main()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error("[rotate-leaked-passwords] failed", error);
    process.exitCode = 1;
  });
