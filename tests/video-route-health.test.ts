import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { VideoJobStatus } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  MIN_ROUTE_HEALTH_SAMPLES,
  UNHEALTHY_SUCCESS_RATE,
  findRouteHealth,
  getVideoRouteHealthReport,
  summarizeVideoRouteHealth,
  type VideoRouteJobSample,
} from "../src/lib/services/video-route-health-service";
import {
  RUN_KEY_DEFAULT_WINDOW_HOURS,
  parseReportArgs,
  renderMarkdown,
  reportRows,
} from "../scripts/report-video-route-health";

const BASE = new Date("2026-07-29T00:00:00.000Z");

function sample(
  overrides: Partial<VideoRouteJobSample> & { routeId?: string } = {},
): VideoRouteJobSample {
  const { routeId, ...rest } = overrides;
  return {
    videoRouteSnapshot: routeId ?? "buddy",
    videoModelSnapshot: "studio-video",
    status: VideoJobStatus.SUCCEEDED,
    submittedAt: BASE,
    finishedAt: new Date(BASE.getTime() + 60_000),
    providerUnitPriceUsd: 1,
    providerUnitPoints: 900,
    ...rest,
  };
}

test("空样本时每条注册线路都在结果里，且判为样本不足而非有罪", () => {
  const report = summarizeVideoRouteHealth([]);
  const buddy = findRouteHealth(report, "buddy");
  assert.ok(buddy);
  assert.equal(buddy.samples, 0);
  assert.equal(buddy.successRate, null);
  assert.equal(buddy.insufficientData, true);
  assert.equal(buddy.healthy, true, "没有证据不等于线路坏了，不能因此阻断生成");
  assert.ok(findRouteHealth(report, "byteplus_international"));
});

test("成功率只按成功/失败计算，用户取消不算线路的错", () => {
  const rows = [
    ...Array.from({ length: 6 }, () => sample()),
    ...Array.from({ length: 2 }, () => sample({ status: VideoJobStatus.FAILED })),
    ...Array.from({ length: 5 }, () => sample({ status: VideoJobStatus.CANCELLED })),
  ];
  const buddy = findRouteHealth(summarizeVideoRouteHealth(rows), "buddy")!;
  assert.equal(buddy.succeeded, 6);
  assert.equal(buddy.failed, 2);
  assert.equal(buddy.cancelled, 5);
  assert.equal(buddy.successRate, 6 / 8);
  assert.equal(buddy.healthy, true);
});

test("成功率跌破阈值且样本足够时判为不健康", () => {
  const rows = [
    ...Array.from({ length: 2 }, () => sample()),
    ...Array.from({ length: 8 }, () => sample({ status: VideoJobStatus.FAILED })),
  ];
  const buddy = findRouteHealth(summarizeVideoRouteHealth(rows), "buddy")!;
  assert.ok(buddy.successRate !== null && buddy.successRate < UNHEALTHY_SUCCESS_RATE);
  assert.equal(buddy.insufficientData, false);
  assert.equal(buddy.healthy, false);
});

test("样本不足时即使全失败也不下不健康结论（避免抖动切线路）", () => {
  const rows = Array.from({ length: MIN_ROUTE_HEALTH_SAMPLES - 1 }, () =>
    sample({ status: VideoJobStatus.FAILED }),
  );
  const buddy = findRouteHealth(summarizeVideoRouteHealth(rows), "buddy")!;
  assert.equal(buddy.insufficientData, true);
  assert.equal(buddy.healthy, true);
});

test("耗时分位只统计成功样本，且用最近秩法不造出不存在的耗时", () => {
  const durations = [10_000, 20_000, 30_000, 40_000, 100_000];
  const rows = durations.map((ms) =>
    sample({ finishedAt: new Date(BASE.getTime() + ms) }),
  );
  rows.push(
    sample({
      status: VideoJobStatus.FAILED,
      finishedAt: new Date(BASE.getTime() + 900_000),
    }),
  );
  const buddy = findRouteHealth(summarizeVideoRouteHealth(rows), "buddy")!;
  assert.ok(durations.includes(buddy.p50DurationMs!));
  assert.equal(buddy.p50DurationMs, 30_000);
  assert.equal(buddy.p95DurationMs, 100_000);
});

test("时钟倒挂与缺时间戳的样本被丢弃，不污染分位数", () => {
  const rows = [
    sample({ finishedAt: new Date(BASE.getTime() - 5_000) }),
    sample({ submittedAt: null }),
    sample({ finishedAt: new Date(BASE.getTime() + 42_000) }),
  ];
  const buddy = findRouteHealth(summarizeVideoRouteHealth(rows), "buddy")!;
  assert.equal(buddy.p50DurationMs, 42_000);
});

test("单条成本只平均有价格的成功样本，缺价格不算 0", () => {
  const rows = [
    sample({ providerUnitPriceUsd: 2 }),
    sample({ providerUnitPriceUsd: 4 }),
    sample({ providerUnitPriceUsd: null }),
  ];
  const buddy = findRouteHealth(summarizeVideoRouteHealth(rows), "buddy")!;
  assert.equal(buddy.avgCostUsd, 3);
});

test("积分计价与美元计价并存，各自独立统计且不互相换算", () => {
  const rows = [
    sample({ providerUnitPriceUsd: null, providerUnitPoints: 900 }),
    sample({ providerUnitPriceUsd: null, providerUnitPoints: 900 }),
    sample({ providerUnitPriceUsd: null, providerUnitPoints: null }),
  ];
  const buddy = findRouteHealth(summarizeVideoRouteHealth(rows), "buddy")!;
  assert.equal(buddy.avgCostPoints, 900);
  assert.equal(buddy.avgCostUsd, null, "没有美元快照时不能拿积分顶替");
});

test("历史行没有线路证据时整条丢弃，不按 provider 反推", () => {
  const rows = [
    sample({ routeId: undefined, videoRouteSnapshot: null }),
    sample(),
  ];
  const report = summarizeVideoRouteHealth(rows);
  assert.equal(findRouteHealth(report, "buddy")!.samples, 1);
});

test("多线路互不串味", () => {
  const rows = [
    sample({ routeId: "buddy", status: VideoJobStatus.FAILED }),
    sample({ routeId: "byteplus_international" }),
    sample({ routeId: "byteplus_international" }),
  ];
  const report = summarizeVideoRouteHealth(rows);
  assert.equal(findRouteHealth(report, "buddy")!.succeeded, 0);
  assert.equal(findRouteHealth(report, "byteplus_international")!.succeeded, 2);
});

/* ── X-SCAF-0：按批次筛（实验对照） ───────────────────────────────────── */

type Calls = Record<string, unknown[]>;

/** 把 db.<model>.<method> 换成桩，记录每次的入参；测试结束还原。 */
function stub(t: TestContext, calls: Calls, model: string, method: string, impl: (args: unknown) => unknown) {
  const target = (db as unknown as Record<string, Record<string, unknown>>)[model];
  const original = target[method];
  target[method] = async (args: unknown) => {
    (calls[`${model}.${method}`] ??= []).push(args);
    return impl(args);
  };
  t.after(() => {
    target[method] = original;
  });
}

type FindManyArgs = { where: { batchJobId?: { in: string[] }; status: unknown; finishedAt: unknown }; take: number };

test("读库版：传 batchJobIds 时 where 里按 batchJobId in 筛，其余判据不变", async (t) => {
  const calls: Calls = {};
  stub(t, calls, "videoJob", "findMany", () => [
    { videoRouteSnapshot: "buddy", videoModelSnapshot: "studio-video", status: VideoJobStatus.SUCCEEDED, submittedAt: BASE, finishedAt: new Date(BASE.getTime() + 60_000), providerUnitPriceUsd: null, providerUnitPoints: 900 },
  ]);
  const report = await getVideoRouteHealthReport({ windowHours: 48, batchJobIds: ["batch-a", "batch-b"] });
  const args = calls["videoJob.findMany"]![0] as FindManyArgs;
  assert.deepEqual(args.where.batchJobId, { in: ["batch-a", "batch-b"] });
  assert.deepEqual(args.where.status, { in: ["SUCCEEDED", "FAILED", "CANCELLED"] }, "终态判据照旧");
  assert.ok(args.where.finishedAt, "时间窗照旧");
  assert.equal(findRouteHealth(report, "buddy")!.avgCostPoints, 900);
});

test("读库版：不传 batchJobIds 时 where 里没有 batchJobId（全量口径不变）", async (t) => {
  const calls: Calls = {};
  stub(t, calls, "videoJob", "findMany", () => []);
  await getVideoRouteHealthReport({ windowHours: 1 });
  const args = calls["videoJob.findMany"]![0] as FindManyArgs;
  assert.equal("batchJobId" in args.where, false);
});

test("读库版：空数组 = 一条不看，不退回全量", async (t) => {
  const calls: Calls = {};
  stub(t, calls, "videoJob", "findMany", () => []);
  await getVideoRouteHealthReport({ batchJobIds: [] });
  const args = calls["videoJob.findMany"]![0] as FindManyArgs;
  assert.deepEqual(args.where.batchJobId, { in: [] });
});

/* ── 速查脚本：--run-key / --md 与积分列 ────────────────────────────── */

test("速查脚本参数：窗口小时数、--run-key=<前缀>、--md；坏参数直接报错", () => {
  assert.deepEqual(parseReportArgs([]), { windowHours: null, runKey: null, md: false });
  assert.deepEqual(parseReportArgs(["72"]), { windowHours: 72, runKey: null, md: false });
  assert.deepEqual(parseReportArgs(["--run-key=exp-2611-bakeoff", "--md"]), { windowHours: null, runKey: "exp-2611-bakeoff", md: true });
  assert.throws(() => parseReportArgs(["--run-key"]), /--run-key=<前缀>/);
  assert.throws(() => parseReportArgs(["--run-key="]), /幂等键前缀/);
  assert.throws(() => parseReportArgs(["--nope"]), /不认识的参数/);
  assert.equal(RUN_KEY_DEFAULT_WINDOW_HOURS, 24 * 30, "--run-key 默认窗口 30 天");
});

test("速查脚本 markdown：每条线路一行，带单条积分列，标题写运行键与批次数", () => {
  const report = summarizeVideoRouteHealth(
    [
      sample({ providerUnitPriceUsd: null, providerUnitPoints: 900 }),
      sample({ providerUnitPriceUsd: null, providerUnitPoints: 700 }),
      sample({ routeId: "byteplus_international", providerUnitPriceUsd: 0.5, providerUnitPoints: null }),
    ],
    { windowHours: 720, generatedAt: BASE },
  );
  const md = renderMarkdown(report, { runKey: "exp-2611-bakeoff", batchCount: 2 });
  assert.match(md, /^### 线路健康画像 · 运行键 `exp-2611-bakeoff`（2 个批次） · 最近 720 小时/);
  assert.match(md, /\| 线路 \| 模型 \| 样本 \| 成功 \| 失败 \| 取消 \| 成功率 \| P50 \| P95 \| 单条成本 \| 单条积分 \| 判定 \|/);
  assert.match(md, /\| buddy \| studio-video \| 2 \| 2 \| 0 \| 0 \| 100\.0% \| 1\.0 分 \| 1\.0 分 \| — \| 800 \| 样本不足 \|/);
  assert.match(md, /\| byteplus_international \| studio-video \| 1 \| 1 \| 0 \| 0 \| 100\.0% \| 1\.0 分 \| 1\.0 分 \| \$0\.5000 \| — \| 样本不足 \|/);
  /// 没有运行键时标题只写窗口
  assert.match(renderMarkdown(report), /^### 线路健康画像 · 最近 720 小时\n/);
  /// 终端表格也带积分列
  assert.ok(Object.keys(reportRows(report)[0]).includes("单条积分"));
});
