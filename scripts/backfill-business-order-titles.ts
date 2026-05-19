/**
 * 将历史商家订单的英文 title 回填为中文展示标题。
 *
 *   npm run backfill:business-titles              # 仅更新「当前为英文、推导为中文」的项
 *   npm run backfill:business-titles -- --dry-run
 *   npm run backfill:business-titles -- --force   # 强制按 productInput 重算全部 BUSINESS 标题
 *   npm run backfill:business-titles -- --email=sunny-shutter@aivora.test
 */
import { db } from "../src/lib/db";
import {
  resolveBusinessOrderTitleFromOrder,
  shouldUpdateBusinessTitle,
} from "../src/lib/services/business-order-title-service";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const emailArg = process.argv.find((a) => a.startsWith("--email="));
const emailFilter = emailArg?.slice("--email=".length);

async function main() {
  console.log("=== Backfill business order titles ===\n");
  if (dryRun) console.log("(dry-run — 不会写入数据库)\n");

  const orders = await db.deliveryOrder.findMany({
    where: emailFilter
      ? { createdBy: { email: emailFilter } }
      : undefined,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      targetLanguage: true,
      targetPlatform: true,
      productInput: true,
      createdBy: { select: { email: true } },
      rounds: {
        orderBy: { roundIndex: "desc" },
        take: 1,
        select: {
          angles: {
            take: 1,
            select: {
              videoBrief: {
                select: { persona: true, durationSec: true },
              },
            },
          },
        },
      },
    },
  });

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for (const order of orders) {
    const brief = order.rounds[0]?.angles[0]?.videoBrief;
    if (brief?.persona === "PERSONAL") {
      skipped += 1;
      continue;
    }

    scanned += 1;
    const nextTitle = resolveBusinessOrderTitleFromOrder({
      title: order.title,
      targetLanguage: order.targetLanguage,
      targetPlatform: order.targetPlatform,
      productInput: order.productInput,
      durationSec: brief?.durationSec ?? null,
    });

    if (!shouldUpdateBusinessTitle(order.title, nextTitle, { force })) {
      skipped += 1;
      continue;
    }

    const who = order.createdBy?.email ?? "unknown";
    console.log(
      `  [${who}] ${order.id.slice(0, 8)}…\n    ${order.title}\n    → ${nextTitle}`,
    );

    if (!dryRun) {
      await db.deliveryOrder.update({
        where: { id: order.id },
        data: { title: nextTitle },
      });
    }
    updated += 1;
  }

  console.log(
    `\n完成：扫描 ${scanned} 条商家订单，更新 ${updated} 条，跳过 ${skipped} 条。`,
  );
}

main()
  .catch((err) => {
    console.error("\n❌ Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
