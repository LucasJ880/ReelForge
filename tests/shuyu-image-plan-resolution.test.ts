/**
 * 图像套餐必须按供应商实时目录解析，不能硬编码。
 *
 * 0728 真机实测：合作方轮换了 plan id，硬编码的主 `image-plan-01` 与备
 * `image-plan-07` 双双从目录消失（目录只剩 02/03/05/06/08/09，且最低档为 2K），
 * 于是每一帧提交都被回 400 model_unavailable，故事板全灭、批次卡在 QUEUED。
 * /health 当时仍报 image: available —— 健康检查发现不了这类失配。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ShuyuPlanUnavailableError,
  selectAuditedImage2Plan,
  parseShuyuCatalog,
} from "../src/lib/providers/shuyu-catalog";

function pricePlan(planId: string, resolution: string, salePoints: number) {
  return {
    plan_id: planId,
    kind: "image" as const,
    model: "studio-image",
    unit: "generation" as const,
    resolution,
    sale_points: salePoints,
    display_name: `GPT Image 2 · ${resolution}`,
    capabilities: { aspect_ratios: ["9:16", "1:1", "16:9"], input_images_max: 5 },
    status: "available" as const,
  };
}

/** 0728 线上真实目录快照（01 与 07 已下线）。 */
const LIVE_CATALOG = {
  object: "list" as const,
  data: [
    pricePlan("image-plan-02", "2K", 32),
    pricePlan("image-plan-03", "4K", 64),
    pricePlan("image-plan-05", "2K", 32),
    pricePlan("image-plan-06", "4K", 64),
    pricePlan("image-plan-08", "2K", 28),
    pricePlan("image-plan-09", "4K", 44),
  ],
};

test("resolves the cheapest plan that meets the requested resolution", () => {
  const plan = selectAuditedImage2Plan(parseShuyuCatalog(LIVE_CATALOG), "2K");
  assert.equal(plan.planId, "image-plan-08");
  assert.equal(plan.resolution, "2K");
  assert.equal(plan.points, 28);
});

test("a 1K request falls back to the lowest available tier", () => {
  /// 目录里已没有 1K；不能因此报错，应回落到最低可得档位。
  const plan = selectAuditedImage2Plan(parseShuyuCatalog(LIVE_CATALOG), "1K");
  assert.equal(plan.resolution, "2K");
  assert.equal(plan.points, 28);
});

test("a 4K request never silently downgrades", () => {
  const plan = selectAuditedImage2Plan(parseShuyuCatalog(LIVE_CATALOG), "4K");
  assert.equal(plan.resolution, "4K");
  assert.equal(plan.planId, "image-plan-09", "同档取积分最低者");
});

test("a 4K request fails closed when the live catalog only has 2K", () => {
  const twoKOnly = {
    object: "list" as const,
    data: [pricePlan("image-plan-08", "2K", 28)],
  };
  assert.throws(
    () => selectAuditedImage2Plan(parseShuyuCatalog(twoKOnly), "4K"),
    ShuyuPlanUnavailableError,
    "高分辨率请求不得在供应商档位下线后静默降级",
  );
});

test("retired hardcoded plan ids are never selected", () => {
  const plan = selectAuditedImage2Plan(parseShuyuCatalog(LIVE_CATALOG), "2K");
  assert.ok(
    !["image-plan-01", "image-plan-07"].includes(plan.planId),
    "已下线的套餐 id 不得再被选中",
  );
});
