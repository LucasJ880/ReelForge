/**
 * Read-only full-field storage route scanner.
 *
 * - DB: scans every public text / text[] / json / jsonb column on tables with an id.
 * - Repo: scans text-like source/config/docs for URL references.
 * - Never writes to Postgres or object storage.
 * - Removes query/hash fragments before persisting URLs so signed tokens are not leaked.
 *
 * Default output is gitignored:
 *   npx tsx --env-file=.env.local scripts/scan-storage-migration-manifest.ts
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";

const OUTPUT_FLAG = "--output=";
const DEFAULT_OUTPUT = path.join(
  process.cwd(),
  ".aivora-private",
  "storage-migration-manifest.json",
);
const URL_RE = /https?:\/\/[^\s"'<>\\\])}]+/g;
const CEO_IDS = new Set([
  "cmrij6psx0010jl04gj04xoeg",
  "cmrij6pr8000zjl04pbo2urzm",
  "cmrij6pty0012jl04n6wi5ul8",
  "cmrii4yyv0014l204jaxluepv",
  "cmrii4yxl0013l2043tz1473b",
  "cmrii4yzr0016l204c4rcwpw6",
]);
const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".txt",
  ".yml", ".yaml", ".toml", ".sql", ".sh", ".env", ".example",
]);
const SKIP_DIRS = new Set([
  ".git", ".next", ".aivora-private", "node_modules", "showcase-static",
  "playwright-report", "test-results", "coverage", "tmp",
]);

interface ColumnMeta {
  tableName: string;
  columnName: string;
}

interface ManifestEntry {
  sourceType: "database" | "repository";
  table?: string;
  column?: string;
  rowId?: string;
  file?: string;
  sourceHost: string;
  canonicalSourceUrl: string;
  urlSha256: string;
  route: "beijing-tos" | "vercel-blob-region-unverified" | "other";
  priority: "ceo-confirmation-pending" | "normal";
  targetKey?: string;
}

function quoted(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function canonicalize(raw: string): string | null {
  try {
    const url = new URL(raw.replace(/[.,;:]+$/, ""));
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function classify(url: string): ManifestEntry["route"] {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes("tos-cn-beijing") || host.endsWith("volces.com")) {
    return "beijing-tos";
  }
  if (host.endsWith("blob.vercel-storage.com")) {
    return "vercel-blob-region-unverified";
  }
  return "other";
}

function safeFilename(url: string): string {
  const raw = decodeURIComponent(new URL(url).pathname.split("/").pop() || "object");
  const sanitized = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.slice(0, 160) || "object";
}

function entry(args: Omit<ManifestEntry, "sourceHost" | "canonicalSourceUrl" | "urlSha256" | "route"> & { rawUrl: string }): ManifestEntry | null {
  const canonicalSourceUrl = canonicalize(args.rawUrl);
  if (!canonicalSourceUrl) return null;
  const urlSha256 = createHash("sha256").update(canonicalSourceUrl).digest("hex");
  const route = classify(canonicalSourceUrl);
  return {
    sourceType: args.sourceType,
    table: args.table,
    column: args.column,
    rowId: args.rowId,
    file: args.file,
    sourceHost: new URL(canonicalSourceUrl).hostname,
    canonicalSourceUrl,
    urlSha256,
    route,
    priority: args.priority,
    targetKey:
      route === "beijing-tos"
        ? `migrations/beijing-tos/${urlSha256}/${safeFilename(canonicalSourceUrl)}`
        : undefined,
  };
}

async function scanDatabase(): Promise<ManifestEntry[]> {
  const columns = await db.$queryRaw<ColumnMeta[]>`
    SELECT c.table_name AS "tableName", c.column_name AS "columnName"
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND (
        c.data_type IN ('text', 'character varying', 'json', 'jsonb')
        OR c.udt_name = '_text'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns idc
        WHERE idc.table_schema = c.table_schema
          AND idc.table_name = c.table_name
          AND idc.column_name = 'id'
      )
    ORDER BY c.table_name, c.ordinal_position
  `;
  const found: ManifestEntry[] = [];
  for (const column of columns) {
    const rows = await db.$queryRawUnsafe<Array<{ rowId: string; value: string }>>(
      `SELECT ${quoted("id")}::text AS "rowId", ${quoted(column.columnName)}::text AS "value" ` +
        `FROM ${quoted(column.tableName)} WHERE ${quoted(column.columnName)} IS NOT NULL`,
    );
    for (const row of rows) {
      for (const rawUrl of row.value.match(URL_RE) ?? []) {
        const item = entry({
          sourceType: "database",
          table: column.tableName,
          column: column.columnName,
          rowId: row.rowId,
          rawUrl,
          priority: CEO_IDS.has(row.rowId) ? "ceo-confirmation-pending" : "normal",
        });
        if (item) found.push(item);
      }
    }
  }
  return found;
}

async function walk(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isDirectory()) {
      if (!SKIP_DIRS.has(item.name)) files.push(...(await walk(path.join(dir, item.name))));
      continue;
    }
    const ext = path.extname(item.name).toLowerCase();
    if (TEXT_EXTENSIONS.has(ext) || item.name.startsWith(".env.")) {
      files.push(path.join(dir, item.name));
    }
  }
  return files;
}

async function scanRepository(): Promise<ManifestEntry[]> {
  const root = process.cwd();
  const found: ManifestEntry[] = [];
  for (const filePath of await walk(root)) {
    const statPath = path.relative(root, filePath);
    const content = await readFile(filePath, "utf8").catch(() => "");
    for (const rawUrl of content.match(URL_RE) ?? []) {
      const item = entry({
        sourceType: "repository",
        file: statPath,
        rawUrl,
        priority: CEO_IDS.has(content) ? "ceo-confirmation-pending" : "normal",
      });
      if (item) found.push(item);
    }
  }
  return found;
}

function dedupe(entries: ManifestEntry[]): ManifestEntry[] {
  const seen = new Set<string>();
  return entries.filter((item) => {
    const key = [item.sourceType, item.table, item.column, item.rowId, item.file, item.urlSha256].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const output = process.argv.find((value) => value.startsWith(OUTPUT_FLAG))?.slice(OUTPUT_FLAG.length) || DEFAULT_OUTPUT;
  const entries = dedupe([...(await scanDatabase()), ...(await scanRepository())]);
  const byRoute = Object.fromEntries(
    [...new Set(entries.map((item) => item.route))].sort().map((route) => [
      route,
      entries.filter((item) => item.route === route).length,
    ]),
  );
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    readOnlyScan: true,
    signedQueryParametersPersisted: false,
    migrationStarted: false,
    storageTarget: {
      provider: "vercel-blob",
      store: "aivora-blob",
      region: "IAD1",
      access: "public-random-url",
      evidence: "docs/evidence/phase-0/vercel-blob-iad1-public.png",
    },
    targetKeyPolicy: "migrations/beijing-tos/<sha256>/<sanitized-filename>",
    controlledAccessUpgrade: "backlog",
    counts: {
      totalReferences: entries.length,
      uniqueBeijingObjects: new Set(
        entries.filter((item) => item.route === "beijing-tos").map((item) => item.urlSha256),
      ).size,
      byRoute,
    },
    entries,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ output, ...manifest.counts }, null, 2));
}

main()
  .catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
