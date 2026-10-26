import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getPlatformCopy } from "../src/i18n/platform-copy";
import { PLATFORM_PRIMARY_NAV } from "../src/lib/platform-routes";

/**
 * 2026-10-25 审计 B5：表现数据回流（青砚同步）还没开，「战绩」页只能是零。
 * A 级下线：入口撤出导航，路由保留可直达；页面一条数据都没有时如实写空态，不摆判定台账。
 */

test("战绩入口不在导航里，但页面路由还在（A 级下线只动入口）", async () => {
  assert.ok(!PLATFORM_PRIMARY_NAV.map((item): string => item.href).includes("/app/wins"));
  const page = await readFile("src/app/(platform)/app/wins/page.tsx", "utf8");
  assert.match(page, /export default async function WinsPage/);
  const shell = await readFile("src/components/platform/platform-shell.tsx", "utf8");
  assert.doesNotMatch(shell, /^\s*wins: Trophy,/m, "导轨图标表随导航一起撤掉");
});

test("没有表现数据时：只写空态，不摆六行「再发几条」的判定台账", async () => {
  const page = await readFile("src/app/(platform)/app/wins/page.tsx", "utf8");
  assert.match(page, /const hasPerformanceData = rows\.length > 0;/);
  assert.match(page, /\{hasPerformanceData \? \(/);
  assert.match(page, /data-testid="wins-empty"/);
  const ledgerAt = page.indexOf("<DimensionLedger");
  const emptyAt = page.indexOf('data-testid="wins-empty"');
  assert.ok(ledgerAt > 0 && emptyAt > ledgerAt, "台账只在有数据的分支里");
});

test("空态文案中英双语、说清楚为什么是空的、不放示例数字", () => {
  const zh = getPlatformCopy("zh-CN").wins;
  const en = getPlatformCopy("en-US").wins;
  assert.match(zh.emptyTitle, /还没有表现数据/);
  assert.match(zh.emptyBody, /接通之前/);
  assert.match(zh.emptyBody, /不会放示例数据/);
  assert.match(en.emptyTitle, /No performance data/);
  assert.match(en.emptyBody, /never show sample numbers/);
  for (const text of [zh.emptyTitle, zh.emptyBody, en.emptyTitle, en.emptyBody]) {
    assert.doesNotMatch(text, /\d/, `空态不写任何数字：${text}`);
  }
});
