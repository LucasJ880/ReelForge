import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { zhCN } from "../src/i18n/dictionaries/zh-CN";
import { enUS } from "../src/i18n/dictionaries/en-US";

/** B 端 page 不得硬编码的英文页头（应走 shell.* 字典） */
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
  "src/app/(business)/business/page.tsx",
  "src/app/(business)/business/products/page.tsx",
  "src/app/(business)/business/products/[id]/page.tsx",
  "src/app/(business)/business/creative-studio/page.tsx",
  "src/app/(business)/business/performance/page.tsx",
  "src/app/(business)/business/recommendations/page.tsx",
  "src/app/(business)/business/integrations/page.tsx",
  "src/app/(business)/business/create-ad-video/page.tsx",
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

test("business locale: 页面源码不得硬编码英文页头", () => {
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

test("business locale: zh-CN 页头与 en-US 不同且为中文产品库文案", () => {
  assert.equal(zhCN.shell.productsPage.title, "产品库");
  assert.equal(enUS.shell.productsPage.title, "Products");
  assert.notEqual(
    zhCN.shell.performancePage.title,
    enUS.shell.performancePage.title,
  );
  assert.match(zhCN.shell.recommendationsPage.title, /建议/);
});
