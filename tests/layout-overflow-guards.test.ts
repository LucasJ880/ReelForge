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

test("RF-011 page-header and round actions wrap inside their content column", async () => {
  const [header, actions] = await Promise.all([
    readFile(path.join(ROOT, "src/components/features/page-header.tsx"), "utf8"),
    readFile(path.join(ROOT, "src/app/(internal)/internal/rounds/[id]/actions.tsx"), "utf8"),
  ]);
  assert.match(header, /lg:flex-row/);
  assert.match(header, /w-full[^\n]+lg:w-auto/);
  assert.match(actions, /data-round-actions/);
  assert.match(actions, /w-full[^\n]+flex-wrap/);
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

test("auth hero uses the bounded big-and-light display scale", async () => {
  const source = await readFile(
    path.join(ROOT, "src/app/(auth)/layout.tsx"),
    "utf8",
  );
  // Exchange 登录门：大而轻的宣言，但上限钳住，窄屏不撑破。
  assert.match(source, /x-display text-\[clamp\(2\.5rem,5\.4vw,5\.25rem\)\]/);
  assert.match(source, /max-w-\[46ch\]/);
  // 样片墙：三格等分且整块限宽，窄屏不横滚；取数失败整块不渲染。
  assert.match(source, /<figure className="max-w-2xl/);
  assert.match(source, /x-wall x-frame grid-cols-3/);
  assert.match(source, /catch \{\s*return null;/);
  assert.match(source, /<section className="min-w-0/);
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
