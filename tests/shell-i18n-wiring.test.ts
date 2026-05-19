import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SHELL_CLIENT_FILES = [
  "src/components/layout/business-sidebar.tsx",
  "src/components/layout/personal-sidebar.tsx",
  "src/components/billing/usage-dashboard.tsx",
  "src/components/video-generation/unified-creative-input.tsx",
];

test("shell: B/C 侧栏与核心表单使用 useTranslation", () => {
  for (const file of SHELL_CLIENT_FILES) {
    const src = readFileSync(resolve(file), "utf8");
    assert.match(
      src,
      /useTranslation\(\)/,
      `${file} 应使用 useTranslation 以支持语言切换`,
    );
    assert.match(
      src,
      /t\("shell\./,
      `${file} 应引用 shell.* 字典 key`,
    );
  }
});

test("shell: 侧栏导航不得硬编码英文 Home / Billing", () => {
  for (const file of [
    "src/components/layout/business-sidebar.tsx",
    "src/components/layout/personal-sidebar.tsx",
  ]) {
    const src = readFileSync(resolve(file), "utf8");
    assert.ok(
      !src.includes('label: "Home"'),
      `${file} 仍硬编码英文导航`,
    );
    assert.ok(
      !src.includes('label: "Billing"'),
      `${file} 仍硬编码 Billing`,
    );
  }
});
