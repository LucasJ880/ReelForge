import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getShuyuPrices,
  listAuditedShuyuVideoPlans,
  resolveShuyuVideoPlan,
  SHUYU_PREFERRED_VIDEO_LANE,
  ShuyuApiError,
  __testVideoPlans__,
} from "../src/lib/providers/shuyu";
import { parseShuyuCatalog, selectAuditedImage2Plan, ShuyuPlanUnavailableError } from "../src/lib/providers/shuyu-catalog";
import { diagnoseDrift, summarizeShuyuCatalog } from "../src/lib/services/capability-probe-service";
import { buildPublicVideoRouteOptions } from "../src/lib/services/video-route-options-service";
import {
  parseShuyuVideoLane,
  shuyuDefaultVideoLane,
  shuyuVideoPlanFamily,
} from "../src/lib/providers/shuyu-video-plan-tiers";
import { ShuyuVideoProvider } from "../src/lib/video-generation/providers/shuyu-video-provider";
import { ProviderSubmissionError } from "../src/lib/video-generation/providers/submission-error";
import { __resetShuyuRuntimeProbeForTests } from "../src/lib/video-generation/shuyu-runtime";

/// 夹具 = 1027 真机 /prices 原样快照：110 档，所有视频模型共用 model=studio-video，
/// 大部分档带 21:9，Seedance 2.5 / Wan / Kling 的 input_images_max 为 10–30。
const LIVE_1027 = JSON.parse(
  readFileSync(new URL("./fixtures/shuyu-prices-live-20261027.json", import.meta.url), "utf8"),
) as { object: string; data: Array<Record<string, unknown>> };

const ENV = { env: { SHUYU_API_KEY: "test-only" } };
const LEGACY_ENV = { env: { SHUYU_API_KEY: "test-only", SHUYU_DEFAULT_VIDEO_LANE: "legacy" } };
const LANE_1080_ENV = { env: { SHUYU_API_KEY: "test-only", SHUYU_DEFAULT_VIDEO_LANE: "seedance-2.5-1080p" } };
const LANE_1080 = { family: "seedance-2.5", resolution: "1080P" } as const;

function liveFetch(submissions: Array<Record<string, unknown>> = []): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (url.endsWith("/prices")) return new Response(JSON.stringify(LIVE_1027), { status: 200 });
    if (url.endsWith("/account/balance")) {
      return new Response(
        JSON.stringify({ object: "balance", available_points: 1_000_000, unit: "points" }),
        { status: 200 },
      );
    }
    assert.ok(url.endsWith("/videos/generations"), `意外请求 ${url}`);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    submissions.push(body);
    return new Response(JSON.stringify({ task_id: `task_${String(body.plan_id)}` }), { status: 201 });
  };
}

async function freshCaches<T>(run: () => Promise<T>): Promise<T> {
  __testVideoPlans__.resetVideoPlanCache();
  __resetShuyuRuntimeProbeForTests();
  try {
    return await run();
  } finally {
    __testVideoPlans__.resetVideoPlanCache();
    __resetShuyuRuntimeProbeForTests();
  }
}

test("1027 真机目录（110 档）整体可解析，不再因 max(100) / 21:9 让视频与图像线路停机", async () => {
  assert.equal(LIVE_1027.data.length, 110);
  const prices = await getShuyuPrices({ ...ENV, fetchImpl: liveFetch() });
  assert.ok(prices.data.length >= 100, `只保留了 ${prices.data.length} 档`);
  const plan = prices.data.find((entry) => entry.plan_id === "video-plan-04");
  assert.ok(plan);
  assert.equal(plan.capabilities.aspect_ratios.includes("9:16"), true);
  assert.equal((plan.capabilities.aspect_ratios as string[]).includes("21:9"), false);
});

test("审计只放行 Seedance 2.0 / 2.5：同为 studio-video 的 Kling / Wan / Grok / MiniMax / Gemini 一律出族", async () => {
  const prices = await getShuyuPrices({ ...ENV, fetchImpl: liveFetch() });
  const audited = listAuditedShuyuVideoPlans(prices.data);
  assert.ok(audited.length > 0);
  for (const plan of audited) {
    assert.notEqual(shuyuVideoPlanFamily(plan.displayName), null, plan.displayName);
    assert.doesNotMatch(plan.displayName, /kling|wan|grok|minimax|gemini/i);
  }
  assert.ok(audited.some((plan) => plan.family === "seedance-2.5"));
  /// 2.5 VIP 1080P（420–560 分/秒）超出 1080P 健全区间，不进审计族。
  assert.equal(audited.some((plan) => plan.family === "seedance-2.5" && plan.resolution === "1080P" && plan.unitSalePoints > 400), false);
});

test("默认线路 = Seedance 2.5 · 720P（1027 实测可出片的最高档）：排序首位、默认解析、maxDurationSec = 30", async () => {
  const prices = await getShuyuPrices({ ...ENV, fetchImpl: liveFetch() });
  const ranked = listAuditedShuyuVideoPlans(prices.data, SHUYU_PREFERRED_VIDEO_LANE);
  assert.equal(ranked[0]!.planId, "video-plan-77");
  assert.equal(ranked[0]!.family, "seedance-2.5");
  assert.equal(ranked[0]!.resolution, "720P");
  assert.equal(ranked[0]!.unitSalePoints, 130);
  assert.equal(ranked[0]!.maxDurationSec, 30);
  const plan = await freshCaches(() => resolveShuyuVideoPlan({ ...ENV, fetchImpl: liveFetch() }));
  assert.equal(plan.planId, "video-plan-77");
  assert.equal(plan.tier, "draft");
});

test("SHUYU_DEFAULT_VIDEO_LANE=seedance-2.5-1080p：默认切到 2.5 1080P，且默认线路不过 final 闸门", async () => {
  const prices = await getShuyuPrices({ ...ENV, fetchImpl: liveFetch() });
  assert.equal(listAuditedShuyuVideoPlans(prices.data, LANE_1080)[0]!.planId, "video-plan-78");
  const plan = await freshCaches(() => resolveShuyuVideoPlan({ ...LANE_1080_ENV, fetchImpl: liveFetch() }));
  assert.equal(plan.planId, "video-plan-78");
  assert.equal(plan.tier, "final");
});

test("lane 值解析：认识的写法生效，写错的值回落代码默认而不是静默关掉", () => {
  assert.deepEqual(parseShuyuVideoLane("seedance-2.5-1080p"), LANE_1080);
  assert.deepEqual(parseShuyuVideoLane(" Seedance-2.0-720P "), { family: "seedance-2.0", resolution: "720P" });
  assert.equal(parseShuyuVideoLane("legacy"), null);
  assert.equal(parseShuyuVideoLane("seedance-2.5-4k"), undefined);
  assert.deepEqual(shuyuDefaultVideoLane({ SHUYU_DEFAULT_VIDEO_LANE: "typo" }), SHUYU_PREFERRED_VIDEO_LANE);
  assert.deepEqual(shuyuDefaultVideoLane({}), SHUYU_PREFERRED_VIDEO_LANE);
});

test("回滚开关 SHUYU_DEFAULT_VIDEO_LANE=legacy：默认回到最便宜的 Seedance 2.0 720P", async () => {
  const prices = await getShuyuPrices({ ...ENV, fetchImpl: liveFetch() });
  assert.equal(listAuditedShuyuVideoPlans(prices.data, null)[0]!.planId, "video-plan-03");
  const plan = await freshCaches(() => resolveShuyuVideoPlan({ ...LEGACY_ENV, fetchImpl: liveFetch() }));
  assert.equal(plan.planId, "video-plan-03");
  assert.equal(plan.tier, "draft");
});

test("显式 planId：默认线路内的 1080P 放行；线路外的 1080P 仍过 final 闸门；别家模型不在审计清单", async () => {
  await freshCaches(async () => {
    const lanePlan = await resolveShuyuVideoPlan({ ...LANE_1080_ENV, fetchImpl: liveFetch(), planId: "video-plan-78" });
    assert.equal(lanePlan.planId, "video-plan-78");
    await assert.rejects(
      () => resolveShuyuVideoPlan({ ...LANE_1080_ENV, fetchImpl: liveFetch(), planId: "video-plan-13" }),
      ShuyuPlanUnavailableError,
    );
    await assert.rejects(
      () => resolveShuyuVideoPlan({ ...ENV, fetchImpl: liveFetch(), planId: "video-plan-78" }),
      ShuyuPlanUnavailableError,
    );
    await assert.rejects(
      () => resolveShuyuVideoPlan({ ...ENV, fetchImpl: liveFetch(), planId: "video-plan-107" }),
      (error: unknown) => error instanceof ShuyuApiError && error.code === "not_found",
    );
  });
});

test("适配器：默认提交走 2.5 720P、30s 放行；显式 2.0 档提交 30s 在预检被拒、零提交", async () => {
  await freshCaches(async () => {
    const submissions: Array<Record<string, unknown>> = [];
    const provider = new ShuyuVideoProvider("studio-video", { ...ENV, fetchImpl: liveFetch(submissions) });
    const created = await provider.createVideoJob({
      providerRequestKey: "lane-default-30s-1",
      prompt: "Show the product.",
      durationSec: 30,
    });
    assert.equal(created.providerPlanId, "video-plan-77");
    assert.equal(created.providerUnitPoints, 130 * 30);
    assert.equal(submissions[0]!.duration, 30);

    await assert.rejects(
      () =>
        provider.createVideoJob({
          providerRequestKey: "explicit-20-30s-1",
          prompt: "Show the product.",
          durationSec: 30,
          providerPlanId: "video-plan-04",
        }),
      (error: unknown) =>
        error instanceof ProviderSubmissionError &&
        error.stage === "preflight" &&
        /at most 15s/.test(error.message),
    );
    assert.equal(submissions.length, 1);
  });
});

test("能力探针与目录摘要：默认线路在场即找到默认档、无漂移；15 秒最低成本按线路算", async () => {
  const prices = await getShuyuPrices({ ...ENV, fetchImpl: liveFetch() });
  const result = diagnoseDrift(prices.data);
  assert.equal(result.auditedPlanFound, true);
  assert.deepEqual(result.drifts, []);
  assert.equal(summarizeShuyuCatalog(prices.data).cheapestVideo15sPoints, 130 * 15);
});

test("routes 清单：默认线路的档是默认档；线路外的 1080P 客户看不到", async () => {
  const prices = await getShuyuPrices({ ...ENV, fetchImpl: liveFetch() });
  const auditedPlans = listAuditedShuyuVideoPlans(prices.data, SHUYU_PREFERRED_VIDEO_LANE);
  const response = buildPublicVideoRouteOptions({
    internalStaff: false,
    auditedPlans,
    availability: { configured: true, funded: true, available: true, reason: null } as never,
  });
  const route = response.routes[0]!;
  const defaultPlan = route.plans.find((plan) => plan.isDefault);
  assert.equal(defaultPlan?.planId, "video-plan-77");
  assert.match(route.displayName, /Seedance 2\.5 720P/);
  assert.equal(route.plans.some((plan) => plan.resolution === "1080P"), false);
});

test("图像档只认 GPT Image 2，不把 GPT Image 2.5 Flare / Sunburst 当成已审计档", async () => {
  const prices = await getShuyuPrices({ ...ENV, fetchImpl: liveFetch() });
  const catalog = parseShuyuCatalog(prices);
  assert.ok(catalog.imagePlans.length > 0);
  const names = new Map(
    LIVE_1027.data.map((entry) => [entry.plan_id as string, String(entry.display_name)]),
  );
  for (const plan of catalog.imagePlans) {
    assert.match(names.get(plan.planId)!, /GPT Image 2 ·/);
  }
  const picked = selectAuditedImage2Plan(catalog, "2K");
  assert.match(names.get(picked.planId)!, /GPT Image 2 ·/);
});

test("家族识别：Seedance 2.0 / 2.5 各种写法认，其他模型不认", () => {
  assert.equal(shuyuVideoPlanFamily("SY Seedance 2.0 Fast VIP · 720P · 方案 3"), "seedance-2.0");
  assert.equal(shuyuVideoPlanFamily("视频-Seedance2.0-720P-推荐1 VIP"), "seedance-2.0");
  assert.equal(shuyuVideoPlanFamily("SY Seedance 2.5 · 1080P · 方案 78"), "seedance-2.5");
  assert.equal(shuyuVideoPlanFamily("Seedance 2.50"), null);
  assert.equal(shuyuVideoPlanFamily("SY Kling 4.0 · 720P · 方案 107"), null);
  assert.equal(shuyuVideoPlanFamily("Studio Video Pro"), null);
});
