import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { videoRouteCatalogSchema } from "../src/lib/contracts/video-route-catalog";
import {
  RUNWAY_PREMIUM_MODEL_LABEL,
  buildVideoRouteCatalog,
  shuyuFamilyLabel,
} from "../src/lib/services/video-route-catalog-service";

/**
 * 2026-10-29 Evan：Shuyu 作默认线路，Shuyu 开放给我们的类别全部展示在前端；Runway 作高质量备选。
 * 夹具取自当天 /prices 实拉的几档（105 档里的代表）：Seedance 2.5 特价 / VIP、Kling 4.0、Wan 3.0、Seedance 2.0 VIP 4K。
 */
const plan = (
  planId: string,
  displayName: string,
  resolution: string,
  unit: "generation" | "second",
  points: number,
  durations: number[],
) => ({
  plan_id: planId,
  kind: "video" as const,
  model: "studio-video",
  unit,
  resolution,
  sale_points: points,
  display_name: displayName,
  capabilities: {
    aspect_ratios: ["1:1", "9:16", "16:9"] as Array<"1:1" | "9:16" | "16:9">,
    input_images_max: 9,
    modes: ["text2video", "image2video"] as Array<"text2video" | "image2video">,
    durations,
  },
  status: "available" as const,
});

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

const PRICES = [
  plan("video-plan-108", "SY Kling 4.0 · 1080P · 方案 108", "1080P", "second", 64, range(3, 30)),
  plan("video-plan-107", "SY Kling 4.0 · 720P · 方案 107", "720P", "second", 52, range(3, 30)),
  plan("video-plan-87", "SY Seedance 2.5 VIP · 720P · 方案 87", "720P", "second", 144, range(4, 30)),
  plan("video-plan-113", "SY Seedance 2.5 特价 · 720P · 方案 113", "720P", "generation", 1500, range(5, 30)),
  plan("video-plan-99", "SY WAN 3.0（标准版） · 720P · 方案 99", "720P", "second", 64, range(5, 30)),
  plan("video-plan-14", "SY Seedance 2.0 VIP · 4K · 方案 14", "4K", "second", 640, range(4, 15)),
  plan("video-plan-12", "SY Seedance 2.0 VIP · 720P · 方案 12", "720P", "second", 116, range(4, 15)),
  { ...plan("image-plan-01", "SY GPT Image 2 · Medium · 1K · 方案 1", "1K", "generation", 32, []), kind: "image" as const },
];

test("家族名：第一个「·」之前、去掉 SY 前缀", () => {
  assert.equal(shuyuFamilyLabel("SY Kling 4.0 · 1080P · 方案 108"), "Kling 4.0");
  assert.equal(shuyuFamilyLabel("SY Wan 3.0 Preme（优速版） · 1080P · 方案 103"), "Wan 3.0 Preme（优速版）");
  assert.equal(shuyuFamilyLabel("Seedance 2.5 VIP"), "Seedance 2.5 VIP");
});

test("目录：只列视频档；默认家族排第一、已接入的其次；未过审计的家族照样展示但标待接入；不带积分单价", () => {
  const catalog = buildVideoRouteCatalog({
    prices: PRICES,
    standardAvailable: true,
    fallsBackToPremium: true,
    premiumOffered: true,
    premiumResolution: "1080p",
  });
  assert.deepEqual(
    catalog.families.map((family) => [family.label, family.integrated, family.isDefault]),
    [
      /// 默认 = Seedance 2.5 · 720P 线路里 15 秒最便宜的一档（特价 1500/条 < VIP 144×15）
      ["Seedance 2.5 特价", true, true],
      ["Seedance 2.0 VIP", true, false],
      ["Seedance 2.5 VIP", true, false],
      ["Kling 4.0", false, false],
      ["WAN 3.0（标准版）", false, false],
    ],
  );
  /// 家族接入了、但 4K 档没过审计：按清晰度标清，不让 4K 跟着显示成已接入
  const seedance20 = catalog.families.find((family) => family.label === "Seedance 2.0 VIP");
  assert.deepEqual(seedance20?.resolutions, ["720P", "4K"]);
  assert.deepEqual(seedance20?.integratedResolutions, ["720P"]);
  assert.deepEqual(catalog.families.find((family) => family.label === "Kling 4.0")?.resolutions, ["720P", "1080P"]);
  assert.deepEqual(catalog.families.find((family) => family.label === "Kling 4.0")?.integratedResolutions, []);
  assert.deepEqual(catalog.families.find((family) => family.label === "Seedance 2.5 VIP")?.integratedResolutions, ["720P"]);
  assert.equal(catalog.families.find((family) => family.label === "Kling 4.0")?.maxDurationSec, 30);
  assert.equal(catalog.standard.defaultFamily, "Seedance 2.5 特价");
  assert.equal(catalog.standard.defaultResolution, "720P");
  assert.equal(catalog.standard.fallsBackToPremium, true);
  assert.deepEqual(catalog.premium, { offered: true, model: RUNWAY_PREMIUM_MODEL_LABEL, resolution: "1080p" });
  assert.doesNotMatch(JSON.stringify(catalog), /sale_points|unitSalePoints|pointsPer15s|1500|144|116/, "不给进货价");
});

test("价目表拿不到：目录照给（家族为空、默认为空），高质量开不开照实报", () => {
  const catalog = buildVideoRouteCatalog({
    prices: [],
    standardAvailable: false,
    fallsBackToPremium: false,
    premiumOffered: false,
    premiumResolution: "720p",
  });
  assert.deepEqual(catalog.families, []);
  assert.equal(catalog.standard.defaultFamily, null);
  assert.equal(catalog.premium.offered, false);
  assert.equal(videoRouteCatalogSchema.safeParse({ ...catalog, extra: 1 }).success, false, "契约 strict");
});

test("接线：客户的线路卡只在选了高质量时派发带 runway；卡片只引用纯契约（不进服务端模块）", async () => {
  const [studio, picker, route] = await Promise.all([
    readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8"),
    readFile("src/components/video-generation/customer-route-picker.tsx", "utf8"),
    readFile("src/app/api/video-generation/routes/catalog/route.ts", "utf8"),
  ]);
  assert.match(studio, /!canSelectVideoRoute && customerRoute === "runway"\s*\? \{ videoRouteId: "runway" \}/);
  assert.match(studio, /<CustomerRoutePicker[\s\S]*?active=\{moreOpen\}/);
  assert.match(picker, /^"use client";/);
  assert.match(picker, /fetch\("\/api\/video-generation\/routes\/catalog"/);
  const imports = [...picker.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    imports.filter((path) => path.startsWith("@/lib/")),
    ["@/lib/contracts/video-route-catalog", "@/lib/utils"],
  );
  assert.match(route, /const guard = await requireAuth\(\);\s*if \(!guard\.ok\) return guard\.response;/);
});
