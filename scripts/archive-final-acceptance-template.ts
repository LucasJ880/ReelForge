import { StyleTemplateStatus } from "@prisma/client";
import { db } from "../src/lib/db";

const slug = "final-acceptance-one-image";
const target = process.argv.find((arg) => arg.startsWith("--target="))?.split("=")[1];

async function main() {
  if (target !== "rehearsal" && target !== "production") {
    throw new Error("Use --target=rehearsal or --target=production");
  }
  const databaseUrl = process.env.DATABASE_URL;
  const rehearsalUrl = process.env.NEON_REHEARSAL_DATABASE_URL;
  if (!databaseUrl || !rehearsalUrl) {
    throw new Error("DATABASE_URL and NEON_REHEARSAL_DATABASE_URL are required");
  }
  if (target === "rehearsal" && databaseUrl !== rehearsalUrl) {
    throw new Error("Rehearsal target must use NEON_REHEARSAL_DATABASE_URL");
  }
  if (target === "production" && databaseUrl === rehearsalUrl) {
    throw new Error("Production target must not use the rehearsal database URL");
  }

  const before = await db.styleTemplate.findUnique({
    where: { slug_version: { slug, version: 1 } },
    select: {
      id: true,
      name: true,
      category: true,
      status: true,
      _count: { select: { batchJobs: true } },
    },
  });
  if (!before) {
    console.log(JSON.stringify({ target, result: "not_present" }));
    return;
  }
  if (before.name !== "Final Acceptance One Image" || before.category !== "自动化验收") {
    throw new Error("Template identity mismatch; refusing to mutate");
  }

  const changed = await db.styleTemplate.updateMany({
    where: {
      id: before.id,
      slug,
      version: 1,
      name: before.name,
      category: before.category,
      status: StyleTemplateStatus.ACTIVE,
    },
    data: {
      status: StyleTemplateStatus.ARCHIVED,
      activatedAt: null,
    },
  });
  const after = await db.styleTemplate.findUniqueOrThrow({
    where: { id: before.id },
    select: { status: true, _count: { select: { batchJobs: true } } },
  });
  if (after.status !== StyleTemplateStatus.ARCHIVED) {
    throw new Error("Postcondition failed: acceptance fixture is not archived");
  }
  if (after._count.batchJobs !== before._count.batchJobs) {
    throw new Error("Postcondition failed: batch reference count changed");
  }

  console.log(JSON.stringify({
    target,
    result: "archived",
    previousStatus: before.status,
    changedCount: changed.count,
    preservedBatchReferenceCount: after._count.batchJobs,
  }));
}

main()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "archive failed");
    process.exitCode = 1;
  });
