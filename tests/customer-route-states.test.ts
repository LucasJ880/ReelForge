import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const ROUTES = [
  "src/app/(platform)/app/create",
  "src/app/(platform)/app/library",
] as const;

test("RF-012 customer route loaders never collapse service failures into empty data", async () => {
  for (const route of ROUTES) {
    const source = await readFile(path.join(ROOT, route, "page.tsx"), "utf8");
    assert.doesNotMatch(
      source,
      /\.catch\(\(\)\s*=>\s*(?:\[\]|null)\)/,
      `${route} still converts a rejected service call into an empty/not-found state`,
    );
  }
});

test("RF-012 customer routes own loading and error boundaries", async () => {
  for (const route of ROUTES) {
    await Promise.all([
      access(path.join(ROOT, route, "loading.tsx")),
      access(path.join(ROOT, route, "error.tsx")),
    ]);
    const [loading, error] = await Promise.all([
      readFile(path.join(ROOT, route, "loading.tsx"), "utf8"),
      readFile(path.join(ROOT, route, "error.tsx"), "utf8"),
    ]);
    assert.match(loading, /CustomerRouteLoading/);
    assert.match(error, /^"use client";/);
    assert.match(error, /CustomerRouteError/);
  }
});

test("RF-012 shared route states are accessible, retryable, and bilingual", async () => {
  const [loading, error, copy] = await Promise.all([
    readFile(
      path.join(ROOT, "src/components/platform/customer-route-loading.tsx"),
      "utf8",
    ),
    readFile(
      path.join(ROOT, "src/components/platform/customer-route-error.tsx"),
      "utf8",
    ),
    readFile(path.join(ROOT, "src/i18n/platform-copy.ts"), "utf8"),
  ]);

  assert.match(loading, /data-route-state="loading"/);
  assert.match(loading, /role="status"/);
  assert.match(loading, /motion-reduce:animate-none/);
  assert.match(error, /data-route-state="error"/);
  assert.match(error, /role="alert"/);
  assert.match(error, /onClick=\{reset\}/);
  assert.match(copy, /暂时无法加载/);
  assert.match(copy, /temporarily unavailable/i);
});

test("RF-012 customer routes expose successful empty states separately from errors", async () => {
  /// 创作页没有「空」这个状态（对话框永远在），它只标 ready；列表页各自有真实的空态。
  for (const route of ROUTES.filter((candidate) => !candidate.endsWith("/[id]") && !candidate.endsWith("/create"))) {
    const source = await readFile(path.join(ROOT, route, "page.tsx"), "utf8");
    assert.match(source, /data-route-state="empty"/);
  }
  const create = await readFile(path.join(ROOT, "src/app/(platform)/app/create/page.tsx"), "utf8");
  assert.match(create, /data-route-state="ready"/);
});

test("RF-012 customer pages no longer honour a header-driven state injection", async () => {
  /// 预演用的 x-aivora-qa-route-state 注入（customer-route-state-rehearsal）2026-11-16 删了：
  /// 它在生产里永远返回 live，只给已删的旧浏览器验收用。页面直接读真实数据。
  for (const route of ROUTES) {
    const source = await readFile(path.join(ROOT, route, "page.tsx"), "utf8");
    assert.doesNotMatch(source, /customer-route-state-rehearsal|getCustomerRouteRehearsalState|x-aivora-qa-route-state/);
  }
  await assert.rejects(access(path.join(ROOT, "src/lib/qa/customer-route-state-rehearsal.ts")));
});

