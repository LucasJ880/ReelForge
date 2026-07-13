import type { PrismaClient } from "@prisma/client";

async function scalar(db: PrismaClient, sql: string): Promise<number> {
  const rows = (await db.$queryRawUnsafe(sql)) as Array<{ count: bigint | number }>;
  return Number(rows[0]?.count ?? 0);
}

async function main(): Promise<void> {
  const target = process.argv.includes("--target=production") ? "production" : "rehearsal";
  const url =
    target === "production"
      ? process.env.DATABASE_URL
      : process.env.NEON_REHEARSAL_DATABASE_URL;
  if (!url) {
    throw new Error(
      target === "production"
        ? "DATABASE_URL is required for production verification"
        : "NEON_REHEARSAL_DATABASE_URL is required",
    );
  }
  process.env.DATABASE_URL = url;
  const { db } = await import("../src/lib/db");

  const [
    users,
    workspaces,
    duplicateWorkspaceOwners,
    planMappingMismatches,
    unexpectedCustomerPersonaRoles,
    customerAccounts,
    preservedSuperAdmins,
    quarantineColumns,
  ] = await Promise.all([
    scalar(db, `SELECT COUNT(*) AS count FROM "AdminUser"`),
    scalar(db, `SELECT COUNT(*) AS count FROM "Workspace"`),
    scalar(
      db,
      `SELECT COUNT(*) AS count FROM (SELECT "ownerId" FROM "Workspace" GROUP BY "ownerId" HAVING COUNT(*) <> 1) duplicates`,
    ),
    scalar(
      db,
      `SELECT COUNT(*) AS count
       FROM "AdminUser" u JOIN "Workspace" w ON w."ownerId" = u."id"
       WHERE w."planId" <> CASE WHEN u."userType" = 'BUSINESS' THEN 'studio' ELSE 'starter' END`,
    ),
    scalar(
      db,
      `SELECT COUNT(*) AS count FROM "AdminUser"
       WHERE "userType" IN ('BUSINESS', 'PERSONAL')
         AND "role" NOT IN ('CUSTOMER', 'SUPER_ADMIN')`,
    ),
    scalar(db, `SELECT COUNT(*) AS count FROM "AdminUser" WHERE "role" = 'CUSTOMER'`),
    scalar(db, `SELECT COUNT(*) AS count FROM "AdminUser" WHERE "role" = 'SUPER_ADMIN'`),
    scalar(
      db,
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('BatchJob', 'VideoJob')
         AND column_name IN ('dispatchQuarantineDecision', 'dispatchQuarantineAt', 'dispatchQuarantineBy')`,
    ),
  ]);

  const plans = await db.$queryRaw<
    Array<{
      id: string;
      monthlyVideoLimit: number;
      batchConcurrencyLimit: number;
      templateLibraryAccess: string;
      featureFlags: unknown;
    }>
  >`SELECT "id", "monthlyVideoLimit", "batchConcurrencyLimit", "templateLibraryAccess", "featureFlags"
    FROM "PlanEntitlement" ORDER BY "id"`;

  const checks = {
    workspacePerUser: users === workspaces && duplicateWorkspaceOwners === 0,
    planMapping: planMappingMismatches === 0,
    roleMapping: unexpectedCustomerPersonaRoles === 0,
    quarantineSchema: quarantineColumns === 6,
    planRows:
      plans.length === 2 &&
      plans.every((plan) =>
        plan.id === "starter"
          ? plan.monthlyVideoLimit === 30 && plan.batchConcurrencyLimit === 10
          : plan.id === "studio" &&
            plan.monthlyVideoLimit === 200 &&
            plan.batchConcurrencyLimit === 10,
      ),
  };

  process.stdout.write(
    JSON.stringify(
      {
        target,
        branch: target === "production" ? null : "phase1-rehearsal-20260713",
        checks,
        counts: {
          users,
          workspaces,
          customerAccounts,
          preservedSuperAdmins,
          duplicateWorkspaceOwners,
          planMappingMismatches,
          unexpectedCustomerPersonaRoles,
          quarantineColumns,
        },
        plans,
        passed: Object.values(checks).every(Boolean),
      },
      null,
      2,
    ) + "\n",
  );
  await db.$disconnect();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "verification failed"}\n`);
  process.exitCode = 1;
});
