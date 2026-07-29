import assert from "node:assert/strict";
import test from "node:test";
import { VideoJobStatus } from "@prisma/client";
import {
  MIN_ROUTE_HEALTH_SAMPLES,
  UNHEALTHY_SUCCESS_RATE,
  findRouteHealth,
  summarizeVideoRouteHealth,
  type VideoRouteJobSample,
} from "../src/lib/services/video-route-health-service";

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
