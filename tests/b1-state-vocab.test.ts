import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  STATE_VOCAB,
  batchState,
  batchStatusWords,
  libraryRowState,
  stateTone,
  stateWord,
  videoJobState,
  type VocabEntity,
} from "../src/lib/exchange/state-vocab";
import { getPlatformCopy } from "../src/i18n/platform-copy";
import { getGrowthCopy } from "../src/i18n/growth-copy";

/**
 * 1025 · B1.3 状态词典：一张「实体 × 状态 → 词 + 记号」的表。
 * 定稿：排队中 / 生成中 / 已暂停 / 已成片（条）· 已完成（批）/ 部分失败 / 失败 / 已取消；「成交」只给询盘。
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

test("定稿词：条与批共用 7 个词位，只有「完成」按实体分词", () => {
  const item = Object.fromEntries(Object.keys(STATE_VOCAB.item).map((state) => [state, stateWord("item", state as never, "zh-CN")]));
  assert.deepEqual(item, {
    queued: "排队中",
    generating: "生成中",
    paused: "已暂停",
    done: "已成片",
    failed: "失败",
    cancelled: "已取消",
  });
  assert.equal(stateWord("batch", "done", "zh-CN"), "已完成");
  assert.equal(stateWord("batch", "partial", "zh-CN"), "部分失败");
  assert.equal(stateWord("item", "done", "en-US"), "Ready");
  assert.equal(stateWord("batch", "done", "en-US"), "Completed");
});

test("「成交」只出现在询盘（lead.WON），视频侧一个都没有", () => {
  for (const entity of Object.keys(STATE_VOCAB) as VocabEntity[]) {
    for (const [state, entry] of Object.entries(STATE_VOCAB[entity] as Record<string, { "zh-CN": string; "en-US": string }>)) {
      const isLead = entity === "lead";
      if (!isLead) {
        assert.doesNotMatch(entry["zh-CN"], /成交/, `${entity}.${state} 不得用「成交」`);
        assert.doesNotMatch(entry["en-US"], /\bFill(ed)?\b/i, `${entity}.${state} 不得用 Filled`);
      }
    }
  }
  assert.equal(stateWord("lead", "WON", "zh-CN"), "已成交");
});

test("询盘词与 growth-copy 的状态词同名同字（同一个状态不两种叫法）", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    const growth = getGrowthCopy(locale).statuses;
    for (const status of Object.keys(growth) as Array<keyof typeof growth>) {
      assert.equal(stateWord("lead", status, locale), growth[status], `${locale} ${status}`);
    }
  }
});

test("数据库枚举 → 词位：暂停不是生成中、取消不是失败、拆单按排队", () => {
  assert.equal(batchState("EXPANDING"), "queued");
  assert.equal(batchState("RUNNING"), "generating");
  assert.equal(batchState("PAUSED"), "paused");
  assert.equal(batchState("CANCELLED"), "cancelled");
  assert.equal(videoJobState("QUEUED"), "queued");
  assert.equal(videoJobState("PAUSED"), "paused");
  assert.equal(libraryRowState("paused"), "paused");
  assert.equal(libraryRowState("cancelled"), "cancelled");
  assert.equal(libraryRowState("planning"), "queued");
  // 记号：排队是空心圈（不再借用暂停的双竖），暂停是双竖
  assert.equal(stateTone("item", "queued"), "queued");
  assert.equal(stateTone("item", "paused"), "idle");
  assert.equal(stateTone("item", "cancelled"), "void");
});

test("platform-copy 的状态词全部来自词典；批量表与生产带同一个词", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    const copy = getPlatformCopy(locale);
    assert.deepEqual(copy.batches.statuses, batchStatusWords(locale));
    assert.deepEqual(copy.shell.batchStates, batchStatusWords(locale));
    assert.equal(copy.batches.monitor.jobStatuses.SUCCEEDED, stateWord("item", "done", locale));
    assert.equal(copy.library.statuses.paused, stateWord("item", "paused", locale));
  }
  const zh = getPlatformCopy("zh-CN");
  const en = getPlatformCopy("en-US");
  assert.equal(zh.shell.tape, "实时生产带");
  assert.equal(en.shell.tape, "Live production tape");
  assert.equal(zh.batches.columns.progress, "成片");
  assert.equal(zh.wall.report, "生产回报");
});

test("视频侧文案里没有「已成交 / 成交带 / 近 N 天成交」", () => {
  const sources = [
    "src/i18n/platform-copy.ts",
    "src/components/templates/template-library-copy.ts",
    "src/components/exchange/exchange-tape.tsx",
    "src/components/platform/platform-shell.tsx",
    "src/app/(wall)/wall/page.tsx",
    "src/app/(platform)/app/batches/page.tsx",
  ].map((file) => readFileSync(file, "utf8"));
  for (const source of sources) {
    assert.doesNotMatch(source, /"[^"\n]*成交[^"\n]*"/, "成交 只留给询盘");
  }
});

test("StatusTick 只接收「实体 × 状态」，全站没有自由文本 label 或手填 tone 的调用", () => {
  const tick = readFileSync("src/components/exchange/status-tick.tsx", "utf8");
  assert.match(tick, /entity: E;\s*state: VocabState<E>;\s*locale: Locale;/);
  assert.doesNotMatch(tick, /label: React\.ReactNode/);
  // 排队记号：空心圈
  assert.match(tick, /tone === "queued" \? <circle[^>]*fill="none"/);
  const offenders = walk("src").filter((file) => /<StatusTick\b[^>]*\b(?:label|tone)=/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

test("不是状态的标签（样例 / 草案 / 攒样本 / 样片待补）用中性 MonoTag，不借状态记号", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/app/(public)/privacy/page.tsx", /<MonoTag[^>]*>\{copy\.draftStatus\}<\/MonoTag>/],
    ["src/app/(public)/terms/page.tsx", /<MonoTag[^>]*>\{copy\.draftStatus\}<\/MonoTag>/],
    ["src/components/wins/dimension-ledger.tsx", /<MonoTag[^>]*>\{ready \? copy\.ready : copy\.collecting\}<\/MonoTag>/],
    ["src/components/templates/template-shot-timeline.tsx", /<MonoTag>\{copy\.pending\}<\/MonoTag>/],
  ];
  for (const [file, pattern] of checks) {
    const source = readFileSync(file, "utf8");
    assert.match(source, pattern, file);
    assert.doesNotMatch(source, /StatusTick/, `${file} 不该再用状态记号`);
  }
  /// C1：登录门上墙的是 AI 生成的商品广告镜头（2026-10-28 前是上门服务场景），标 AI 合规标签（不是模板样片，也不借状态记号）
  const gate = readFileSync("src/app/(auth)/layout.tsx", "utf8");
  assert.match(gate, /<AiGeneratedLabel compact \/>/);
  assert.doesNotMatch(gate, /StatusTick/);
});
