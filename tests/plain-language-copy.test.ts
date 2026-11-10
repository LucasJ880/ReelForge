import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getPlatformCopy } from "@/i18n/platform-copy";

/**
 * 2026-11-10 走查：批量生产、模板库、品牌页的说明文字是写给内部看的（「失败分诊」「冻结镜头结构」「失败边界」），
 * 品牌页还在承诺已经停用的片尾品牌卡。这里守住：页面说明用商家听得懂的话，并且与现状一致。
 */
const INTERNAL_JARGON = ["失败分诊", "生产链路", "冻结镜头结构", "真实性约束", "失败边界", "素材分配", "统一监控页", "交互受控"];

test("批量生产与模板库的说明不出现内部术语", () => {
  const copy = getPlatformCopy("zh-CN");
  const visible = [
    copy.templates.subtitle,
    copy.templates.stable,
    copy.templates.balanced,
    copy.templates.controlledHuman,
    copy.batches.subtitle,
    copy.batches.newSubtitle,
  ].join("\n");
  for (const word of INTERNAL_JARGON) assert.ok(!visible.includes(word), `说明里不该出现「${word}」`);
});

test("品牌页不再承诺已经停用的片尾品牌卡会用在每条视频上", async () => {
  const copy = getPlatformCopy("zh-CN");
  assert.match(copy.brands.subtitle, /片尾品牌卡暂时停用/);
  assert.doesNotMatch(copy.brands.subtitle, /让单条与批量生产保持同一套品牌表达/);
  const manager = await readFile("src/components/brand/brand-package-manager.tsx", "utf8");
  assert.doesNotMatch(manager, /每条视频都能直接套用/);
  const policy = await readFile("src/lib/brand/brand-end-card-policy.ts", "utf8");
  assert.match(policy, /export const BRAND_END_CARD_ENTRY_ENABLED = false;/, "入口放回时，把品牌页的说明一起改回来");
});

test("一个批次都没有时，完成率不写「近 0 批」", async () => {
  const page = await readFile("src/app/(platform)/app/batches/page.tsx", "utf8");
  assert.match(page, /batches\.length > 0 \? copy\.board\.scope\.replace\("\{n\}", String\(batches\.length\)\) : copy\.board\.scopeNoBatches/);
  assert.match(page, /caption: copy\.board\.completionNoBatches/);
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
