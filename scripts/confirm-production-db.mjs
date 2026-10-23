#!/usr/bin/env node
/**
 * 直连生产库脚本的确认闸。
 *
 * `.env.local` 就是生产库：db:migrate（prisma migrate dev）可能要求重置库，
 * db:push 会让 schema 漂移，db:seed 曾把演示账号密码重置回公开值。
 * 这些命令都必须显式确认才放行，防止人或 AI 助手顺手一跑：
 *
 *   CONFIRM_PRODUCTION_DB=db:push npm run db:push
 *
 * 迁移的正路仍是 `npm run db:migrate:deploy`（owner 直连），见 CLAUDE.md §4。
 */

const scriptName = process.argv[2] ?? "";

if (!scriptName || process.env.CONFIRM_PRODUCTION_DB !== scriptName) {
  console.error(
    [
      `✋ ${scriptName || "该脚本"} 会直接作用于生产数据库（.env.local = 生产）。`,
      "迁移请用 npm run db:migrate:deploy。确实要执行的话：",
      `  CONFIRM_PRODUCTION_DB=${scriptName} npm run ${scriptName}`,
    ].join("\n"),
  );
  process.exit(1);
}
