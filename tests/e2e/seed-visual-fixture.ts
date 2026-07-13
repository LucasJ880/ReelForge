import bcrypt from "bcryptjs";
import { Prisma, StyleTemplateStatus } from "@prisma/client";
import { db } from "../../src/lib/db";
import { BATCH_STYLE_TEMPLATE_SEEDS } from "../../src/lib/video-generation/batch-style-templates";

const email = "demo@aivora.app";
const password = "aivora2026";

async function main() {
  await db.adminUser.upsert({
    where: { email },
    update: {
      name: "Editorial Studio QA",
      userType: "PERSONAL",
      hashedPassword: await bcrypt.hash(password, 10),
    },
    create: {
      email,
      name: "Editorial Studio QA",
      userType: "PERSONAL",
      role: "OPERATOR",
      hashedPassword: await bcrypt.hash(password, 10),
    },
  });

  const template = BATCH_STYLE_TEMPLATE_SEEDS[0];
  await db.styleTemplate.upsert({
    where: {
      slug_version: { slug: template.slug, version: template.version },
    },
    update: {
      status: StyleTemplateStatus.ACTIVE,
      activatedAt: new Date(),
    },
    create: {
      ...template,
      lockedParams: template.lockedParams as unknown as Prisma.InputJsonValue,
      imagesPerVideo:
        template.imagesPerVideo as unknown as Prisma.InputJsonValue,
      status: StyleTemplateStatus.ACTIVE,
      activatedAt: new Date(),
    },
  });
}

main()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error("[visual-fixture] seed failed", error);
    process.exitCode = 1;
  });
