import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createVideoRouteSnapshot,
  type VideoRouteSnapshot,
} from "../src/lib/video-generation/video-route-registry";
import {
  CUSTOMER_FAILOVER_ROUTE_ID,
  customerFailoverRouteSnapshot,
  resolveRouteWithFailover,
  type RouteFailoverDeps,
  selectVideoRouteSnapshot,
  type VideoRouteRuntimeAvailability,
  VideoRouteSelectionError,
} from "../src/lib/video-generation/video-route-selection";

const REAL_ENV = {
  VIDEO_PROVIDER: "byteplus",
  VIDEO_ENGINE_MOCK: "false",
  SEEDANCE_RUNTIME_PROFILE: "byteplus_international",
  /// volcengine_cn_legacy realm 的凭据（与 BYTEPLUS_ARK_API_KEY 分属不同账号域）
  ARK_API_KEY: "test-ark-key",
  /// 故意不设 ARK_BASE_URL：它是全局单值，两个 realm 只能满足一个。
  /// 不设时每条线路各自解析到自己的正确端点，这也是生产必须保持的状态。
};

/**
 * 2026-07-29：buddy(Shuyu) 最近 7 天成功率 28.6%，而它是客户唯一线路 —— 单点无出口。
 * 允许平台在主线路不可用时自动降级，但客户自己选线路的权限必须原样封死。
 */
test("降级不等于把选择权交给客户：显式请求备用线路照旧 FORBIDDEN", () => {
  assert.throws(
    () =>
      selectVideoRouteSnapshot({
        requestedRouteId: CUSTOMER_FAILOVER_ROUTE_ID,
        isInternalStaff: false,
        env: REAL_ENV,
      }),
    (error) =>
      error instanceof VideoRouteSelectionError && error.code === "FORBIDDEN",
  );
});

test("备用线路配置齐全时给出可用快照", () => {
  const snapshot = customerFailoverRouteSnapshot(REAL_ENV);
  assert.ok(snapshot);
  assert.equal(snapshot.videoRouteSnapshot, CUSTOMER_FAILOVER_ROUTE_ID);
  assert.equal(snapshot.videoProviderAdapterSnapshot, "byteplus");
  assert.ok(snapshot.videoModelSnapshot);
});

test("备用线路没配好时返回 null，而不是把用户丢进必死的提交", () => {
  const withoutKey = { ...REAL_ENV, ARK_API_KEY: "" };
  assert.equal(customerFailoverRouteSnapshot(withoutKey), null);
});

/**
 * 生产陷阱：ARK_BASE_URL 是全局单值。它一旦被设成 byteplus 端点，
 * volcengine_cn_legacy 就会被跨域校验硬拒（凭据分属不同账号域，绝不交叉接线），
 * 于是降级静默失效 —— 代码没错，配置让它永远返回 null。
 */
test("ARK_BASE_URL 指向另一个 realm 时备用线路不可用", () => {
  assert.equal(
    customerFailoverRouteSnapshot({
      ...REAL_ENV,
      ARK_BASE_URL: "https://ark.ap-southeast.bytepluses.com/api/v3",
    }),
    null,
  );
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
        ? createVideoRouteSnapshot(CUSTOMER_FAILOVER_ROUTE_ID)
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
    CUSTOMER_FAILOVER_ROUTE_ID,
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
  assert.equal(result.snapshot.videoRouteSnapshot, CUSTOMER_FAILOVER_ROUTE_ID);
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
