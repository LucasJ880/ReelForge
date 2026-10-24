import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { db } from "../src/lib/db";
import { ACCOUNT_RECHECK_TTL_MS, __test__ as authTest, loadAccountStatus } from "../src/lib/auth";
import { GET, POST, PUT } from "../src/app/api/brand-packaging/route";

/**
 * 1025 安全复核 LENS-5：/api/brand-packaging 曾是唯一直接调 getServerSession 的 API 路由，
 * 只吃 jwt 回调的 5 分钟实例缓存——账号在 B 实例被停用，A 实例上还能继续写品牌包、
 * 下载 250 MB 原片跑 ffmpeg 渲染。现在走 requireAuth（查库复核，2 秒新鲜度）。
 * 全部 patch Prisma 与 next-auth，不触真实库、不跑渲染。
 */

const require = createRequire(import.meta.url);
const nextAuthRuntime = require("next-auth/next") as Record<string, unknown>;

function patch(t: TestContext, target: object, values: Record<string, unknown>) {
  const record = target as Record<string, unknown>;
  const originals: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = record[key];
    record[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) record[key] = value;
  });
}

const SESSION = {
  user: { id: "customer-1", email: "owner@shop.test", role: "CUSTOMER", userType: "BUSINESS" },
  expires: "2099-01-01T00:00:00.000Z",
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test("🔴 src/app/api 下没有任何文件直接调 getServerSession：API 守卫一律走 requireAuth / requireRole", () => {
  /// 只认导入与调用（注释里提到这个名字不算）
  const rawUse = /import[^;]*\bgetServerSession\b[^;]*from|\bgetServerSession\s*\(/;
  const offenders = routeFiles("src/app/api").filter((path) => rawUse.test(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, [], "raw getServerSession skips the immediate disabled-account check");
  const route = readFileSync("src/app/api/brand-packaging/route.ts", "utf8");
  for (const method of ["GET", "PUT", "POST"]) {
    const start = route.indexOf(`export async function ${method}(`);
    assert.ok(start >= 0, `${method} handler exists`);
    const head = route.slice(start, start + 240);
    assert.match(head, /const auth = await requireAuth\(\);\n\s+if \(!auth\.ok\) return auth\.response;/, `${method} guards first`);
  }
});

test("🔴 停用账号：别的实例几秒前刚把它缓存成「正常」，GET / PUT / POST 照样立即 401，不碰品牌包、不下载不渲染", async (t) => {
  authTest.resetAccountStatusCache();
  t.after(() => authTest.resetAccountStatusCache());
  patch(t, nextAuthRuntime, { getServerSession: async () => structuredClone(SESSION) });
  let row: { role: string; userType: string | null; disabledAt: Date | null; email: string } = {
    role: "CUSTOMER",
    userType: "BUSINESS",
    disabledAt: null,
    email: "owner@shop.test",
  };
  patch(t, db.adminUser, { findUnique: async () => row });
  const touched: string[] = [];
  patch(t, db.workspaceBrandPackage, {
    findMany: async () => {
      touched.push("findMany");
      return [];
    },
    findFirst: async () => {
      touched.push("findFirst");
      return null;
    },
    findUnique: async () => {
      touched.push("findUnique");
      return null;
    },
  });

  /// 正常账号：守卫放行，照常列出品牌包
  const ok = await GET();
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { packages: [] });
  assert.deepEqual(touched, ["findMany"]);
  touched.length = 0;

  /// jwt 回调按 5 分钟 TTL 刚查过「正常」；随后账号在别的实例被停用
  authTest.resetAccountStatusCache();
  await loadAccountStatus("customer-1", ACCOUNT_RECHECK_TTL_MS);
  row = { ...row, disabledAt: new Date("2026-10-25T00:00:00.000Z") };
  authTest.ageAccountStatusCache(3_000);

  const get = await GET();
  assert.equal(get.status, 401);
  assert.equal((await get.json()).code, "AUTH_REQUIRED");

  const put = await PUT(
    new Request("https://aivora.test/api/brand-packaging", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Shop", brandName: "Shop", logoAssetId: "asset-1" }),
    }),
  );
  assert.equal(put.status, 401);

  const post = await POST(
    new Request("https://aivora.test/api/brand-packaging", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoJobId: "job-1", brandPackageId: "pkg-1" }),
    }),
  );
  assert.equal(post.status, 401);
  assert.deepEqual(touched, [], "a disabled account never reaches the brand package store or the renderer");
});
