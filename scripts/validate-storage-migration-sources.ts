/**
 * Read-only preflight for non-CEO Beijing TOS database objects.
 * Performs HEAD only: no body download, no Blob upload, no DB write.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MANIFEST = path.join(
  process.cwd(),
  ".aivora-private",
  "storage-migration-manifest.json",
);
const OUTPUT = path.join(
  process.cwd(),
  ".aivora-private",
  "storage-migration-source-validation.json",
);

interface SourceEntry {
  sourceType: "database" | "repository";
  route: string;
  priority: string;
  canonicalSourceUrl: string;
  urlSha256: string;
  targetKey?: string;
}

interface Manifest {
  entries: SourceEntry[];
}

async function head(entry: SourceEntry) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(entry.canonicalSourceUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    return {
      urlSha256: entry.urlSha256,
      targetKey: entry.targetKey,
      reachable: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
      etag: response.headers.get("etag"),
      error: null,
    };
  } catch (error) {
    return {
      urlSha256: entry.urlSha256,
      targetKey: entry.targetKey,
      reachable: false,
      status: null,
      contentType: null,
      contentLength: null,
      etag: null,
      error: error instanceof Error ? error.name : "unknown",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8")) as Manifest;
  const unique = new Map<string, SourceEntry>();
  for (const entry of manifest.entries) {
    if (
      entry.sourceType === "database" &&
      entry.route === "beijing-tos" &&
      entry.priority !== "ceo-confirmation-pending"
    ) {
      unique.set(entry.urlSha256, entry);
    }
  }

  const results = await mapConcurrent([...unique.values()], 5, head);
  const output = {
    generatedAt: new Date().toISOString(),
    readOnlyHeadRequests: true,
    bodyBytesRequested: 0,
    ceoObjectsExcluded: true,
    counts: {
      checked: results.length,
      reachable: results.filter((item) => item.reachable).length,
      unreachable: results.filter((item) => !item.reachable).length,
      targetKeysPresent: results.filter((item) => Boolean(item.targetKey)).length,
    },
    results,
  };
  await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ output: OUTPUT, ...output.counts }, null, 2));
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
