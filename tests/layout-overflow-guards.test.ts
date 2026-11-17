import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

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
