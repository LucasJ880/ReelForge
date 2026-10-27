import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getShuyuPrices,
  listAuditedShuyuVideoPlans,
  resolveShuyuVideoPlan,
  __testVideoPlans__,
} from "../src/lib/providers/shuyu";
import { parseShuyuCatalog, selectAuditedImage2Plan } from "../src/lib/providers/shuyu-catalog";
import { diagnoseDrift } from "../src/lib/services/capability-probe-service";
import { shuyuVideoPlanFamily } from "../src/lib/providers/shuyu-video-plan-tiers";

/// 夹具 = 1027 真机 /prices 原样快照：110 档，所有视频模型共用 model=studio-video，
/// 大部分档带 21:9，Seedance 2.5 / Wan / Kling 的 input_images_max 为 10–30。
const LIVE_1027 = JSON.parse(
  readFileSync(new URL("./fixtures/shuyu-prices-live-20261027.json", import.meta.url), "utf8"),
) as { object: string; data: Array<Record<string, unknown>> };

const ENV = { env: { SHUYU_API_KEY: "test-only" } };

function livePricesFetch(): typeof fetch {
  return async (input) => {
    assert.ok(String(input).endsWith("/prices"), `只允许读 /prices,实际 ${String(input)}`);
    return new Response(JSON.stringify(LIVE_1027), { status: 200 });
  };
}

test("1027 真机目录（110 档）整体可解析，不再因 max(100) / 21:9 让视频与图像线路停机", async () => {
  assert.equal(LIVE_1027.data.length, 110);
  const prices = await getShuyuPrices({ ...ENV, fetchImpl: livePricesFetch() });
  assert.ok(prices.data.length >= 100, `只保留了 ${prices.data.length} 档`);
  const veo = prices.data.find((plan) => plan.plan_id === "video-plan-04");
  assert.ok(veo);
  assert.deepEqual(veo.capabilities.aspect_ratios.includes("9:16"), true);
  assert.equal((veo.capabilities.aspect_ratios as string[]).includes("21:9"), false);
});

test("审计只放行 Seedance 2.0 家族：同为 studio-video 的 Kling / Wan / Grok / MiniMax / 2.5 一律出族", async () => {
  const prices = await getShuyuPrices({ ...ENV, fetchImpl: livePricesFetch() });
  const audited = listAuditedShuyuVideoPlans(prices.data);
  assert.ok(audited.length > 0);
  for (const plan of audited) {
    assert.equal(shuyuVideoPlanFamily(plan.displayName), "seedance-2.0", plan.displayName);
    assert.doesNotMatch(plan.displayName, /kling|wan|grok|minimax|gemini|2\.5/i);
  }
  /// 默认档 = 最便宜的 Seedance 2.0 720P（Fast VIP 84 分/秒），而不是 Kling 4.0 的 52 分/秒。
  assert.equal(audited[0]!.resolution, "720P");
  assert.equal(audited[0]!.unitSalePoints, 84);
  assert.match(audited[0]!.displayName, /Seedance 2\.0/);
});

test("resolveShuyuVideoPlan 在真机目录上取到默认 Seedance 2.0 720P 档", async () => {
  __testVideoPlans__.resetVideoPlanCache();
  try {
    const plan = await resolveShuyuVideoPlan({ ...ENV, fetchImpl: livePricesFetch() });
    assert.equal(plan.tier, "draft");
    assert.equal(plan.planId, "video-plan-03");
  } finally {
    __testVideoPlans__.resetVideoPlanCache();
  }
});

test("图像档只认 GPT Image 2，不把 GPT Image 2.5 Flare / Sunburst 当成已审计档", async () => {
  const prices = await getShuyuPrices({ ...ENV, fetchImpl: livePricesFetch() });
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

test("能力探针在真机目录上找到默认档、不报漂移", async () => {
  const prices = await getShuyuPrices({ ...ENV, fetchImpl: livePricesFetch() });
  const result = diagnoseDrift(prices.data);
  assert.equal(result.auditedPlanFound, true);
  assert.deepEqual(result.drifts, []);
});

test("家族识别：Seedance 2.0 各种写法认，2.5 与其他模型不认", () => {
  assert.equal(shuyuVideoPlanFamily("SY Seedance 2.0 Fast VIP · 720P · 方案 3"), "seedance-2.0");
  assert.equal(shuyuVideoPlanFamily("视频-Seedance2.0-720P-推荐1 VIP"), "seedance-2.0");
  assert.equal(shuyuVideoPlanFamily("SY Seedance 2.5 · 1080P · 方案 78"), null);
  assert.equal(shuyuVideoPlanFamily("SY Kling 4.0 · 720P · 方案 107"), null);
  assert.equal(shuyuVideoPlanFamily("Studio Video Pro"), null);
});
