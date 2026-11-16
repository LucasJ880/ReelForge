import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createVideoRouteSnapshot,
  type VideoRouteSnapshot,
} from "../src/lib/video-generation/video-route-registry";
import {
  customerFailoverRouteSnapshot,
  resolveRouteWithFailover,
  type RouteFailoverDeps,
  selectVideoRouteSnapshot,
  type VideoRouteRuntimeAvailability,
  VideoRouteSelectionError,
} from "../src/lib/video-generation/video-route-selection";

/// resolveRouteWithFailover 的机制用例里充当「备用线路」的那条（经 deps 注入）。
/// 2026-11-16 Runway 下线后真实配置里 Shuyu 已没有备用（见下面的下线用例），机制本身保留。
const BACKUP_ROUTE_ID = "runway";
/// 已下线的旧降级目标（火山引擎直连）：客户入口撤了，内部脚本仍可点名
const RETIRED_FAILOVER_ROUTE_ID = "volcengine_cn_legacy";

const REAL_ENV = {
  VIDEO_PROVIDER: "byteplus",
  VIDEO_ENGINE_MOCK: "false",
  SEEDANCE_RUNTIME_PROFILE: "byteplus_international",
  SHUYU_API_KEY: "test-shuyu-key",
  RUNWAYML_API_SECRET: "test-runway-key",
  /// 火山直连的凭据即使还配着，也不再被当成备用线路
  ARK_API_KEY: "test-ark-key",
};

/**
 * 2026-07-29：buddy(Shuyu) 最近 7 天成功率 28.6%，而它是客户唯一线路 —— 单点无出口。
 * 允许平台在主线路不可用时自动降级，但客户自己选线路的权限必须原样封死。
 */
test("降级不等于把选择权交给客户：显式请求备用线路照旧 FORBIDDEN", () => {
  assert.throws(
    () =>
      selectVideoRouteSnapshot({
        requestedRouteId: RETIRED_FAILOVER_ROUTE_ID,
        isInternalStaff: false,
        env: REAL_ENV,
      }),
    (error) =>
      error instanceof VideoRouteSelectionError && error.code === "FORBIDDEN",
  );
});

test("2026-11-16 Runway 下线：Shuyu 没有备用线路；下线前交给 Runway 的任务失败仍改交 Shuyu", () => {
  /// Runway 的 key 还配着、开关没关，也不再是 Shuyu 的备用
  for (const primary of ["buddy", undefined] as const) {
    assert.equal(customerFailoverRouteSnapshot(REAL_ENV, primary), null, String(primary));
    assert.equal(customerFailoverRouteSnapshot({ ...REAL_ENV, SHUYU_FALLBACK_TO_RUNWAY: "on" }, primary), null);
  }
  const backup = customerFailoverRouteSnapshot(REAL_ENV, "runway");
  assert.ok(backup);
  assert.equal(backup.videoRouteSnapshot, "buddy");
  assert.ok(backup.videoModelSnapshot);
});

test("备用线路没配好时返回 null，而不是把用户丢进必死的提交", () => {
  assert.equal(customerFailoverRouteSnapshot({ ...REAL_ENV, SHUYU_API_KEY: "" }, "runway"), null);
});

test("线路精简（2026-11-09）：火山直连不再是任何主线路的备用，凭据还配着也不行", () => {
  /// 以前「Runway 没开」或「主线路不是 buddy / runway」时会降到 volcengine_cn_legacy（账户已欠费）
  for (const env of [REAL_ENV, { ...REAL_ENV, RUNWAYML_API_SECRET: "" }]) {
    for (const primary of ["buddy", "byteplus_international", RETIRED_FAILOVER_ROUTE_ID, undefined]) {
      assert.equal(customerFailoverRouteSnapshot(env, primary), null, String(primary));
    }
    /// 备用只可能是 Shuyu（只给下线前的 Runway 任务用），绝不会是火山直连
    assert.equal(customerFailoverRouteSnapshot(env, "runway")?.videoRouteSnapshot, "buddy");
  }
});

test("mock 演练不参与降级，保持确定性", () => {
  assert.equal(
    customerFailoverRouteSnapshot({
      ...REAL_ENV,
      VIDEO_ENGINE_MOCK: "true",
    }),
    null,
  );
});

function availability(
  reason: VideoRouteRuntimeAvailability["reason"],
): VideoRouteRuntimeAvailability {
  return reason === null
    ? { available: true, funded: true, reason: null }
    : { available: false, funded: reason !== "insufficient_balance", reason };
}

/// 注入依赖的记录桩：availability 按调用顺序出队，failover 快照可配
function fakeDeps(args: {
  availabilities: VideoRouteRuntimeAvailability[];
  failover?: VideoRouteSnapshot | null;
}) {
  const calls = {
    availability: [] as Array<{ snapshot: VideoRouteSnapshot; shuyuRequiredPoints?: number }>,
    failoverSnapshot: 0,
  };
  const queue = [...args.availabilities];
  const deps: RouteFailoverDeps = {
    getAvailability: async (input) => {
      calls.availability.push(input);
      const next = queue.shift();
      assert.ok(next, "unexpected availability probe");
      return next;
    },
    failoverSnapshot: () => {
      calls.failoverSnapshot += 1;
      return args.failover === undefined
        ? createVideoRouteSnapshot(BACKUP_ROUTE_ID)
        : args.failover;
    },
  };
  return { deps, calls };
}

const BUDDY = createVideoRouteSnapshot("buddy");

test("主线路可用：不探备用线路，快照原样返回", async () => {
  const { deps, calls } = fakeDeps({ availabilities: [availability(null)] });
  const result = await resolveRouteWithFailover({
    snapshot: BUDDY,
    shuyuRequiredPoints: 1_400,
    allowFailover: true,
    deps,
  });
  assert.equal(result.snapshot, BUDDY);
  assert.equal(result.failedOver, false);
  assert.equal(result.primaryAvailability.available, true);
  assert.deepEqual(calls.availability, [
    { snapshot: BUDDY, shuyuRequiredPoints: 1_400 },
  ]);
  assert.equal(calls.failoverSnapshot, 0);
});

test("余额不足不降级：换线路只会把成本转嫁到另一条线上", async () => {
  const { deps, calls } = fakeDeps({
    availabilities: [availability("insufficient_balance")],
  });
  const result = await resolveRouteWithFailover({
    snapshot: BUDDY,
    allowFailover: true,
    deps,
  });
  assert.equal(result.snapshot, BUDDY);
  assert.equal(result.failedOver, false);
  assert.equal(result.primaryAvailability.reason, "insufficient_balance");
  assert.equal(calls.failoverSnapshot, 0);
  assert.equal(calls.availability.length, 1);
});

test("备用线路未配置：保持原快照，由调用方按原原因 503", async () => {
  const { deps, calls } = fakeDeps({
    availabilities: [availability("upstream_unavailable")],
    failover: null,
  });
  const result = await resolveRouteWithFailover({
    snapshot: BUDDY,
    allowFailover: true,
    deps,
  });
  assert.equal(result.snapshot, BUDDY);
  assert.equal(result.failedOver, false);
  assert.equal(result.primaryAvailability.reason, "upstream_unavailable");
  assert.equal(calls.failoverSnapshot, 1);
  assert.equal(calls.availability.length, 1);
});

test("降级前必须复核备用线路：备用不可用时不切换", async () => {
  const { deps, calls } = fakeDeps({
    availabilities: [availability("timeout"), availability("not_configured")],
  });
  const result = await resolveRouteWithFailover({
    snapshot: BUDDY,
    allowFailover: true,
    deps,
  });
  assert.equal(result.snapshot, BUDDY);
  assert.equal(result.failedOver, false);
  assert.equal(result.primaryAvailability.reason, "timeout");
  assert.equal(calls.availability.length, 2);
  assert.equal(
    calls.availability[1]?.snapshot.videoRouteSnapshot,
    BACKUP_ROUTE_ID,
  );
  /// 备用线路不是买断线路，不带积分需求
  assert.equal(calls.availability[1]?.shuyuRequiredPoints, undefined);
});

test("成功降级：返回备用快照，原线路的不可用原因原样保留", async () => {
  const { deps } = fakeDeps({
    availabilities: [availability("upstream_unavailable"), availability(null)],
  });
  const result = await resolveRouteWithFailover({
    snapshot: BUDDY,
    shuyuRequiredPoints: 700,
    allowFailover: true,
    deps,
  });
  assert.equal(result.failedOver, true);
  assert.equal(result.snapshot.videoRouteSnapshot, BACKUP_ROUTE_ID);
  assert.equal(result.primaryAvailability.available, false);
  assert.equal(result.primaryAvailability.reason, "upstream_unavailable");
});

test("allowFailover:false：上游不可用也绝不碰备用线路", async () => {
  const { deps, calls } = fakeDeps({
    availabilities: [availability("upstream_unavailable")],
  });
  const result = await resolveRouteWithFailover({
    snapshot: BUDDY,
    allowFailover: false,
    deps,
  });
  assert.equal(result.snapshot, BUDDY);
  assert.equal(result.failedOver, false);
  assert.equal(calls.failoverSnapshot, 0);
  assert.equal(calls.availability.length, 1);
});

test("dispatch 单条允许降级、批量禁止降级", async () => {
  const [dispatchSource, batchSource] = await Promise.all([
    readFile("src/app/api/video-generation/dispatch/route.ts", "utf8"),
    readFile("src/lib/services/batch-service.ts", "utf8"),
  ]);
  assert.match(
    dispatchSource,
    /resolveRouteWithFailover\(\{[\s\S]*?allowFailover:\s*true/,
  );
  assert.match(
    batchSource,
    /resolveRouteWithFailover\(\{[\s\S]*?allowFailover:\s*false/,
  );
});
