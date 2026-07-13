import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { zhCN } from "../src/i18n/dictionaries/zh-CN";
import { enUS } from "../src/i18n/dictionaries/en-US";

/** 统一 platform page 不得硬编码旧 B 端页头。 */
const FORBIDDEN_HARDCODED = [
  "Products",
  "Creative Studio",
  "Performance",
  "Recommendations",
  "Next best action",
  "VARIANTS",
  "CONNECTIONS",
  "ANALYTICS",
  "Self-serve",
  "← Back to products",
  "Total videos",
  "No business videos yet",
];

const BUSINESS_PAGE_FILES = [
  "src/app/(platform)/app/create/page.tsx",
  "src/app/(platform)/app/batches/page.tsx",
  "src/app/(platform)/app/racing/page.tsx",
  "src/app/(platform)/app/library/page.tsx",
  "src/app/(platform)/app/templates/page.tsx",
];

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 仅匹配 JSX 文本或字符串字面量，避免误伤 BusinessProductsPage 等标识符 */
function containsHardcodedPhrase(src: string, phrase: string): boolean {
  const esc = escapeRegExp(phrase);
  return (
    new RegExp(`["']${esc}["']`).test(src) ||
    new RegExp(`>\\s*${esc}\\s*<`).test(src)
  );
}

test("platform locale: 页面源码不得残留旧 B 端英文页头", () => {
  for (const file of BUSINESS_PAGE_FILES) {
    const src = stripComments(readFileSync(resolve(file), "utf8"));
    for (const phrase of FORBIDDEN_HARDCODED) {
      assert.ok(
        !containsHardcodedPhrase(src, phrase),
        `${file} 仍硬编码「${phrase}」，应改用 t("shell.*")`,
      );
    }
  }
});

test("platform locale: 五区导航中英文均存在且语义不同", () => {
  assert.equal(zhCN.shell.platformNav.library, "成品库");
  assert.equal(enUS.shell.platformNav.library, "Video library");
  assert.notEqual(zhCN.shell.platformNav.racing, enUS.shell.platformNav.racing);
});
