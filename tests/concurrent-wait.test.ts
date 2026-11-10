import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { concurrentWaitCount } from "../src/lib/library/concurrent-wait";
import { getPlatformCopy } from "../src/i18n/platform-copy";

/**
 * 2026-11-10：生产数据里单独一条中位 11 分钟出片，连着提交 3–4 条时后面的要 30–67 分钟。
 * 等待页要说清楚「在排队」，不让人以为卡住了。
 */
test("只有这一条在生成：不多说；两条以上：说清楚有几条", () => {
  assert.equal(concurrentWaitCount({ status: "generating", generating: 1 }), null);
  assert.equal(concurrentWaitCount({ status: "generating", generating: 0 }), null);
  assert.equal(concurrentWaitCount({ status: "generating", generating: 2 }), 2);
  assert.equal(concurrentWaitCount({ status: "generating", generating: 4 }), 4);
});

test("不在生成阶段（合成中 / 已成片 / 排队）或读不到数：不显示", () => {
  for (const status of ["assembling", "ready", "planning", "failed", "cancelled"]) {
    assert.equal(concurrentWaitCount({ status, generating: 5 }), null, status);
  }
  assert.equal(concurrentWaitCount({ status: "generating", generating: null }), null);
  assert.equal(concurrentWaitCount({ status: "generating", generating: undefined }), null);
  assert.equal(concurrentWaitCount({ status: "generating", generating: Number.NaN }), null);
});

test("详情页：数字用壳层同一个「生成中」读数，只在这条正在生成时才查；文案两种语言都有", () => {
  const page = readFileSync("src/app/(platform)/app/library/[id]/page.tsx", "utf8");
  assert.match(page, /item\.status === "generating" && !item\.isShowcase \? \(await loadProductionCounts\(session\.user\.id\)\)\.generating : null/);
  assert.match(page, /data-testid="library-waiting-concurrent"/);
  for (const locale of ["zh-CN", "en-US"] as const) {
    assert.match(getPlatformCopy(locale).library.waitingConcurrent, /\{n\}/);
  }
  assert.match(getPlatformCopy("zh-CN").library.waitingConcurrent, /排队/);
});
