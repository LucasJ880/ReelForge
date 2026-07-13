import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const PROJECT_ID = "weathered-dream-36367410";
const BRANCH = "phase1-rehearsal-20260713";
const OLD_APP_ROLE = "aivora_phase1_rehearsal";
const NEXT_APP_ROLE = "aivora_phase4_rehearsal";

function neonctl(args: string[]): string {
  const result = spawnSync("npx", ["--yes", "neonctl", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`neonctl ${args.slice(0, 2).join(" ")} failed`);
  return result.stdout ?? "";
}

function connection(role: string): string {
  const output = neonctl(["connection-string", BRANCH, "--project-id", PROJECT_ID, "--role-name", role, "--database-name", "neondb", "--ssl", "require", "--no-color"]);
  const match = output.match(/postgresql:\/\/[^\s]+/);
  if (!match) throw new Error("connection string unavailable");
  return match[0];
}

async function canConnect(url: string): Promise<boolean> {
  const client = new PrismaClient({ datasourceUrl: url });
  try { await client.$queryRawUnsafe("SELECT 1"); return true; }
  catch { return false; }
  finally { await client.$disconnect().catch(() => undefined); }
}

async function upsert(entries: Record<string, string>) {
  const file = path.join(process.cwd(), ".env.local");
  let body = await readFile(file, "utf8");
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${JSON.stringify(value)}`;
    const matcher = new RegExp(`^${key}=.*$`, "m");
    body = matcher.test(body) ? body.replace(matcher, line) : `${body.trimEnd()}\n${line}\n`;
  }
  await writeFile(file, body, { mode: 0o600 });
  await chmod(file, 0o600);
}

async function main() {
  const currentOwner = process.env.NEON_REHEARSAL_OWNER_DATABASE_URL;
  if (!currentOwner) throw new Error("owner credential missing");
  const ownerParsed = new URL(currentOwner);
  if (ownerParsed.username !== "neondb_owner") throw new Error("unexpected owner role");
  const nextPassword = randomBytes(36).toString("base64url");
  const owner = new PrismaClient({ datasourceUrl: currentOwner });
  try { await owner.$executeRawUnsafe(`ALTER ROLE "neondb_owner" WITH PASSWORD '${nextPassword}'`); }
  finally { await owner.$disconnect().catch(() => undefined); }
  ownerParsed.password = nextPassword;
  const nextOwner = ownerParsed.toString();
  if (await canConnect(currentOwner)) throw new Error("old owner credential remains valid");
  if (!(await canConnect(nextOwner))) throw new Error("rotated owner credential is invalid");

  const roles = JSON.parse(neonctl(["roles", "list", "--project-id", PROJECT_ID, "--branch", BRANCH, "--output", "json", "--no-color"])) as Array<{ name?: string }>;
  if (!roles.some((role) => role.name === NEXT_APP_ROLE)) neonctl(["roles", "create", "--project-id", PROJECT_ID, "--branch", BRANCH, "--name", NEXT_APP_ROLE, "--output", "json", "--no-color"]);
  const nextApp = connection(NEXT_APP_ROLE);
  if (!(await canConnect(nextApp))) throw new Error("new app role cannot connect");
  await upsert({ NEON_REHEARSAL_DATABASE_URL: nextApp, NEON_REHEARSAL_OWNER_DATABASE_URL: nextOwner });
  if (roles.some((role) => role.name === OLD_APP_ROLE)) neonctl(["roles", "delete", OLD_APP_ROLE, "--project-id", PROJECT_ID, "--branch", BRANCH, "--no-color"]);
  process.stdout.write(JSON.stringify({ rotated: true, oldOwnerRejected: true, newOwnerAccepted: true, newAppAccepted: true, oldAppRoleDeleted: true }) + "\n");
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "rotation failed"}\n`); process.exitCode = 1; });
