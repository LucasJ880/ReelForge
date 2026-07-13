/**
 * Static, read-only crawl-surface audit for migrated object URLs.
 *
 * It checks that object-storage URLs are absent from sitemap/robots/static
 * indexes and that API routes which expose video URL fields have an auth or
 * internal-secret guard. The frozen Showcase page and its explicitly public
 * demo assets are outside this migration-object audit.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT = path.join(
  ROOT,
  ".aivora-private",
  "public-video-url-exposure-audit.json",
);
const OBJECT_URL_RE = /https?:\/\/[^\s"'<>]*(?:blob\.vercel-storage\.com|tos-cn-beijing[^\s"'<>]*|volces\.com)[^\s"'<>]*/gi;
const VIDEO_RESPONSE_TOKEN_RE = /\b(?:outputVideoUrl|outputThumbUrl|finalVideoUrl|finalThumbnailUrl|stitchedVideoUrl|videoJobs)\b/;
const ROUTE_GUARD_RE = /\b(?:requireAuth|requireOperator|requireBusinessUser|requirePersonalUser|requireSuperAdmin|requireUserOfTypeForGeneration|CRON_SECRET)\b/;

async function filesBelow(dir: string): Promise<string[]> {
  const current = await stat(dir).catch(() => null);
  if (!current?.isDirectory()) return [];
  const files: string[] = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const itemPath = path.join(dir, item.name);
    if (item.isDirectory()) files.push(...(await filesBelow(itemPath)));
    else files.push(itemPath);
  }
  return files;
}

async function main() {
  const crawlIndexCandidates = [
    path.join(ROOT, "src/app/sitemap.ts"),
    path.join(ROOT, "src/app/sitemap.xml"),
    path.join(ROOT, "src/app/robots.ts"),
    path.join(ROOT, "public/robots.txt"),
    ...(await filesBelow(path.join(ROOT, "public"))).filter((file) =>
      /\.(?:json|xml|txt)$/i.test(file),
    ),
  ];
  const crawlIndexFindings: string[] = [];
  for (const file of [...new Set(crawlIndexCandidates)]) {
    const source = await readFile(file, "utf8").catch(() => null);
    if (source && OBJECT_URL_RE.test(source)) {
      crawlIndexFindings.push(path.relative(ROOT, file));
    }
    OBJECT_URL_RE.lastIndex = 0;
  }

  const apiRoutes = (await filesBelow(path.join(ROOT, "src/app/api"))).filter(
    (file) => file.endsWith("/route.ts"),
  );
  const guardedVideoRoutes: string[] = [];
  const unguardedVideoRoutes: string[] = [];
  for (const file of apiRoutes) {
    const source = await readFile(file, "utf8");
    if (!VIDEO_RESPONSE_TOKEN_RE.test(source)) continue;
    const relative = path.relative(ROOT, file);
    if (ROUTE_GUARD_RE.test(source)) guardedVideoRoutes.push(relative);
    else unguardedVideoRoutes.push(relative);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    staticReadOnlyAudit: true,
    frozenShowcaseExcluded: true,
    checks: {
      sitemapRobotsAndStaticIndexes: {
        passed: crawlIndexFindings.length === 0,
        objectUrlFindingFiles: crawlIndexFindings,
      },
      apiVideoUrlRoutes: {
        passed: unguardedVideoRoutes.length === 0,
        guardedRoutes: guardedVideoRoutes.sort(),
        unguardedRoutes: unguardedVideoRoutes.sort(),
      },
    },
  };
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (
    !report.checks.sitemapRobotsAndStaticIndexes.passed ||
    !report.checks.apiVideoUrlRoutes.passed
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
