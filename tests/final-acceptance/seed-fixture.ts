import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { Prisma, StyleTemplateStatus } from "@prisma/client";
import { db } from "../../src/lib/db";

export const FINAL_ACCEPTANCE_EMAIL = "final-acceptance@aivora.app";
export const FINAL_ACCEPTANCE_PASSWORD = "aivora-final-acceptance-2026";
export const FINAL_ACCEPTANCE_TEMPLATE_SLUG = "final-acceptance-one-image";
export const RUN_STATE_PATH = path.join(
  process.cwd(),
  "test-results/final-acceptance/run-state.json",
);

async function main() {
  const runId = process.env.FINAL_ACCEPTANCE_RUN_ID;
  if (!runId) throw new Error("缺少 FINAL_ACCEPTANCE_RUN_ID");
  if (process.env.FINAL_ACCEPTANCE_REQUIRE_REHEARSAL === "true") {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("最终验收缺少 DATABASE_URL");
    const databaseHost = new URL(databaseUrl).hostname;
    if (!databaseHost.includes("us-east-1.aws.neon.tech")) {
      throw new Error("最终验收只允许写入 Neon us-east-1 演练分支");
    }
  }

  await mkdir(path.dirname(RUN_STATE_PATH), { recursive: true });
  await writeFile(
    RUN_STATE_PATH,
    JSON.stringify({ runId, batchIds: [], seededAt: new Date().toISOString() }, null, 2),
  );

  await db.adminUser.upsert({
    where: { email: FINAL_ACCEPTANCE_EMAIL },
    update: {
      name: "Final Acceptance QA",
      userType: "PERSONAL",
      hashedPassword: await bcrypt.hash(FINAL_ACCEPTANCE_PASSWORD, 10),
    },
    create: {
      email: FINAL_ACCEPTANCE_EMAIL,
      name: "Final Acceptance QA",
      userType: "PERSONAL",
      role: "OPERATOR",
      hashedPassword: await bcrypt.hash(FINAL_ACCEPTANCE_PASSWORD, 10),
    },
  });

  const lockedParams = {
    duration: 5,
    aspectRatio: "9:16",
    resolution: "720p",
    cameraStyle: "final acceptance deterministic fixture",
  };
  const imagesPerVideo = { min: 1, max: 1 };
  await db.styleTemplate.upsert({
    where: {
      slug_version: { slug: FINAL_ACCEPTANCE_TEMPLATE_SLUG, version: 1 },
    },
    update: {
      status: StyleTemplateStatus.ACTIVE,
      activatedAt: new Date(),
      coverImage: `${process.env.FINAL_ACCEPTANCE_BASE_URL ?? "http://localhost:3100"}/file.svg`,
      lockedParams: lockedParams as Prisma.InputJsonValue,
      imagesPerVideo: imagesPerVideo as Prisma.InputJsonValue,
    },
    create: {
      slug: FINAL_ACCEPTANCE_TEMPLATE_SLUG,
      version: 1,
      name: "Final Acceptance One Image",
      nameZh: "最终验收单图模板",
      category: "自动化验收",
      coverImage: `${process.env.FINAL_ACCEPTANCE_BASE_URL ?? "http://localhost:3100"}/file.svg`,
      promptSkeleton:
        "Product: {PRODUCT_NAME}. Reference: {IMAGE_REFS}. Keep the product stable.",
      negativePrompt: "morphing, flicker, unreadable label",
      lockedParams: lockedParams as Prisma.InputJsonValue,
      imagesPerVideo: imagesPerVideo as Prisma.InputJsonValue,
      status: StyleTemplateStatus.ACTIVE,
      activatedAt: new Date(),
    },
  });
}

main()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error("[final-acceptance:seed] failed", error);
    process.exitCode = 1;
  });
