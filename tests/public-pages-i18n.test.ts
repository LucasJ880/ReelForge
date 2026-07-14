import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { PUBLIC_PAGE_COPY, getPublicPageCopy } from "../src/i18n/public-copy";

const PUBLIC_PAGES = [
  "src/app/(public)/privacy/page.tsx",
  "src/app/(public)/terms/page.tsx",
  "src/app/(public)/persona/page.tsx",
] as const;

function stringPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (!value || typeof value !== "object") return [];

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    stringPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(stringValues);
}

test("public pages: zh-CN and en-US copy have identical, non-empty shapes", () => {
  const zhPaths = stringPaths(PUBLIC_PAGE_COPY["zh-CN"]).sort();
  const enPaths = stringPaths(PUBLIC_PAGE_COPY["en-US"]).sort();

  assert.deepEqual(zhPaths, enPaths);
  for (const locale of ["zh-CN", "en-US"] as const) {
    for (const value of stringValues(getPublicPageCopy(locale))) {
      assert.ok(value.trim().length > 0, `${locale} contains an empty public-page string`);
    }
  }
});
test("public pages: legal and persona metadata and visible copy change with locale", () => {
  const zh = getPublicPageCopy("zh-CN");
  const en = getPublicPageCopy("en-US");

  assert.equal(zh.privacy.title, "隐私政策");
  assert.equal(en.privacy.title, "Privacy Policy");
  assert.notEqual(zh.privacy.metadata.title, en.privacy.metadata.title);
  assert.notEqual(zh.terms.metadata.description, en.terms.metadata.description);
  assert.notEqual(zh.persona.title, en.persona.title);
  assert.notEqual(zh.persona.footer, en.persona.footer);
});

test("public pages: every route reads server locale, localizes metadata, and exposes a language switcher", () => {
  for (const file of PUBLIC_PAGES) {
    const source = readFileSync(resolve(file), "utf8");

    assert.match(source, /getServerLocale\(\)/, `${file} must read the aivora locale cookie`);
    assert.match(source, /getPublicPageCopy\(locale\)/, `${file} must select locale copy`);
    assert.match(source, /export async function generateMetadata/, `${file} must localize metadata`);
    assert.match(source, /<LanguageSwitcher\b/, `${file} must expose a visible language switcher`);
  }
});
