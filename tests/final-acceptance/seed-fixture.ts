import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { Prisma, StyleTemplateStatus } from "@prisma/client";
import { db } from "../../src/lib/db";
import {
  FINAL_ACCEPTANCE_ASSET_COUNT,
  FINAL_ACCEPTANCE_ASSET_PREFIX,
  FINAL_ACCEPTANCE_EMAIL,
  FINAL_ACCEPTANCE_PASSWORD,
  FINAL_ACCEPTANCE_TEMPLATE_SLUG,
  RUN_STATE_PATH,
} from "./fixture-data";
import { assertFinalAcceptanceRehearsal } from "./rehearsal-safety";

export {
  FINAL_ACCEPTANCE_EMAIL,
  FINAL_ACCEPTANCE_PASSWORD,
  FINAL_ACCEPTANCE_TEMPLATE_SLUG,
  RUN_STATE_PATH,
} from "./fixture-data";

async function main() {
  const runId = process.env.FINAL_ACCEPTANCE_RUN_ID;
  if (!runId) throw new Error("缺少 FINAL_ACCEPTANCE_RUN_ID");
  assertFinalAcceptanceRehearsal();

  const acceptanceUser = await db.adminUser.upsert({
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

  // An interrupted rehearsal must not leave RUNNING mock jobs occupying every
  // provider slot in the next run. Scope cleanup to the fixed QA account and
  // disposable onboarding accounts on the `.invalid` test domain only.
  const onboardingUsers = await db.adminUser.findMany({
    where: {
      AND: [
        { email: { startsWith: "onboarding-" } },
        { email: { endsWith: "@aivora.invalid" } },
      ],
    },
    select: { id: true },
  });
  const cleanupUserIds = [
    acceptanceUser.id,
    ...onboardingUsers.map((user) => user.id),
  ];
  const cleanup = await db.$transaction(async (tx) => {
    const batches = await tx.batchJob.deleteMany({
      where: { userId: { in: cleanupUserIds } },
    });
    const orders = await tx.deliveryOrder.deleteMany({
      where: { createdById: { in: cleanupUserIds } },
    });
    const onboardingAccounts =
      onboardingUsers.length === 0
        ? { count: 0 }
        : await tx.adminUser.deleteMany({
            where: { id: { in: onboardingUsers.map((user) => user.id) } },
          });
    return {
      batches: batches.count,
      orders: orders.count,
      onboardingAccounts: onboardingAccounts.count,
    };
  });

  await mkdir(path.dirname(RUN_STATE_PATH), { recursive: true });
  await writeFile(
    RUN_STATE_PATH,
    JSON.stringify(
      { runId, batchIds: [], seededAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      evt: "final_acceptance_orphan_cleanup",
      deletedBatchCount: cleanup.batches,
      deletedOrderCount: cleanup.orders,
      deletedOnboardingAccountCount: cleanup.onboardingAccounts,
    }),
  );
  const workspace = await db.workspace.upsert({
    where: { ownerId: acceptanceUser.id },
    update: { planId: "studio", name: "Final Acceptance QA" },
    create: {
      ownerId: acceptanceUser.id,
      planId: "studio",
      name: "Final Acceptance QA",
    },
  });

  const acceptanceAssetUrl = `${process.env.FINAL_ACCEPTANCE_BASE_URL ?? "http://localhost:3100"}/file.svg`;
  await Promise.all(
    Array.from({ length: FINAL_ACCEPTANCE_ASSET_COUNT }, (_, index) => {
      const ordinal = index + 1;
      const id = `${FINAL_ACCEPTANCE_ASSET_PREFIX}-${ordinal}`;
      return db.mediaAsset.upsert({
        where: { id },
        update: {
          userId: acceptanceUser.id,
          workspaceId: workspace.id,
          url: acceptanceAssetUrl,
          mimeType: "image/svg+xml",
        },
        create: {
          id,
          userId: acceptanceUser.id,
          workspaceId: workspace.id,
          storageKey: `final-acceptance/assets/${ordinal}.svg`,
          url: acceptanceAssetUrl,
          mimeType: "image/svg+xml",
          byteSize: 537,
          sha256: `final-acceptance-${ordinal}`,
          width: 512,
          height: 512,
        },
      });
    }),
  );

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
