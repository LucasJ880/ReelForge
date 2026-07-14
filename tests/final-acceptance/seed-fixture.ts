import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { Prisma, StyleTemplateStatus } from "@prisma/client";
import { db } from "../../src/lib/db";
import {
  FINAL_ACCEPTANCE_EMAIL,
  FINAL_ACCEPTANCE_PASSWORD,
  FINAL_ACCEPTANCE_TEMPLATE_SLUG,
  RUN_STATE_PATH,
} from "./fixture-data";

export {
  FINAL_ACCEPTANCE_EMAIL,
  FINAL_ACCEPTANCE_PASSWORD,
  FINAL_ACCEPTANCE_TEMPLATE_SLUG,
  RUN_STATE_PATH,
} from "./fixture-data";

async function main() {
  const runId = process.env.FINAL_ACCEPTANCE_RUN_ID;
  if (!runId) throw new Error("缺少 FINAL_ACCEPTANCE_RUN_ID");
  if (process.env.FINAL_ACCEPTANCE_REQUIRE_REHEARSAL === "true") {
    const databaseUrl = process.env.DATABASE_URL;
    const rehearsalDatabaseUrl = process.env.NEON_REHEARSAL_DATABASE_URL;
    if (!databaseUrl || !rehearsalDatabaseUrl) {
      throw new Error("最终验收缺少演练分支数据库配置");
    }
    if (databaseUrl !== rehearsalDatabaseUrl) {
      throw new Error("最终验收 DATABASE_URL 必须与 NEON_REHEARSAL_DATABASE_URL 完全一致");
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
