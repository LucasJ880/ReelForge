import { db } from "@/lib/db";
import { seedBatchStyleTemplates } from "@/lib/services/style-template-service";
import { BATCH_STYLE_TEMPLATE_SEEDS } from "@/lib/video-generation/batch-style-templates";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be supplied explicitly");
  }
  const created = await seedBatchStyleTemplates();
  const seededSlugs = BATCH_STYLE_TEMPLATE_SEEDS.map((template) => template.slug);
  const [seededActive, otherActive, total] = await Promise.all([
    db.styleTemplate.count({ where: { status: "ACTIVE", slug: { in: seededSlugs } } }),
    db.styleTemplate.count({ where: { status: "ACTIVE", slug: { notIn: seededSlugs } } }),
    db.styleTemplate.count(),
  ]);
  console.log(JSON.stringify({ created, seededActive, otherActive, total }));
  if (seededActive !== BATCH_STYLE_TEMPLATE_SEEDS.length) {
    throw new Error(`Expected ${BATCH_STYLE_TEMPLATE_SEEDS.length} active seeded templates, found ${seededActive}`);
  }
}

main()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Template seed failed");
    process.exitCode = 1;
  });
