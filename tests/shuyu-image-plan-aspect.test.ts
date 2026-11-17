import assert from "node:assert/strict";
import test from "node:test";
import {
  ShuyuPlanUnavailableError,
  parseShuyuCatalog,
  selectAuditedImage2Plan,
} from "../src/lib/providers/shuyu-catalog";

/**
 * Shuyu 图像套餐按画幅筛选（shuyu-catalog）。
 * 原来和图文帖出图的用例放在一起；出图服务 2026-11-16 删除，套餐选取是供应商层的通用逻辑，用例留下。
 */

function pricePlan(planId: string, resolution: string, points: number, ratios?: string[]) {
  return {
    plan_id: planId,
    kind: "image",
    model: "studio-image",
    unit: "generation",
    resolution,
    sale_points: points,
    display_name: `GPT Image 2 · ${resolution}`,
    ...(ratios ? { capabilities: { aspect_ratios: ratios, input_images_max: 5 } } : {}),
    status: "available",
  };
}

test("套餐按画幅筛：只在声明支持 2:3 的档位里选（1K 下线自动升档）；不传画幅时行为不变", () => {
  const catalog = parseShuyuCatalog({
    object: "list",
    data: [
      pricePlan("image-plan-08", "2K", 28, ["9:16", "1:1", "16:9"]),
      pricePlan("image-plan-05", "2K", 32, ["2:3", "9:16"]),
      pricePlan("image-plan-09", "4K", 44, ["2:3"]),
      pricePlan("image-plan-10", "2K", 20),
    ],
  });
  assert.deepEqual(catalog.imagePlans.find((plan) => plan.planId === "image-plan-05")?.aspectRatios, ["2:3", "9:16"]);
  assert.deepEqual(catalog.imagePlans.find((plan) => plan.planId === "image-plan-10")?.aspectRatios, [], "没声明画幅 = 空（按画幅筛选时不选它）");
  assert.equal(selectAuditedImage2Plan(catalog, "1K", { aspectRatio: "2:3" }).planId, "image-plan-05", "便宜的 08 不支持 2:3，不能选");
  assert.equal(selectAuditedImage2Plan(catalog, "1K").planId, "image-plan-10", "不按画幅筛时与既有行为一致");
  assert.throws(() => selectAuditedImage2Plan(catalog, "1K", { aspectRatio: "3:2" }), ShuyuPlanUnavailableError);
});
