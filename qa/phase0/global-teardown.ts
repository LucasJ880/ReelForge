import { readFile } from "node:fs/promises";
import path from "node:path";
import { StyleTemplateStatus } from "@prisma/client";
import { db } from "../../src/lib/db";

export default async function globalTeardown() {
  try {
    const statePath = path.join(process.cwd(), "test-results/final-acceptance/run-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as { batchIds?: string[] };
    const batchIds = [...new Set((state.batchIds ?? []).filter(Boolean))];
    if (batchIds.length > 0) {
      await db.batchJob.deleteMany({ where: { id: { in: batchIds } } });
    }
    await db.styleTemplate.updateMany({
      where: {
        slug: "final-acceptance-one-image",
        version: 1,
        category: "自动化验收",
        status: StyleTemplateStatus.ACTIVE,
      },
      data: { status: StyleTemplateStatus.ARCHIVED, activatedAt: null },
    });
  } finally {
    await db.$disconnect();
  }
}
