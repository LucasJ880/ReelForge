import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { concurrentWaitCount } from "../src/lib/library/concurrent-wait";
import { getPlatformCopy } from "../src/i18n/platform-copy";

/**
 * 2026-11-10：出片中位约 12 分钟，20 条里有 4 条用了 30–67 分钟，慢的和提交先后无关（各做各的）。
 * 同时做几条时等待页多说一句，不让人以为卡住了——但不能把它说成「排队一条一条出」，那不是事实。
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
  /// 不再声称「排队一条一条出」：对着真实任务和合作方的起止时间核过，几条是各做各的
  assert.doesNotMatch(getPlatformCopy("zh-CN").library.waitingConcurrent, /排队|一条一条/);
  assert.doesNotMatch(getPlatformCopy("en-US").library.waitingConcurrent, /one after another|queue/i);
  assert.match(getPlatformCopy("zh-CN").library.waitingConcurrent, /各做各的/);
  assert.match(getPlatformCopy("zh-CN").library.waitingConcurrent, /不影响其它几条/);
});
