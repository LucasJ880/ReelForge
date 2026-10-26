import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  auditShuyuVideoPlan,
  listAuditedShuyuVideoPlans,
  markShuyuVideoPlanRejected,
  resolveShuyuVideoPlan,
  resolveShuyuVideoPlanWithCooldown,
  shuyuFinalTierAllowedByEnv,
  shuyuPriceSchema,
  shuyuVideoPlanPointsForDuration,
  __testVideoPlans__,
} from "../src/lib/providers/shuyu";
import { ShuyuPlanUnavailableError } from "../src/lib/providers/shuyu-catalog";

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

/// 选档与冷却走真实的 /prices 解析路径(fetch 打桩),不绕过 60s 缓存与 single-flight。
function pricesFetch(plans: ShuyuPlan[]): typeof fetch {
  return async (input) => {
    assert.ok(String(input).endsWith("/prices"), `只允许读 /prices,实际 ${String(input)}`);
    return new Response(JSON.stringify({ object: "list", data: plans }), { status: 200 });
  };
}

const RESOLVE_ENV = { env: { SHUYU_API_KEY: "test-only" } };

test("全部草稿档在冷却时不会跳到 final:跳档只在同 tier 内", async () => {
  __testVideoPlans__.resetVideoPlanCache();
  try {
    const args = { ...RESOLVE_ENV, fetchImpl: pricesFetch(MARKET_1026) };
    /// 无冷却:默认 = draft 首位(最便宜的 720P)。
    assert.equal((await resolveShuyuVideoPlanWithCooldown(args)).planId, "video-plan-01");
    /// 默认档冷却 → 跳到同档下一个(720P 88 分/秒),不是 1080P。
    markShuyuVideoPlanRejected("video-plan-01");
    assert.equal((await resolveShuyuVideoPlanWithCooldown(args)).planId, "video-plan-03");
    /// draft 四档全冷却 → 回退到 draft 档首位,绝不跳到 final 去扣 1080P 的费。
    for (const id of ["video-plan-03", "video-plan-04", "video-plan-07"]) {
      markShuyuVideoPlanRejected(id);
    }
    const fallback = await resolveShuyuVideoPlanWithCooldown(args);
    assert.equal(fallback.planId, "video-plan-01");
    assert.equal(fallback.tier, "draft");
    /// 显式要 final 并开闸 → final 档内取首位;冷却同样只在 final 档内看。
    const final = await resolveShuyuVideoPlanWithCooldown({ ...args, tier: "final", allowFinal: true });
    assert.equal(final.planId, "video-plan-13");
    assert.equal(final.tier, "final");
    markShuyuVideoPlanRejected("video-plan-13");
    assert.equal(
      (await resolveShuyuVideoPlanWithCooldown({ ...args, tier: "final", allowFinal: true })).planId,
      "video-plan-15",
    );
  } finally {
    __testVideoPlans__.resetVideoPlanCache();
  }
});

test("客户显式选 1080P planId 被拒(fail-closed);只有 allowFinal 开闸才放行", async () => {
  __testVideoPlans__.resetVideoPlanCache();
  try {
    const args = { ...RESOLVE_ENV, fetchImpl: pricesFetch(MARKET_1026) };
    /// 默认解析(六处默认成本调用点的写法)仍是 video-plan-01 / 700 分。
    const defaultPlan = await resolveShuyuVideoPlan(args);
    assert.equal(defaultPlan.planId, "video-plan-01");
    assert.equal(shuyuVideoPlanPointsForDuration(defaultPlan, 15), 700);
    /// 客户面调用链不传 allowFinal:显式 final planId 一律拒绝,不静默换档。
    await assert.rejects(
      () => resolveShuyuVideoPlan({ ...args, planId: "video-plan-13" }),
      (error: unknown) =>
        error instanceof ShuyuPlanUnavailableError && /final-tier/.test(error.message),
    );
    await assert.rejects(
      () => resolveShuyuVideoPlanWithCooldown({ ...args, planId: "video-plan-13" }),
      ShuyuPlanUnavailableError,
    );
    /// tier=final 但没开闸同样拒绝。
    await assert.rejects(
      () => resolveShuyuVideoPlan({ ...args, tier: "final" }),
      ShuyuPlanUnavailableError,
    );
    /// 显式 draft planId 不受影响。
    assert.equal((await resolveShuyuVideoPlan({ ...args, planId: "video-plan-07" })).planId, "video-plan-07");
    /// 开闸 → 放行,且返回的就是那条 final 套餐。
    const allowed = await resolveShuyuVideoPlan({ ...args, planId: "video-plan-13", allowFinal: true });
    assert.equal(allowed.tier, "final");
    assert.equal(shuyuVideoPlanPointsForDuration(allowed, 15), 240 * 15);
    /// 不在审计清单的 ID 仍按原语义拒绝(not_found)。
    await assert.rejects(
      () => resolveShuyuVideoPlan({ ...args, planId: "video-plan-99", allowFinal: true }),
      /not in the audited available list/,
    );
  } finally {
    __testVideoPlans__.resetVideoPlanCache();
  }
});

test("价目表只剩 final 档时,默认(draft)解析如实报无可用套餐,不偷用 1080P", async () => {
  __testVideoPlans__.resetVideoPlanCache();
  try {
    const onlyFinal = MARKET_1026.filter((plan) => plan.resolution === "1080P");
    const args = { ...RESOLVE_ENV, fetchImpl: pricesFetch(onlyFinal) };
    await assert.rejects(() => resolveShuyuVideoPlan(args), /draft tier/);
    await assert.rejects(() => resolveShuyuVideoPlanWithCooldown(args), /draft tier/);
  } finally {
    __testVideoPlans__.resetVideoPlanCache();
  }
});

test("SHUYU_ALLOW_FINAL_TIER=1(服务端 env)开闸:显式选 1080P 放行;默认档不变;allowFinal:false 硬关", async () => {
  /// 真机验收脚本 / 内部员工用 env 开闸,不用改调用方签名。默认关:1|true 才算开。
  assert.equal(shuyuFinalTierAllowedByEnv({ SHUYU_ALLOW_FINAL_TIER: "1" }), true);
  assert.equal(shuyuFinalTierAllowedByEnv({ SHUYU_ALLOW_FINAL_TIER: " true " }), true);
  assert.equal(shuyuFinalTierAllowedByEnv({ SHUYU_ALLOW_FINAL_TIER: "0" }), false);
  assert.equal(shuyuFinalTierAllowedByEnv({ SHUYU_ALLOW_FINAL_TIER: "yes" }), false);
  assert.equal(shuyuFinalTierAllowedByEnv({}), false);

  __testVideoPlans__.resetVideoPlanCache();
  try {
    const envOn = {
      env: { SHUYU_API_KEY: "test-only", SHUYU_ALLOW_FINAL_TIER: "1" },
      fetchImpl: pricesFetch(MARKET_1026),
    };
    /// env 开着也不动默认档:六处无参 resolveShuyuVideoPlan() 仍是 700 分的 720P。
    assert.equal((await resolveShuyuVideoPlan(envOn)).planId, "video-plan-01");
    assert.equal((await resolveShuyuVideoPlanWithCooldown(envOn)).planId, "video-plan-01");
    /// 显式 1080P planId / tier=final → 放行(脚本选 1080P 的路径)。
    const explicit = await resolveShuyuVideoPlan({ ...envOn, planId: "video-plan-13" });
    assert.equal(explicit.tier, "final");
    assert.equal(shuyuVideoPlanPointsForDuration(explicit, 15), 240 * 15);
    assert.equal(
      (await resolveShuyuVideoPlanWithCooldown({ ...envOn, planId: "video-plan-13" })).planId,
      "video-plan-13",
    );
    assert.equal(
      (await resolveShuyuVideoPlanWithCooldown({ ...envOn, tier: "final" })).planId,
      "video-plan-13",
    );
    /// allowFinal:false 是硬关,忽略 env——客户面调用链接上 isInternalStaff 后靠它守住。
    await assert.rejects(
      () => resolveShuyuVideoPlan({ ...envOn, planId: "video-plan-13", allowFinal: false }),
      ShuyuPlanUnavailableError,
    );
    await assert.rejects(
      () => resolveShuyuVideoPlanWithCooldown({ ...envOn, tier: "final", allowFinal: false }),
      ShuyuPlanUnavailableError,
    );
    /// env=0 / 未设 → 仍然 fail-closed。
    const envOff = { ...envOn, env: { SHUYU_API_KEY: "test-only", SHUYU_ALLOW_FINAL_TIER: "0" } };
    await assert.rejects(
      () => resolveShuyuVideoPlan({ ...envOff, planId: "video-plan-13" }),
      ShuyuPlanUnavailableError,
    );
  } finally {
    __testVideoPlans__.resetVideoPlanCache();
  }
});
