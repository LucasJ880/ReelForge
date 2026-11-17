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

test("API inventory accounts for every route file", () => {
  const apiRoot = path.join(process.cwd(), "src/app/api");
  const audit = readFileSync("qa/SHIP_AUDIT.md", "utf8");
  const routeFiles = walk(apiRoot).filter((file) => file.endsWith("/route.ts"));
  const endpoints = routeFiles.map((file) => {
    const relative = path.relative(apiRoot, file).replace(/\/route\.ts$/, "");
    return `/api/${relative}`;
  });

  /// 2026-11-16 瘦身：第 3 批之一删 2 个（/api/webhooks/stripe、/api/cron/founder-digest，95 → 93），
  /// 第 2 批删 12 个（b-roll、链接抓取、商品主体、publish、旧 brief 接口，93 → 81），
  /// 第 3 批之三删 12 个（/api/content-plans 3 个、/api/racing 4 个、/api/product-images 4 个、
  /// /api/demo/real-footage-ads/waitlist，81 → 69）。qa/SHIP_AUDIT.md 这一批一起改到了实数：标题 69/69，
  /// 前两批留在表里的 14 行与这一批的 12 行都删了，所以下面多了一条反向核对（表里列的接口都得真有路由文件）。
  assert.equal(routeFiles.length, 69);
  assert.equal(new Set(endpoints).size, routeFiles.length);
  for (const endpoint of endpoints) {
    assert.ok(
      audit.includes(`\`${endpoint}\``),
      `${endpoint} is implemented but missing from qa/SHIP_AUDIT.md`,
    );
  }
  assert.match(audit, /API endpoint inventory \(69\/69 route files/);
  const inventory = audit.slice(
    audit.indexOf("## API endpoint inventory"),
    audit.indexOf("## Background task and queue inventory"),
  );
  const listed = [...inventory.matchAll(/^\|[^|]*\|\s*`(\/api\/[^`]+)`\s*\|/gm)].map((match) => match[1]!);
  assert.equal(listed.length, routeFiles.length, "清单里一个接口一行，行数要和路由文件数对上");
  assert.deepEqual(
    listed.filter((endpoint) => !endpoints.includes(endpoint)),
    [],
    "清单里不能留着已经删掉的接口",
  );
  assert.match(audit, /GET, POST \| `\/api\/cron\/stitch-dispatch`/);
  assert.match(audit, /GET \| `\/api\/video-generation\/routes`/);
});
