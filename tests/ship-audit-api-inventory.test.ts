import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const file = path.join(directory, entry);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
}

test("API inventory accounts for every route file, including provider discovery", () => {
  const apiRoot = path.join(process.cwd(), "src/app/api");
  const audit = readFileSync("qa/SHIP_AUDIT.md", "utf8");
  const routeFiles = walk(apiRoot).filter((file) => file.endsWith("/route.ts"));
  const endpoints = routeFiles.map((file) => {
    const relative = path.relative(apiRoot, file).replace(/\/route\.ts$/, "");
    return `/api/${relative}`;
  });

  assert.equal(routeFiles.length, 81);
  assert.equal(new Set(endpoints).size, routeFiles.length);
  for (const endpoint of endpoints) {
    assert.ok(
      audit.includes(`\`${endpoint}\``),
      `${endpoint} is implemented but missing from qa/SHIP_AUDIT.md`,
    );
  }
  assert.match(audit, /API endpoint inventory \(81\/81 route files\)/);
  assert.match(audit, /GET, POST \| `\/api\/cron\/stitch-dispatch`/);
  assert.match(audit, /GET \| `\/api\/internal\/video-provider-routes`/);
  assert.match(audit, /GET \| `\/api\/video-generation\/routes`/);
});
