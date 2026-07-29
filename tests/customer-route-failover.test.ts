import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CUSTOMER_FAILOVER_ROUTE_ID,
  customerFailoverRouteSnapshot,
  selectVideoRouteSnapshot,
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

test("dispatch 只在主线路仍是 buddy 且不可用时才 503；余额不足不降级", async () => {
  const source = await readFile(
    "src/app/api/video-generation/dispatch/route.ts",
    "utf8",
  );
  assert.match(source, /customerFailoverRouteSnapshot\(\)/);
  /// 余额不足是账户问题，换线路只会把成本转嫁到另一条线上
  assert.match(
    source,
    /reason === "insufficient_balance"\s*\?\s*null\s*:\s*customerFailoverRouteSnapshot/,
  );
  /// 降级成功后不能再落到 503 分支
  assert.match(
    source,
    /!selectedRouteAvailability\.available &&\s*videoRouteSnapshot\.videoRouteSnapshot === "buddy"/,
  );
  /// 降级前必须复核备用线路真的可用
  assert.match(source, /failoverAvailability\.available/);
});
