import assert from "node:assert/strict";
import test from "node:test";
import {
  FRAME_QA_BUCKETS,
  FRAME_QA_REPORT_MAX_DETAIL_ROWS,
  FRAME_QA_REPORT_ORDER_BY,
  bucketOf,
  clampFrameQaWindow,
  frameQaDetailWhere,
  frameQaReportWhere,
  normalizeSkipReason,
  summarizeFrameQa,
  type FrameQaReportRow,
} from "../src/lib/services/frame-qa-report-service";

/**
 * P01-C · 帧质检运维报表：只测纯聚合 summarizeFrameQa（rows → 报表），不碰库。
 * frameQaDetail 形状以 frame-qa-gate 的 FrameQaDetail 为准，但坏数据必须被吞掉而不是抛错。
 */

const T0 = new Date("2026-10-20T08:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function row(overrides: Partial<FrameQaReportRow> & { id: string }): FrameQaReportRow {
  return {
    batchJobId: null,
    frameQaStatus: null,
    frameQaCheckedAt: null,
    frameQaDetail: null,
    outputVideoUrl: null,
    ...overrides,
  };
}

function shadow(args: {
  blackBars?: { detected: boolean; threshold?: number } | null;
  nearStatic?: { detected: boolean; threshold?: number } | null;
  error?: string;
}) {
  return {
    v: 1,
    blackBars: args.blackBars === undefined ? null : args.blackBars,
    nearStatic: args.nearStatic === undefined ? null : args.nearStatic,
    ...(args.error ? { error: args.error } : {}),
  };
}

test("空输入：六个桶都是 0、比例 0、列表空、漂移未接入——零就写零，不抛错", () => {
  const report = summarizeFrameQa([], 7);
  assert.equal(report.windowDays, 7);
  assert.equal(report.total, 0);
  assert.deepEqual(
    report.byStatus.map((bucket) => bucket.status),
    ["PASSED", "BLOCKED", "WOULD_BLOCK", "SKIPPED", "CHECKING", "UNCHECKED"],
  );
  assert.ok(report.byStatus.every((bucket) => bucket.count === 0 && bucket.ratio === 0));
  assert.deepEqual(report.skipReasons, []);
  assert.deepEqual(report.blockEvents, { total: 0, rows: 0 });
  assert.deepEqual(report.wouldBlock, []);
  assert.deepEqual(report.shadow, {
    sampled: 0,
    errors: 0,
    blackBars: { checked: 0, detected: 0, rate: null, threshold: null },
    nearStatic: { checked: 0, detected: 0, rate: null, threshold: null },
  });
  assert.deepEqual(report.drift, { available: false });
});

test("状态桶：四个结论 + CHECKING 占位 + null / 未知值归「未质检」；比例按全部行计", () => {
  const rows = [
    row({ id: "a", frameQaStatus: "PASSED" }),
    row({ id: "b", frameQaStatus: "PASSED" }),
    row({ id: "c", frameQaStatus: "BLOCKED" }),
    row({ id: "d", frameQaStatus: "WOULD_BLOCK" }),
    row({ id: "e", frameQaStatus: "SKIPPED" }),
    row({ id: "f", frameQaStatus: "CHECKING" }),
    row({ id: "g", frameQaStatus: null }),
    row({ id: "h", frameQaStatus: "SOMETHING_NEW" }),
  ];
  const report = summarizeFrameQa(rows, 30);
  const byStatus = Object.fromEntries(report.byStatus.map((bucket) => [bucket.status, bucket]));
  assert.equal(report.total, 8);
  assert.equal(byStatus.PASSED.count, 2);
  assert.equal(byStatus.PASSED.ratio, 0.25);
  assert.equal(byStatus.BLOCKED.count, 1);
  assert.equal(byStatus.WOULD_BLOCK.count, 1);
  assert.equal(byStatus.SKIPPED.count, 1);
  assert.equal(byStatus.CHECKING.count, 1);
  assert.equal(byStatus.UNCHECKED.count, 2, "null 与未知状态值都算未质检");
  assert.equal(bucketOf(undefined), "UNCHECKED");
  assert.equal(bucketOf("WOULD_BLOCK"), "WOULD_BLOCK");
  assert.equal(FRAME_QA_BUCKETS.length, 6);
});

test("跳过原因：从 frameQaDetail.skipReason 取，按条数降序，比例按跳过行计；没写原因的单独一桶", () => {
  const rows = [
    row({ id: "1", frameQaStatus: "SKIPPED", frameQaDetail: { skipReason: "frame_qa_budget_time_exhausted" } }),
    row({ id: "2", frameQaStatus: "SKIPPED", frameQaDetail: { skipReason: "frame_qa_budget_time_exhausted" } }),
    row({ id: "2b", frameQaStatus: "SKIPPED", frameQaDetail: { skipReason: "frame_qa_budget_time_exhausted" } }),
    row({ id: "3", frameQaStatus: "SKIPPED", frameQaDetail: { skipReason: " 门禁未启用（FRAME_QA_DISABLED / mock 模式 / 未配置 vision key） " } }),
    row({ id: "4", frameQaStatus: "SKIPPED", frameQaDetail: { summary: "没有 skipReason" } }),
    row({ id: "5", frameQaStatus: "SKIPPED", frameQaDetail: "坏数据不是对象" }),
    /// PASSED 行就算带 skipReason 也不进分布
    row({ id: "6", frameQaStatus: "PASSED", frameQaDetail: { skipReason: "frame_qa_budget_time_exhausted" } }),
  ];
  const report = summarizeFrameQa(rows, 7);
  assert.deepEqual(report.skipReasons, [
    { reason: "frame_qa_budget_time_exhausted", count: 3, ratio: 0.5 },
    { reason: "(未记录原因)", count: 2, ratio: 2 / 6 },
    /// 归一化到前缀，原文留在 sample 给排障
    { reason: "门禁未启用", count: 1, ratio: 1 / 6, sample: "门禁未启用（FRAME_QA_DISABLED / mock 模式 / 未配置 vision key）" },
  ]);
});

test("跳过原因归一化：动态报文（异常信息 / 超时秒数）并进同一桶；稳定代码原样；未知原因截到第一个冒号或括号", () => {
  assert.equal(normalizeSkipReason("门禁执行异常：ECONNRESET"), "门禁执行异常");
  assert.equal(normalizeSkipReason("门禁执行异常：vision 返回了空响应"), "门禁执行异常");
  assert.equal(normalizeSkipReason("门禁超时（>45s）"), "门禁超时");
  assert.equal(normalizeSkipReason("门禁未启用（mock 模式或未配置）"), "门禁未启用");
  assert.equal(normalizeSkipReason("门禁未启用（FRAME_QA_DISABLED / mock 模式 / 未配置 vision key）"), "门禁未启用");
  assert.equal(normalizeSkipReason("视频 URL 不可下载"), "视频 URL 不可下载");
  assert.equal(normalizeSkipReason("供应商未返回视频地址"), "供应商未返回视频地址");
  assert.equal(normalizeSkipReason("frame_qa_budget_time_exhausted"), "frame_qa_budget_time_exhausted");
  assert.equal(normalizeSkipReason("ffmpeg exited 1: no such file"), "ffmpeg exited 1");
  assert.equal(normalizeSkipReason("something new (detail)"), "something new");

  const rows = [
    row({ id: "1", frameQaStatus: "SKIPPED", frameQaDetail: { skipReason: "门禁执行异常：ECONNRESET" } }),
    row({ id: "2", frameQaStatus: "SKIPPED", frameQaDetail: { skipReason: "门禁执行异常：ETIMEDOUT" } }),
    row({ id: "3", frameQaStatus: "SKIPPED", frameQaDetail: { skipReason: "门禁超时（>45s）" } }),
  ];
  const report = summarizeFrameQa(rows, 7);
  assert.deepEqual(report.skipReasons, [
    { reason: "门禁执行异常", count: 2, ratio: 2 / 3, sample: "门禁执行异常：ECONNRESET" },
    { reason: "门禁超时", count: 1, ratio: 1 / 3, sample: "门禁超时（>45s）" },
  ]);
});

test("状态桶可以来自库里的 groupBy：总数与比例按 groupBy 算，不受明细行数影响；null 归未质检", () => {
  const rows = [row({ id: "only-detail", frameQaStatus: "PASSED" })];
  const report = summarizeFrameQa(rows, 7, {
    statusCounts: [
      { frameQaStatus: "PASSED", count: 70 },
      { frameQaStatus: "BLOCKED", count: 5 },
      { frameQaStatus: "WOULD_BLOCK", count: 1 },
      { frameQaStatus: "SKIPPED", count: 4 },
      { frameQaStatus: "CHECKING", count: 2 },
      { frameQaStatus: null, count: 18 },
      { frameQaStatus: "WEIRD", count: 2 },
    ],
  });
  const byStatus = Object.fromEntries(report.byStatus.map((bucket) => [bucket.status, bucket]));
  assert.equal(report.total, 102);
  assert.equal(byStatus.PASSED.count, 70);
  assert.equal(byStatus.PASSED.ratio, 70 / 102);
  assert.equal(byStatus.UNCHECKED.count, 20, "null 与未知值都归未质检");
  assert.equal(byStatus.CHECKING.count, 2);
});

test("拦截事件数与当前状态分开：重抽后 PASSED 的段仍算一次拦截；坏的 blockCount 不计", () => {
  const rows = [
    row({ id: "1", frameQaStatus: "PASSED", frameQaDetail: { blockCount: 1 } }),
    row({ id: "2", frameQaStatus: "BLOCKED", frameQaDetail: { blockCount: 2 } }),
    row({ id: "3", frameQaStatus: "WOULD_BLOCK", frameQaDetail: { blockCount: 2 } }),
    row({ id: "4", frameQaStatus: "PASSED", frameQaDetail: { blockCount: 0 } }),
    row({ id: "5", frameQaStatus: "PASSED", frameQaDetail: { blockCount: "2" } }),
    row({ id: "6", frameQaStatus: "PASSED" }),
  ];
  const report = summarizeFrameQa(rows, 7);
  assert.deepEqual(report.blockEvents, { total: 5, rows: 3 });
  assert.equal(report.byStatus.find((bucket) => bucket.status === "BLOCKED")?.count, 1, "状态桶只数当前仍在拦截态的");
});

test("查询形状：最近质检排前、null 放最后（Postgres DESC 默认 NULLS FIRST 会让未质检行占满上限）；明细只拉进过门禁的行", () => {
  assert.deepEqual(FRAME_QA_REPORT_ORDER_BY, [
    { frameQaCheckedAt: { sort: "desc", nulls: "last" } },
    { createdAt: "desc" },
  ]);
  const since = new Date("2026-10-19T00:00:00.000Z");
  assert.deepEqual(frameQaReportWhere(since), {
    OR: [
      { frameQaCheckedAt: { gte: since } },
      { frameQaCheckedAt: null, status: "SUCCEEDED", createdAt: { gte: since } },
    ],
  });
  assert.deepEqual(frameQaDetailWhere(since), {
    AND: [frameQaReportWhere(since), { frameQaStatus: { not: null } }],
  });
  assert.equal(FRAME_QA_REPORT_MAX_DETAIL_ROWS, 3000);
});

test("跳过原因：超过 12 种时后面的合并成「其它」，条数不丢", () => {
  const rows = Array.from({ length: 15 }, (_, index) =>
    row({ id: `s${index}`, frameQaStatus: "SKIPPED", frameQaDetail: { skipReason: `reason-${String(index).padStart(2, "0")}` } }),
  );
  rows.push(row({ id: "dup", frameQaStatus: "SKIPPED", frameQaDetail: { skipReason: "reason-03" } }));
  const report = summarizeFrameQa(rows, 7);
  assert.equal(report.skipReasons.length, 13);
  assert.equal(report.skipReasons[0]?.reason, "reason-03", "最多的排最前");
  const tail = report.skipReasons.at(-1)!;
  assert.match(tail.reason, /其它 3 种/);
  assert.equal(tail.count, 3);
  assert.equal(report.skipReasons.reduce((sum, item) => sum + item.count, 0), 16);
});

test("影子检查：只数真的跑了的行（子项非 null），命中率 = 命中 / 跑过；没跑过写 null 不写 0", () => {
  const rows = [
    row({ id: "1", frameQaStatus: "PASSED", frameQaDetail: { shadow: shadow({ blackBars: { detected: true, threshold: 0.08 }, nearStatic: { detected: false, threshold: 0.6 } }) } }),
    row({ id: "2", frameQaStatus: "PASSED", frameQaDetail: { shadow: shadow({ blackBars: { detected: false, threshold: 0.08 }, nearStatic: { detected: true, threshold: 0.6 } }) } }),
    row({ id: "3", frameQaStatus: "BLOCKED", frameQaDetail: { shadow: shadow({ blackBars: { detected: false }, nearStatic: null }) } }),
    /// ffmpeg 自己失败：两项都 null，只记 error
    row({ id: "4", frameQaStatus: "PASSED", frameQaDetail: { shadow: shadow({ blackBars: null, nearStatic: null, error: "ffprobe timeout" }) } }),
    /// 门禁提前跳过：没有 shadow
    row({ id: "5", frameQaStatus: "SKIPPED", frameQaDetail: { skipReason: "x" } }),
    row({ id: "6", frameQaStatus: null }),
  ];
  const report = summarizeFrameQa(rows, 7);
  assert.equal(report.shadow.sampled, 4);
  assert.equal(report.shadow.errors, 1);
  assert.deepEqual(report.shadow.blackBars, { checked: 3, detected: 1, rate: 1 / 3, threshold: 0.08 });
  assert.deepEqual(report.shadow.nearStatic, { checked: 2, detected: 1, rate: 0.5, threshold: 0.6 });

  const none = summarizeFrameQa([row({ id: "x", frameQaStatus: "PASSED" })], 7);
  assert.equal(none.shadow.blackBars.rate, null);
});

test("放行待复核：只收 WOULD_BLOCK，按质检时刻倒序，带拦截次数 / 摘要 / 帧级检出 / 成片地址", () => {
  const rows = [
    row({
      id: "older",
      batchJobId: "batch-1",
      frameQaStatus: "WOULD_BLOCK",
      frameQaCheckedAt: at(0),
      outputVideoUrl: "https://blob/older.mp4",
      frameQaDetail: {
        summary: "第 2、5 帧检出叠加文字",
        blockCount: 2,
        issues: [
          { frameIndex: 1, detail: "字幕「又被曬醒了」" },
          { frameIndex: 4, detail: "右下角水印" },
        ],
      },
    }),
    row({
      id: "newer",
      frameQaStatus: "WOULD_BLOCK",
      frameQaCheckedAt: at(30),
      frameQaDetail: { summary: "第 1 帧检出叠加文字", blockCount: "bad", issues: "not-an-array" },
    }),
    row({ id: "blocked", frameQaStatus: "BLOCKED", frameQaCheckedAt: at(60), frameQaDetail: { summary: "拦截" } }),
    row({ id: "passed", frameQaStatus: "PASSED", frameQaCheckedAt: at(90) }),
  ];
  const report = summarizeFrameQa(rows, 30);
  assert.deepEqual(
    report.wouldBlock.map((item) => item.videoJobId),
    ["newer", "older"],
  );
  const older = report.wouldBlock[1]!;
  assert.equal(older.batchJobId, "batch-1");
  assert.equal(older.blockCount, 2);
  assert.equal(older.summary, "第 2、5 帧检出叠加文字");
  assert.deepEqual(older.issues, ["第 2 帧：字幕「又被曬醒了」", "第 5 帧：右下角水印"]);
  assert.equal(older.outputVideoUrl, "https://blob/older.mp4");
  assert.equal(older.checkedAt, at(0).toISOString());
  const newer = report.wouldBlock[0]!;
  assert.equal(newer.blockCount, 0, "坏的 blockCount 按 0");
  assert.deepEqual(newer.issues, [], "坏的 issues 按空");
  assert.equal(newer.batchJobId, null);
  assert.equal(newer.outputVideoUrl, null);
});

test("放行待复核：帧级检出最多列 6 条；清单最多 50 条", () => {
  const manyIssues = Array.from({ length: 10 }, (_, index) => ({ frameIndex: index, detail: `issue ${index}` }));
  const rows = Array.from({ length: 60 }, (_, index) =>
    row({
      id: `wb-${index}`,
      frameQaStatus: "WOULD_BLOCK",
      frameQaCheckedAt: at(index),
      frameQaDetail: { summary: "s", blockCount: 2, issues: manyIssues },
    }),
  );
  const report = summarizeFrameQa(rows, 30);
  assert.equal(report.wouldBlock.length, 50);
  assert.equal(report.wouldBlock[0]?.videoJobId, "wb-59", "最近的排最前");
  assert.equal(report.wouldBlock[0]?.issues.length, 6);
});

test("漂移：没有任何行带 drift → 未接入；有就按最保守口径汇总（detected / flagged / ok=false 算命中，score 取平均）", () => {
  const none = summarizeFrameQa([row({ id: "1", frameQaStatus: "PASSED", frameQaDetail: { summary: "x" } })], 7);
  assert.deepEqual(none.drift, { available: false });

  const rows = [
    row({ id: "1", frameQaStatus: "PASSED", frameQaDetail: { drift: { detected: true, score: 0.9 } } }),
    row({ id: "2", frameQaStatus: "PASSED", frameQaDetail: { drift: { flagged: true } } }),
    row({ id: "3", frameQaStatus: "PASSED", frameQaDetail: { drift: { ok: false, score: 0.7 } } }),
    row({ id: "4", frameQaStatus: "PASSED", frameQaDetail: { drift: { detected: false, score: 0.2 } } }),
    row({ id: "5", frameQaStatus: "PASSED", frameQaDetail: { drift: "bad" } }),
    row({ id: "6", frameQaStatus: "PASSED" }),
  ];
  const report = summarizeFrameQa(rows, 7);
  assert.deepEqual(report.drift, {
    available: true,
    rows: 4,
    flagged: 3,
    flaggedRate: 0.75,
    meanScore: (0.9 + 0.7 + 0.2) / 3,
  });
});

test("窗口只认 7 / 30，其它一律回到 7", () => {
  assert.equal(clampFrameQaWindow("7"), 7);
  assert.equal(clampFrameQaWindow("30"), 30);
  assert.equal(clampFrameQaWindow("90"), 7);
  assert.equal(clampFrameQaWindow("abc"), 7);
  assert.equal(clampFrameQaWindow(undefined), 7);
});
