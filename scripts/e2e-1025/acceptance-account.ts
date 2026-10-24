/**
 * 1025 真机验收账号：与自助注册同构（CUSTOMER + starter 工作区），非额度豁免，
 * 这样「只为交付计费 / 取消返还」的验收才不会空跑。
 *
 * - 幂等：已存在则只重置密码与停用状态；
 * - 密码随机生成，只写本机 secret 文件（不进仓库、不打印）；
 * - 收尾用 --disable 停用账号（铁律：不删除，只停用 / 归档）。
 *
 * 用法：
 *   npx tsx --env-file=.env.local scripts/e2e-1025/acceptance-account.ts --secret=<file> [--email=...] [--disable]
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { db } from "../../src/lib/db";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"] as const;
  }),
);

const email = (args.get("email") ?? "lucas+e2e1025@sunnyshutter.ca").toLowerCase();
const secretFile = args.get("secret");

async function main() {
  if (args.get("disable") === "true") {
    const user = await db.adminUser.update({
      where: { email },
      data: { disabledAt: new Date(), disabledReason: "1025 真机验收结束，停用验收账号" },
      select: { id: true },
    });
    console.log(JSON.stringify({ disabled: user.id }));
    return;
  }
  if (!secretFile) throw new Error("--secret=<file> is required (password is written there, never printed)");

  const password = randomBytes(18).toString("base64url");
  const hashedPassword = await bcrypt.hash(password, 12);
  const existing = await db.adminUser.findUnique({ where: { email }, select: { id: true } });
  const user = existing
    ? await db.adminUser.update({
        where: { email },
        data: { hashedPassword, disabledAt: null, disabledReason: null },
        select: { id: true, role: true, userType: true, workspace: { select: { id: true, planId: true } } },
      })
    : await db.adminUser.create({
        data: {
          email,
          name: "1025 验收商家",
          hashedPassword,
          role: "CUSTOMER",
          userType: "BUSINESS",
          workspace: { create: { name: "1025 验收商家", planId: "starter" } },
        },
        select: { id: true, role: true, userType: true, workspace: { select: { id: true, planId: true } } },
      });

  if (user.role !== "CUSTOMER") throw new Error(`验收账号角色必须是 CUSTOMER（当前 ${user.role}），否则额度验收会被豁免`);
  writeFileSync(secretFile, `${email}\n${password}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ userId: user.id, workspaceId: user.workspace?.id, planId: user.workspace?.planId, created: !existing }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
