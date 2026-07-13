import { chmod, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const PROJECT_ID = "weathered-dream-36367410";
const BRANCH = "phase1-rehearsal-20260713";
const ROLE = "aivora_phase1_rehearsal";
const ENV_KEY = "NEON_REHEARSAL_DATABASE_URL";
const OWNER_ENV_KEY = "NEON_REHEARSAL_OWNER_DATABASE_URL";

function neonctl(args: string[], allowFailure = false): string {
  const result = spawnSync("npx", ["--yes", "neonctl", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0 && !allowFailure) {
    throw new Error(`neonctl failed (${args.slice(0, 2).join(" ")})`);
  }
  return result.stdout ?? "";
}

async function neonConnectionString(args: string[]): Promise<string> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = spawnSync("npx", ["--yes", "neonctl", ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status === 0 && result.stdout?.includes("postgresql://")) {
      return result.stdout;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  throw new Error("neonctl connection-string did not become ready");
}

async function upsertLocalSecrets(entries: Record<string, string>): Promise<void> {
  const envPath = path.join(process.cwd(), ".env.local");
  let current = "";
  try {
    current = await readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  let next = current;
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${JSON.stringify(value)}`;
    const matcher = new RegExp(`^${key}=.*$`, "m");
    next = matcher.test(next)
      ? next.replace(matcher, line)
      : `${next.replace(/\s*$/, "")}\n${line}\n`.replace(/^\n/, "");
  }

  await writeFile(envPath, next, { encoding: "utf8", mode: 0o600 });
  await chmod(envPath, 0o600);
}

async function main(): Promise<void> {
  // A dedicated branch-only role prevents an accidentally displayed inherited
  // owner credential from becoming the rehearsal connection secret.
  const rolesOutput = neonctl([
    "roles",
    "list",
    "--project-id",
    PROJECT_ID,
    "--branch",
    BRANCH,
    "--output",
    "json",
    "--no-color",
  ]);
  const roles = JSON.parse(rolesOutput) as Array<{ name?: string }>;
  if (!roles.some((role) => role.name === ROLE)) {
    neonctl([
      "roles",
      "create",
      "--project-id",
      PROJECT_ID,
      "--branch",
      BRANCH,
      "--name",
      ROLE,
      "--output",
      "json",
      "--no-color",
    ]);
  }

  const appOutput = await neonConnectionString([
    "connection-string",
    BRANCH,
    "--project-id",
    PROJECT_ID,
    "--role-name",
    ROLE,
    "--database-name",
    "neondb",
    "--ssl",
    "require",
    "--no-color",
  ]);
  const appMatch = appOutput.match(/postgresql:\/\/[^\s]+/);
  if (!appMatch) throw new Error("Neon app connection string was not returned");

  const ownerOutput = await neonConnectionString([
    "connection-string",
    BRANCH,
    "--project-id",
    PROJECT_ID,
    "--role-name",
    "neondb_owner",
    "--database-name",
    "neondb",
    "--ssl",
    "require",
    "--no-color",
  ]);
  const ownerMatch = ownerOutput.match(/postgresql:\/\/[^\s]+/);
  if (!ownerMatch) throw new Error("Neon owner connection string was not returned");

  await upsertLocalSecrets({
    [ENV_KEY]: appMatch[0],
    [OWNER_ENV_KEY]: ownerMatch[0],
  });
  process.stdout.write(
    JSON.stringify({
      configured: true,
      envKeys: [ENV_KEY, OWNER_ENV_KEY],
      branch: BRANCH,
      role: ROLE,
    }) + "\n",
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "configuration failed"}\n`);
  process.exitCode = 1;
});
