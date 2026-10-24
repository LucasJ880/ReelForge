/**
 * 模板框架版本 2 重新入库前的只读预演：列出将新建的版本、将被归档的 ACTIVE 行，
 * 以及预演后 ACTIVE 总数。只读，不写库。
 *
 * 用法：
 *   npx tsx --env-file=.env.local scripts/e2e-1025/template-reseed-dry-run.ts
 */
import { StyleTemplateStatus } from "@prisma/client";
import { db } from "../../src/lib/db";
import { BATCH_STYLE_TEMPLATE_SEEDS } from "../../src/lib/video-generation/batch-style-templates";

async function main() {
  const active = await db.styleTemplate.findMany({
    where: { status: StyleTemplateStatus.ACTIVE },
    select: { slug: true, version: true, category: true },
  });
  const activeBySlug = new Map(active.map((row) => [row.slug, row]));
  const seedSlugs = new Set(BATCH_STYLE_TEMPLATE_SEEDS.map((seed) => seed.slug));

  const toCreate: string[] = [];
  const unchanged: string[] = [];
  for (const seed of BATCH_STYLE_TEMPLATE_SEEDS) {
    const exists = await db.styleTemplate.findUnique({
      where: { slug_version: { slug: seed.slug, version: seed.version } },
      select: { id: true },
    });
    const current = activeBySlug.get(seed.slug);
    if (exists) unchanged.push(`${seed.slug}@v${seed.version}`);
    else toCreate.push(`${seed.slug}: v${current?.version ?? "—"} → v${seed.version}`);
  }
  const archivedNotInSeed = active
    .filter((row) => !seedSlugs.has(row.slug) && row.category !== "自动化验收")
    .map((row) => `${row.slug}@v${row.version}`);

  const activeAfter =
    active.filter((row) => seedSlugs.has(row.slug) || row.category === "自动化验收").length +
    BATCH_STYLE_TEMPLATE_SEEDS.filter((seed) => !activeBySlug.has(seed.slug)).length;

  console.log(JSON.stringify({
    activeNow: active.length,
    seeds: BATCH_STYLE_TEMPLATE_SEEDS.length,
    toCreate,
    unchanged,
    archivedNotInSeed,
    activeAfter,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
