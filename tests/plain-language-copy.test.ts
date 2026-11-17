import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getPlatformCopy } from "@/i18n/platform-copy";

test("品牌页不再承诺已经停用的片尾品牌卡会用在每条视频上", async () => {
  const copy = getPlatformCopy("zh-CN");
  /// 2026-11-17：副标题只说现在能做的事（右上角 Logo、片尾落款），不提已经停用的片尾品牌卡
  assert.match(copy.brands.subtitle, /右上角 Logo.*片尾落款/);
  assert.doesNotMatch(copy.brands.subtitle, /停用|片尾品牌卡/);
  assert.doesNotMatch(copy.brands.subtitle, /让单条与批量生产保持同一套品牌表达/);
  const manager = await readFile("src/components/brand/brand-package-manager.tsx", "utf8");
  assert.doesNotMatch(manager, /每条视频都能直接套用/);
  const policy = await readFile("src/lib/brand/brand-end-card-policy.ts", "utf8");
  assert.match(policy, /export const BRAND_END_CARD_ENTRY_ENABLED = false;/, "入口放回时，把品牌页的说明一起改回来");
});

test("再做一条 / 重新生成带回的商品图，不说成「从产品图工作台载入」", async () => {
  const studio = await readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /retryOfOrderId \|\| machineTaskId \? \(/);
  assert.match(studio, /已载入那条视频的 \$\{loadedFromStudio\.length\} 张商品图/);
});

test("代码索引不收各会话的 worktree 副本", async () => {
  const script = await readFile("scripts/build-codemap.ts", "utf8");
  assert.match(script, /"\.claude\/worktrees",/);
  const summary = await readFile("ai-context/file-summary-map.json", "utf8");
  assert.ok(!summary.includes(".claude/worktrees/"), "索引里不该有 worktree 路径（重建：npm run codemap:build）");
  assert.ok(summary.length < 5_000_000, `索引不该再涨到几十 MB，现在 ${summary.length} 字节`);
});

test("成品库第三格是真实读数（已登记发布），不再恒为「—」，说明里没有已停用的品牌封装", async () => {
  const page = await readFile("src/app/(platform)/app/library/page.tsx", "utf8");
  assert.match(page, /readingName\("publishRegistered", locale\)/);
  assert.match(page, /value: publishRegistered,/);
  assert.doesNotMatch(page, /copy\.workflowDeliverHint, value: "—"/);
  const readings = await readFile("src/lib/services/exchange-readings.ts", "utf8");
  assert.match(readings, /export async function countPublishRegistered\(userId: string\)/);
  assert.match(readings, /distinct: \["videoBriefId"\]/);
  assert.doesNotMatch(getPlatformCopy("zh-CN").library.workflowDeliverHint, /品牌封装/);
});
