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

/// 1026 实价快照:0803 四档之上多了 1080P 按秒档(240 点/秒,video-plan-13/15)。
const MARKET_1026: ShuyuPlan[] = [
  marketPlan({
    plan_id: "video-plan-15",
    unit: "second",
    resolution: "1080P",
    sale_points: 240,
    display_name: "视频-Seedance2.0-1080P-推荐1 VIP",
  }),
  ...MARKET_0803,
  marketPlan({
    plan_id: "video-plan-13",
    unit: "second",
    resolution: "1080P",
    sale_points: 240,
    display_name: "视频-Seedance2.0-1080P-推荐1",
  }),
];

test("1026 市场夹具:1080P 审计通过且 tier=final、排在最后,默认档仍是 video-plan-01", () => {
  const ranked = listAuditedShuyuVideoPlans(MARKET_1026);
  assert.equal(ranked.length, 6);
  /// 默认档 = plans[0] = 最便宜的 720P,与 0803 完全一致——六处默认成本调用点不变。
  assert.equal(ranked[0].planId, "video-plan-01");
  assert.equal(ranked[0].tier, "draft");
  assert.equal(shuyuVideoPlanPointsForDuration(ranked[0], 15), 700);
  /// RANK:720P → 480P → 1080P;同档内按 15s 成本升序,并列按 plan_id 稳定。
  assert.deepEqual(
    ranked.map((plan) => plan.planId),
    [
      "video-plan-01",
      "video-plan-03",
      "video-plan-04",
      "video-plan-07",
      "video-plan-13",
      "video-plan-15",
    ],
  );
  assert.deepEqual(
    ranked.map((plan) => plan.tier),
    ["draft", "draft", "draft", "draft", "final", "final"],
  );
  /// final 档即使比某个 draft 档便宜,也绝不能插队到 draft 之前。
  const cheapFinal = listAuditedShuyuVideoPlans([
    marketPlan({ plan_id: "video-plan-04", unit: "second", sale_points: 104 }),
    marketPlan({ plan_id: "video-plan-20", resolution: "1080P", sale_points: 1_000 }),
  ]);
  assert.deepEqual(
    cheapFinal.map((plan) => plan.planId),
    ["video-plan-04", "video-plan-20"],
  );
});

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

test("1026 起 1080P 进审计族:tier=final;720P/480P 仍是 draft", () => {
  /// 1026 实价:1080P 240 点/秒(video-plan-13/15)。此前白名单只放 720P/480P,
  /// 成片一直是 720P 拉伸成 1080。
  const final = auditShuyuVideoPlan(
    marketPlan({
      plan_id: "video-plan-13",
      unit: "second",
      resolution: "1080P",
      sale_points: 240,
      display_name: "视频-Seedance2.0-1080P-推荐1",
    }),
  );
  assert.ok(final, "1080P 按秒 240 必须审计通过");
  assert.equal(final.tier, "final");
  assert.equal(final.resolution, "1080P");
  assert.equal(shuyuVideoPlanPointsForDuration(final, 15), 240 * 15);

  const ranked = listAuditedShuyuVideoPlans(MARKET_0803);
  assert.ok(ranked.every((plan) => plan.tier === "draft"), "720P/480P 全是 draft");

  /// quality 一致性检查不变:1080P 套餐声称 quality=720P 仍出族。
  assert.equal(
    auditShuyuVideoPlan(
      marketPlan({
        unit: "second",
        resolution: "1080P",
        sale_points: 240,
        capabilities: {
          aspect_ratios: ["9:16", "16:9", "1:1"],
          input_images_max: 9,
          modes: ["text2video", "image2video"],
          durations: [15],
          quality: "720P",
        },
      }),
    ),
    null,
  );
});

test("单价健全区间按分辨率分区:1080P 按秒 100–400 / 按条 ≤8000;draft 档现值不变", () => {
  const final1080 = (overrides: Partial<ShuyuPlan>) =>
    auditShuyuVideoPlan(marketPlan({ resolution: "1080P", ...overrides }));
  assert.ok(final1080({ unit: "second", sale_points: 100 }));
  assert.ok(final1080({ unit: "second", sale_points: 400 }));
  assert.equal(final1080({ unit: "second", sale_points: 99 }), null, "1080P 按秒低于 100 疑似错价");
  assert.equal(final1080({ unit: "second", sale_points: 401 }), null, "1080P 按秒高于 400 越界");
  assert.ok(final1080({ unit: "generation", sale_points: 8_000 }));
  assert.equal(final1080({ unit: "generation", sale_points: 8_001 }), null);
  /// draft 档保持 0803 现值:按条 100–2000、按秒 10–300。
  assert.equal(auditShuyuVideoPlan(marketPlan({ sale_points: 2_001 })), null);
  assert.equal(auditShuyuVideoPlan(marketPlan({ unit: "second", sale_points: 301 })), null);
  assert.ok(auditShuyuVideoPlan(marketPlan({ resolution: "480P", unit: "second", sale_points: 10 })));
});

test("语义边界拒绝:出族分辨率 / 越界价 / 缺 15s / 参考图不足 / 缺 image2video", () => {
  /// 4K(640 点/秒)在售但不在审计族内;1080P 已入族,见上。
  assert.equal(auditShuyuVideoPlan(marketPlan({ resolution: "4K", unit: "second", sale_points: 640 })), null);
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
