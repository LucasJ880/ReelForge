import { readFile } from "node:fs/promises";
import path from "node:path";
import { StyleTemplateStatus } from "@prisma/client";
import { db } from "../../src/lib/db";
import { getStorageProvider } from "../../src/lib/storage";
import {
  FINAL_ACCEPTANCE_EMAIL,
  FINAL_ACCEPTANCE_TEMPLATE_SLUG,
} from "./framework";

interface RunState {
  runId: string;
  batchIds: string[];
}

export default async function globalTeardown() {
  const statePath = path.join(
    process.cwd(),
    "test-results/final-acceptance/run-state.json",
  );
  try {
    const state = JSON.parse(await readFile(statePath, "utf8")) as RunState;
    const batchIds = [...new Set(state.batchIds.filter(Boolean))];
    if (batchIds.length > 0) {
      await db.batchJob.deleteMany({ where: { id: { in: batchIds } } });
    }
    const archivedTemplate = await db.styleTemplate.updateMany({
      where: {
        slug: FINAL_ACCEPTANCE_TEMPLATE_SLUG,
        version: 1,
        category: "自动化验收",
        status: StyleTemplateStatus.ACTIVE,
      },
      data: {
        status: StyleTemplateStatus.ARCHIVED,
        activatedAt: null,
      },
    });
    const account = await db.adminUser.findUnique({
      where: { email: FINAL_ACCEPTANCE_EMAIL },
      select: { id: true },
    });
    let deletedProductImageCount = 0;
    if (account) {
      const productImages = await db.productImageJob.findMany({
        where: { userId: account.id },
        select: { id: true, sourceImageUrl: true },
      });
      const storage = getStorageProvider();
      for (const job of productImages) {
        if (!job.sourceImageUrl || !storage.isConfigured()) continue;
        try {
          const key = new URL(job.sourceImageUrl).pathname.replace(/^\/+/, "");
          await storage.deleteObject("uploads", key);
        } catch {
          // Cleanup is best effort and must not hide acceptance results.
        }
      }
      const deleted = await db.productImageJob.deleteMany({
        where: { id: { in: productImages.map((job) => job.id) } },
      });
      deletedProductImageCount = deleted.count;
    }
    console.log(
      JSON.stringify({
        evt: "final_acceptance_cleanup",
        runId: state.runId,
        deletedBatchCount: batchIds.length,
        deletedProductImageCount,
        archivedTemplateCount: archivedTemplate.count,
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
