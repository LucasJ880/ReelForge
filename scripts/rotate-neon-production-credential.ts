import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const PROJECT_ID = "weathered-dream-36367410";
const PROD_BRANCH = "production";
const PROD_APP_ROLE = "aivora_app_prod_20260713";
const OWNER_ROLE = "neondb_owner";

function run(command: string, args: string[], input?: string): string {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed`);
  }
  return result.stdout ?? "";
}

function neonctl(args: string[]): string {
  return run("npx", ["--yes", "neonctl", ...args]);
}

function extractUrl(output: string): string {
  const match = output.match(/postgresql:\/\/[^\s]+/);
  if (!match) throw new Error("Neon connection string was not returned");
  return match[0];
}

async function upsertEnv(entries: Record<string, string>): Promise<void> {
  const envPath = path.join(process.cwd(), ".env.local");
  let current = await readFile(envPath, "utf8");
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${JSON.stringify(value)}`;
    const matcher = new RegExp(`^${key}=.*$`, "m");
    current = matcher.test(current)
      ? current.replace(matcher, line)
      : `${current.replace(/\s*$/, "")}\n${line}\n`;
  }
  await writeFile(envPath, current, { encoding: "utf8", mode: 0o600 });
  await chmod(envPath, 0o600);
}

async function canConnect(url: string): Promise<boolean> {
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    await client.$queryRawUnsafe(`SELECT 1 AS ok`);
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

async function prepare(): Promise<void> {
  const oldOwnerUrl = process.env.DATABASE_URL;
  if (!oldOwnerUrl) throw new Error("DATABASE_URL is required");
  const old = new URL(oldOwnerUrl);
  if (old.username !== OWNER_ROLE || !old.hostname.includes("us-east-1.aws.neon.tech")) {
    throw new Error("Current DATABASE_URL is not the expected Neon owner connection");
  }

  const roles = JSON.parse(
    neonctl([
      "roles",
      "list",
      "--project-id",
      PROJECT_ID,
      "--branch",
      PROD_BRANCH,
      "--output",
      "json",
      "--no-color",
    ]),
  ) as Array<{ name?: string }>;
  if (!roles.some((role) => role.name === PROD_APP_ROLE)) {
    neonctl([
      "roles",
      "create",
      "--project-id",
      PROJECT_ID,
      "--branch",
      PROD_BRANCH,
      "--name",
      PROD_APP_ROLE,
      "--output",
      "json",
      "--no-color",
    ]);
  }

  const appUrl = extractUrl(
    neonctl([
      "connection-string",
      PROD_BRANCH,
      "--project-id",
      PROJECT_ID,
      "--role-name",
      PROD_APP_ROLE,
      "--database-name",
      "neondb",
      "--pooled",
      "--ssl",
      "require",
      "--no-color",
    ]),
  );
  if (!(await canConnect(appUrl))) throw new Error("New production app role cannot connect");

  run(
    "vercel",
    ["env", "add", "DATABASE_URL", "production", "--force", "--sensitive", "--yes"],
    `${appUrl}\n`,
  );
  await upsertEnv({
    DATABASE_URL: appUrl,
    NEON_PRODUCTION_OWNER_DATABASE_URL: oldOwnerUrl,
  });

  process.stdout.write(
    JSON.stringify({
      prepared: true,
      productionRole: PROD_APP_ROLE,
      vercelDatabaseUrlUpdated: true,
      ownerCredentialStillValidUntilFinalize: true,
    }) + "\n",
  );
}

async function rotateOwner(url: string): Promise<{ nextUrl: string; oldRejected: boolean; nextAccepted: boolean }> {
  const parsed = new URL(url);
  if (parsed.username !== OWNER_ROLE) throw new Error("Owner URL has unexpected role");
  const nextPassword = randomBytes(36).toString("base64url");
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    await client.$executeRawUnsafe(`ALTER ROLE "${OWNER_ROLE}" WITH PASSWORD '${nextPassword}'`);
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
  parsed.password = nextPassword;
  const nextUrl = parsed.toString();
  return {
    nextUrl,
    oldRejected: !(await canConnect(url)),
    nextAccepted: await canConnect(nextUrl),
  };
}

async function finalize(): Promise<void> {
  const prodOwnerUrl = process.env.NEON_PRODUCTION_OWNER_DATABASE_URL;
  const rehearsalOwnerUrl = process.env.NEON_REHEARSAL_OWNER_DATABASE_URL;
  const appUrl = process.env.DATABASE_URL;
  if (!prodOwnerUrl || !rehearsalOwnerUrl || !appUrl) {
    throw new Error("Production/rehearsal owner URLs and DATABASE_URL are required");
  }
  if (!(await canConnect(appUrl))) throw new Error("Production app role is not healthy");

  const production = await rotateOwner(prodOwnerUrl);
  const rehearsal = await rotateOwner(rehearsalOwnerUrl);
  if (!production.oldRejected || !production.nextAccepted) {
    throw new Error("Production owner rotation could not be verified");
  }
  if (!rehearsal.oldRejected || !rehearsal.nextAccepted) {
    throw new Error("Rehearsal owner rotation could not be verified");
  }

  await upsertEnv({
    NEON_PRODUCTION_OWNER_DATABASE_URL: production.nextUrl,
    NEON_REHEARSAL_OWNER_DATABASE_URL: rehearsal.nextUrl,
  });
  process.stdout.write(
    JSON.stringify({
      finalized: true,
      productionOldCredentialRejected: production.oldRejected,
      productionNewCredentialAccepted: production.nextAccepted,
      rehearsalOldCredentialRejected: rehearsal.oldRejected,
      rehearsalNewCredentialAccepted: rehearsal.nextAccepted,
      productionAppRoleAccepted: true,
    }) + "\n",
  );
}

const mode = process.argv[2];
const action = mode === "prepare" ? prepare : mode === "finalize" ? finalize : null;
if (!action) {
  process.stderr.write("Usage: tsx scripts/rotate-neon-production-credential.ts <prepare|finalize>\n");
  process.exitCode = 1;
} else {
  action().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "rotation failed"}\n`);
    process.exitCode = 1;
  });
}
