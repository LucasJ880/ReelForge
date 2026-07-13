import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

function requireSecret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertRoleName(role: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(role)) {
    throw new Error("Production app role contains unsupported characters");
  }
  return role;
}

async function main() {
  const ownerUrl = requireSecret("NEON_PRODUCTION_OWNER_DATABASE_URL");
  const appUrl = requireSecret("DATABASE_URL");
  const owner = new URL(ownerUrl);
  const app = new URL(appUrl);
  if (!owner.hostname.includes("us-east-1.aws.neon.tech")) {
    throw new Error("Production owner is not the approved Neon us-east-1 database");
  }
  if (!app.hostname.includes("us-east-1.aws.neon.tech")) {
    throw new Error("Production app database is not the approved Neon us-east-1 database");
  }
  const role = assertRoleName(decodeURIComponent(app.username));

  const migration = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: ownerUrl },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (migration.status !== 0) {
    throw new Error("Production migration failed; deployment stopped");
  }

  const ownerDb = new PrismaClient({ datasourceUrl: ownerUrl });
  try {
    await ownerDb.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await ownerDb.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`,
    );
    await ownerDb.$executeRawUnsafe(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`,
    );
  } finally {
    await ownerDb.$disconnect();
  }

  const appDb = new PrismaClient({ datasourceUrl: appUrl });
  try {
    const rows = await appDb.$queryRawUnsafe<Array<{ table_name: string | null }>>(
      `SELECT to_regclass('public."ProductImageJob"')::text AS table_name`,
    );
    if (!rows[0]?.table_name) throw new Error("ProductImageJob is not visible to the app role");
  } finally {
    await appDb.$disconnect();
  }

  process.stdout.write(
    JSON.stringify({
      productionMigrationApplied: true,
      productImageTableVisibleToAppRole: true,
      regionVerified: "us-east-1",
    }) + "\n",
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "migration failed"}\n`);
  process.exitCode = 1;
});
