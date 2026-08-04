import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  auditShuyuVideoPlan,
  listAuditedShuyuVideoPlans,
  shuyuPriceSchema,
  shuyuVideoPlanPointsForDuration,
} from "../src/lib/providers/shuyu";

type ShuyuPlan = z.infer<typeof shuyuPriceSchema>;

/// 夹具 = 0803 真机 /prices 快照(Lucas 工作台截图):
/// 700 分/条限时档 + 88/104 分/秒 720P 档 + 68 分/秒 480P 档。
function marketPlan(overrides: Partial<ShuyuPlan>): ShuyuPlan {
  return shuyuPriceSchema.parse({
    plan_id: "video-plan-01",
    kind: "video",
    model: "studio-video",
    unit: "generation",
    resolution: "720P",
    sale_points: 700,
    display_name: "视频-Seedance2.0-720P-限时特价",
    capabilities: {
      aspect_ratios: ["9:16", "16:9", "1:1"],
      input_images_max: 9,
      modes: ["text2video", "image2video"],
      durations: [4, 5, 10, 15],
    },
    status: "available",
    ...overrides,
  });
}

const MARKET_0803: ShuyuPlan[] = [
  marketPlan({}),
  marketPlan({
    plan_id: "video-plan-03",
    unit: "second",
    sale_points: 88,
    display_name: "视频-Seedance2.0-720P-推荐1 Fast VIP",
  }),
  marketPlan({
    plan_id: "video-plan-04",
    unit: "second",
    sale_points: 104,
    display_name: "视频-Seedance2.0-720P-推荐1 VIP",
  }),
  marketPlan({
    plan_id: "video-plan-07",
    unit: "second",
    resolution: "480P",
    sale_points: 68,
    display_name: "视频-Seedance2.0-480P-推荐1",
  }),
];

test("0803 市场夹具:语义审计放行全部四档,默认 = 最便宜的 720P(700 分/条)", () => {
  const ranked = listAuditedShuyuVideoPlans(MARKET_0803);
  assert.equal(ranked.length, 4);
  assert.equal(ranked[0].planId, "video-plan-01");
  assert.equal(ranked[0].billingUnit, "generation");
  /// 720P 全部排在 480P 之前(模板质量底线),720P 内按 15s 有效成本升序。
  assert.deepEqual(
    ranked.map((plan) => plan.planId),
    ["video-plan-01", "video-plan-03", "video-plan-04", "video-plan-07"],
  );
});

test("按秒计费的有效成本按时长放大;按条计费与时长无关", () => {
  const ranked = listAuditedShuyuVideoPlans(MARKET_0803);
  const flat = ranked[0];
  const perSecond = ranked[1];
  assert.equal(shuyuVideoPlanPointsForDuration(flat, 15), 700);
  assert.equal(shuyuVideoPlanPointsForDuration(flat, 5), 700);
  assert.equal(shuyuVideoPlanPointsForDuration(perSecond, 15), 88 * 15);
  assert.equal(shuyuVideoPlanPointsForDuration(perSecond, 5), 88 * 5);
});

test("语义边界拒绝:出族分辨率 / 越界价 / 缺 15s / 参考图不足 / 缺 image2video", () => {
  assert.equal(auditShuyuVideoPlan(marketPlan({ resolution: "1080P" })), null);
  assert.equal(auditShuyuVideoPlan(marketPlan({ sale_points: 5_000 })), null);
  assert.equal(
    auditShuyuVideoPlan(
      marketPlan({ unit: "second", sale_points: 500 }),
    ),
    null,
    "按秒计费越界价必须拒绝",
  );
  assert.equal(
    auditShuyuVideoPlan(
      marketPlan({
        capabilities: {
          aspect_ratios: ["9:16", "16:9", "1:1"],
          input_images_max: 9,
          modes: ["text2video", "image2video"],
          durations: [4, 5, 10],
        },
      }),
    ),
    null,
    "不支持 15s 的套餐必须拒绝",
  );
  assert.equal(
    auditShuyuVideoPlan(
      marketPlan({
        capabilities: {
          aspect_ratios: ["9:16", "16:9", "1:1"],
          input_images_max: 3,
          modes: ["text2video", "image2video"],
          durations: [15],
        },
      }),
    ),
    null,
    "参考图上限 <4 必须拒绝(我方批量最多送 4 张)",
  );
  assert.equal(
    auditShuyuVideoPlan(
      marketPlan({
        capabilities: {
          aspect_ratios: ["9:16", "16:9", "1:1"],
          input_images_max: 9,
          modes: ["text2video"],
          durations: [15],
        },
      }),
    ),
    null,
    "缺 image2video 必须拒绝(SunnyShutter 主路径)",
  );
});

test("模型出族与非 available 状态一律不进审计清单", () => {
  const ranked = listAuditedShuyuVideoPlans([
    marketPlan({ model: "other-video-model" }),
  ]);
  assert.equal(ranked.length, 0);
});
