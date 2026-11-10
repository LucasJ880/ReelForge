/**
 * 线路精简（2026-11-09，Lucas 定）：对外线路只留 Shuyu（出图 / 出片）、Runway（出片备选）与只做出方案的 OpenAI。
 * 这里守住 A 级下线的三件事：入口关着、已下线的线路不进客户视图、它们出错不叫醒人。
 * 出片兜底只在 Shuyu ⇄ Runway 之间的断言在 customer-route-failover.test.ts。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CAPABILITY_KEYS,
  RETIRED_CAPABILITY_KEYS,
  RETIRED_FEATURE_KEYS,
  isRetiredCapability,
  resolveCapabilities,
  withoutRetiredCapabilities,
  type CapabilityKey,
  type CapabilityRecord,
} from "../src/lib/capabilities/registry";
import {
  BROLL_ROUTE_ENTRY_ENABLED,
  PRODUCT_ANCHOR_ENTRY_ENABLED,
  PRODUCT_LINK_ENTRY_ENABLED,
} from "../src/lib/create/entry-policy";
import { capabilityTransitionAlert } from "../src/lib/services/ops-alert-service";

const NOW = new Date("2026-11-09T12:00:00.000Z");
const ALL_CONFIGURED = Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, true])) as Record<CapabilityKey, boolean>;

function record(key: CapabilityKey, status: CapabilityRecord["status"], reason: CapabilityRecord["reason"]): CapabilityRecord {
  return {
    key,
    status,
    reason,
    source: "probe",
    checkedAt: NOW.toISOString(),
    failingSince: status === "available" ? null : NOW.toISOString(),
  };
}

const read = (path: string) => readFileSync(path, "utf8");

test("下线清单：配音、审核、实拍图库、链接抓取、抠图；留下的是出方案、出图、出片", () => {
  assert.deepEqual([...RETIRED_CAPABILITY_KEYS].sort(), ["cutout", "moderation", "scrape", "stock", "voice"]);
  for (const key of ["text", "vision", "image", "graphics", "video", "email"] as const) {
    assert.equal(isRetiredCapability(key), false, key);
  }
});

test("三个背着外部线路的入口都关着（A 级：只撤入口，组件与接口保留）", () => {
  assert.equal(BROLL_ROUTE_ENTRY_ENABLED, false, "实拍图库线路（Pexels + 配音）");
  assert.equal(PRODUCT_LINK_ENTRY_ENABLED, false, "贴商品链接（Firecrawl）");
  assert.equal(PRODUCT_ANCHOR_ENTRY_ENABLED, false, "商品主体抠图（remove.bg）");

  const studio = read("src/components/video-generation/streamlined-video-studio.tsx");
  assert.match(studio, /\{PRODUCT_LINK_ENTRY_ENABLED \? \(/, "贴链接按钮受开关控制");
  assert.match(studio, /\{PRODUCT_LINK_ENTRY_ENABLED && linkOpen \? \(/, "预填面板受开关控制");
  const brands = read("src/app/(platform)/app/brands/page.tsx");
  assert.match(brands, /\{PRODUCT_ANCHOR_ENTRY_ENABLED \? \(\s*<ProductAnchorManager/, "商品主体管理受开关控制");
  assert.match(brands, /PRODUCT_ANCHOR_ENTRY_ENABLED \? listProductAnchorsForUser/, "不展示就不查");

  /// 组件与接口还在：放回只需改开关
  for (const kept of [
    "src/components/video-generation/product-link-prefill.tsx",
    "src/app/api/product-link/route.ts",
    "src/components/brand/product-anchor-manager.tsx",
    "src/app/api/product-anchors/route.ts",
    "src/app/api/broll/cancel/route.ts",
  ]) {
    assert.ok(read(kept).length > 0, kept);
  }
});

test("客户视图：已下线的线路不列出、不计数；一条不用的线路出错不点亮「部分 AI 能力暂停」", () => {
  const full = resolveCapabilities({
    records: [
      record("voice", "unavailable", "permission"),
      record("stock", "degraded", "upstream"),
      record("video", "available", "ok"),
    ],
    configured: ALL_CONFIGURED,
    now: NOW,
  });
  assert.equal(full.items.length, CAPABILITY_KEYS.length, "完整视图不变：功能闸门与探测照旧用它");
  assert.equal(full.paused, true);

  const customer = withoutRetiredCapabilities(full);
  assert.deepEqual(
    customer.items.map((item) => item.key),
    CAPABILITY_KEYS.filter((key) => !isRetiredCapability(key)),
  );
  assert.equal(customer.paused, false, "配音 403 不再让壳层报暂停");
  const writing = customer.items.find((item) => item.key === "text");
  assert.ok(writing && !writing.features.includes("broll"), "「影响哪些功能」里不再列入口已撤的实拍图库线路");
  assert.ok(writing.features.includes("contentPlanWriting"), "仍在用的功能照列");
  assert.equal(customer.unstable, false, "图库不稳也不算");
  assert.equal(
    Object.values(customer.counts).reduce((sum, count) => sum + count, 0),
    customer.items.length,
    "计数与列出的行一致",
  );
});

test("客户视图：留下的线路出问题照样报", () => {
  const customer = withoutRetiredCapabilities(
    resolveCapabilities({
      records: [record("video", "unavailable", "quota"), record("voice", "available", "ok")],
      configured: ALL_CONFIGURED,
      now: NOW,
    }),
  );
  assert.equal(customer.paused, true);
  assert.equal(customer.counts.unavailable >= 1, true);
});

test("客户视图接在状态页、壳层与 /api/capabilities 三处；创作页的功能闸门仍用完整视图", () => {
  for (const path of [
    "src/app/(platform)/app/status/page.tsx",
    "src/app/(platform)/app/layout.tsx",
    "src/app/api/capabilities/route.ts",
  ]) {
    assert.match(read(path), /withoutRetiredCapabilities\(/, path);
  }
  assert.doesNotMatch(read("src/app/(platform)/app/create/page.tsx"), /withoutRetiredCapabilities/);
});

test("运维告警：已下线的线路翻转不叫醒人；出片、看图照报", () => {
  for (const key of RETIRED_CAPABILITY_KEYS) {
    assert.equal(
      capabilityTransitionAlert({ status: "available" }, { key, status: "unavailable", reason: "quota" }),
      null,
      key,
    );
    assert.equal(capabilityTransitionAlert({ status: "unavailable" }, { key, status: "available", reason: "ok" }), null, key);
  }
  assert.equal(
    capabilityTransitionAlert({ status: "available" }, { key: "video", status: "unavailable", reason: "quota" })?.kind,
    "capability_down",
  );
  assert.equal(
    capabilityTransitionAlert({ status: "available" }, { key: "vision", status: "unavailable", reason: "quota" })?.kind,
    "capability_down",
  );
});

test("画面质检缺省关之后：状态页「影响哪些功能」不再列画面质检；看图这项能力本身还在（出方案看商品图）", () => {
  assert.deepEqual([...RETIRED_FEATURE_KEYS], ["frameQa"]);
  const full = resolveCapabilities({ records: [record("vision", "available", "ok")], configured: ALL_CONFIGURED, now: NOW });
  const fullVision = full.items.find((item) => item.key === "vision");
  assert.ok(fullVision?.features.includes("frameQa"), "完整视图不变");
  const vision = withoutRetiredCapabilities(full).items.find((item) => item.key === "vision");
  assert.ok(vision, "看图能力仍在客户视图里");
  assert.equal(vision.features.includes("frameQa"), false);
  assert.match(vision.message["zh-CN"], /商品图/);
});
