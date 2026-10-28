import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("RF-011 template filters wrap and cards preserve a stretched information grid", async () => {
  const source = await readFile(
    path.join(ROOT, "src/components/templates/template-library-grid.tsx"),
    "utf8",
  );
  assert.doesNotMatch(source, /overflow-x-auto/);
  assert.match(source, /data-template-filters/);
  assert.match(source, /flex flex-wrap gap-2/);
  assert.doesNotMatch(source, /grid[^\n]+items-start/);
  assert.match(source, /data-template-card/);
  assert.match(source, /className="min-w-0 h-full"/);
  assert.match(source, /group flex h-full/);
  assert.match(source, /mt-auto/);
});

test("RF-011 browser overflow regression covers all three desktop widths", async () => {
  await access(path.join(ROOT, "tests/phase34/layout-overflow.spec.ts"));
  const source = await readFile(
    path.join(ROOT, "tests/phase34/layout-overflow.spec.ts"),
    "utf8",
  );
  for (const width of [1280, 1440, 1920]) {
    assert.match(source, new RegExp(`\\b${width}\\b`));
  }
  assert.match(source, /documentElement\.scrollWidth/);
  assert.match(source, /getBoundingClientRect/);
});

test("auth gate: video half only from lg up, form column bounded, no wall that can overflow", async () => {
  const source = await readFile(
    path.join(ROOT, "src/app/(auth)/layout.tsx"),
    "utf8",
  );
  // 2026-10-28 登录门与首页展厅同一语言：左半屏视频（窄屏隐藏），右侧表单限宽，不再有三格样片墙。
  assert.match(source, /<section className="show-hero on-media hidden h-auto min-h-screen lg:block"/);
  assert.match(source, /<div className="w-full max-w-md space-y-6">/);
  assert.doesNotMatch(source, /x-wall|listActiveStyleTemplates/);
});

test("brand manager uses responsive cards without horizontal scrolling", async () => {
  const source = await readFile(
    path.join(ROOT, "src/components/brand/brand-package-manager.tsx"),
    "utf8",
  );
  assert.match(source, /grid-cols-1/);
  assert.match(source, /min-w-0/);
  assert.doesNotMatch(source, /overflow-x-auto/);
});
