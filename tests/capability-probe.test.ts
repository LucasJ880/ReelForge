import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { diagnoseDrift } from "../src/lib/services/capability-probe-service";
import {
  isAuditedShuyuVideoPlan,
  SHUYU_VIDEO_PLAN_ID,
  SHUYU_VIDEO_POINTS_PER_GENERATION,
} from "../src/lib/providers/shuyu";

/**
 * C1 · 能力探测（PRD §6 / M7）。
 * 0728 套餐轮换、0729 线路崩溃都栽在「health 只测存活」的盲区。
 */

function goodPlan(overrides: Record<string, unknown> = {}) {
  return {
    plan_id: SHUYU_VIDEO_PLAN_ID,
    kind: "video" as const,
    status: "available" as const,
    model: "studio-video",
    unit: "generation" as const,
    resolution: "720P",
    sale_points: SHUYU_VIDEO_POINTS_PER_GENERATION,
    display_name: "Studio Video",
    capabilities: {
      aspect_ratios: ["9:16", "16:9", "1:1"] as const,
      input_images_max: 9,
      modes: ["text2video", "image2video"] as const,
      durations: [5, 10, 15],
    },
    ...overrides,
  } as never;
}

test("契约完全匹配 → ok，无漂移（探测判据与审计一一对应）", () => {
  const plan = goodPlan();
  /// 同一个套餐必须同时通过审计与探测 —— 两把尺子不一致会出现
  /// 「审计不过但报不出漂移」或反过来的假漂移。
  assert.equal(isAuditedShuyuVideoPlan(plan), true, "fixture 必须满足真实审计契约");
  const result = diagnoseDrift([plan]);
  assert.equal(result.auditedPlanFound, true);
  assert.deepEqual(result.drifts, []);
});

test("0728 的另一个坑：15s 时长下线能被定位到 durations 字段", () => {
  const result = diagnoseDrift([
    goodPlan({
      capabilities: {
        aspect_ratios: ["9:16", "16:9", "1:1"],
        input_images_max: 9,
        modes: ["text2video", "image2video"],
        durations: [5, 10],
      },
    }),
  ]);
  const drift = result.drifts.find((d) => d.field === "durations");
  assert.ok(drift, "durations 漂移必须被报出");
  assert.equal(drift.actual, "5,10");
});

test("🔴 0803 反例：套餐 ID 轮换是常态，绝不能再被误判成停机", () => {
  /// 0803 真机:video-plan-02 → video-plan-01 轮换被钉死审计误判为
  /// price_contract_mismatch,假停机数小时。语义审计下 ID 轮换必须是健康态。
  const result = diagnoseDrift([goodPlan({ plan_id: "video-plan-07" })]);
  assert.equal(result.auditedPlanFound, true);
  assert.equal(result.drifts.length, 0);
});

test("🔴 计价漂移：健全区间内调价是常态，越界必须精确报出", () => {
  /// 实际扣分随 /prices 实时价走,不存在「按旧价计价扣新价」;
  /// 审计只拦越界价(疯涨/疑似错价),照单全收才是事故。
  const priced = diagnoseDrift([goodPlan({ sale_points: 1200 })]);
  assert.equal(priced.auditedPlanFound, true);

  const insane = diagnoseDrift([goodPlan({ sale_points: 5000 })]);
  assert.equal(insane.auditedPlanFound, false);
  const drift = insane.drifts.find((d) => d.field === "sale_points");
  assert.ok(drift, "越界价必须定位到 sale_points 字段");
  assert.match(drift.expected, /100-2000/);
  assert.equal(drift.actual, "5000/generation");
});

test("分辨率出族与画幅缺失都能逐字段定位(480P / 1080P 已入审计族,4K 出族)", () => {
  /// 1026 实价:4K 640 点/秒在售但不在审计族内;1080P 已入族(final 档),见下。
  const result = diagnoseDrift([
    goodPlan({
      resolution: "4K",
      unit: "second",
      sale_points: 640,
      capabilities: { aspect_ratios: ["16:9"], input_images_max: 9 },
    }),
  ]);
  /// 分辨率出族只由 resolution 判据报;sale_points / tier 判据在出族时直接算匹配,
  /// 不叠一个无意义的「640/秒越界」或「档位」漂移。(夹具整体覆盖了 capabilities,
  /// 所以 modes / durations 也会如实报缺失——那是夹具的真实漂移。)
  const fields = result.drifts.map((d) => d.field);
  assert.ok(fields.includes("resolution"));
  assert.ok(fields.includes("aspect_ratios"));
  assert.ok(!fields.includes("sale_points"), "出族分辨率不叠计价漂移");
  assert.ok(!fields.includes("tier"), "出族分辨率不叠档位漂移");
  const resolutionDrift = result.drifts.find((d) => d.field === "resolution");
  assert.ok(resolutionDrift);
  assert.equal(resolutionDrift.actual, "4K");
  assert.match(resolutionDrift.expected, /1080P/);

  /// 480P 按秒档 0803 起是合法审计族成员,不得再报分辨率漂移。
  const budget = diagnoseDrift([
    goodPlan({ resolution: "480P", sale_points: 68, unit: "second" }),
  ]);
  assert.equal(budget.auditedPlanFound, true);

  /// 1080P 按秒 240(1026 实价)1026 起审计通过(final 档),但探针的「线路可用」只看默认档:
  /// 价目表只剩 1080P 等于默认线路停机(与 0803/0804 整体轮换同口径),必须精确报到 tier。
  const final = goodPlan({ resolution: "1080P", sale_points: 240, unit: "second" });
  assert.equal(isAuditedShuyuVideoPlan(final), true);
  const onlyFinal = diagnoseDrift([final]);
  assert.equal(onlyFinal.auditedPlanFound, false);
  assert.deepEqual(onlyFinal.drifts.map((d) => d.field), ["tier"]);
  assert.equal(onlyFinal.drifts[0].actual, "final");
  assert.match(onlyFinal.drifts[0].expected, /draft/);
  /// 1080P 旁边只要有一个 draft 档审计通过,线路就是健康的。
  assert.equal(diagnoseDrift([final, goodPlan()]).auditedPlanFound, true);
  /// 诊断候选优先挑 draft 分辨率:720P 缺 15s + 1080P 正常 → 报 durations,而不是拿 1080P 报 tier。
  const draftBroken = diagnoseDrift([
    final,
    goodPlan({
      capabilities: {
        aspect_ratios: ["9:16", "16:9", "1:1"],
        input_images_max: 9,
        modes: ["text2video", "image2video"],
        durations: [5, 10],
      },
    }),
  ]);
  assert.equal(draftBroken.auditedPlanFound, false);
  assert.deepEqual(draftBroken.drifts.map((d) => d.field), ["durations"]);
  /// 1080P 计价越界(按秒 >400)要精确报到 sale_points,且期望值写出 1080P 自己的区间。
  const insaneFinal = diagnoseDrift([
    goodPlan({ resolution: "1080P", sale_points: 500, unit: "second" }),
  ]);
  assert.equal(insaneFinal.auditedPlanFound, false);
  const priceDrift = insaneFinal.drifts.find((d) => d.field === "sale_points");
  assert.ok(priceDrift);
  assert.match(priceDrift.expected, /1080P 按条 100-8000 \/ 按秒 100-400/);
  assert.equal(priceDrift.actual, "500/second");
});

test("video 套餐整体消失是最严重一档，单独标记", () => {
  const result = diagnoseDrift([
    goodPlan({ kind: "image", plan_id: "img-1" }),
  ]);
  assert.equal(result.videoPlansGone, true);
  assert.equal(result.drifts[0].field, "kind=video");
});

test("多个 video 套餐时优先对比 studio-video 家族成员", () => {
  /// 上游同时挂着多个套餐时，诊断对象是我们家族里最像的那个,
  /// 不能拿一个无关型号套餐报一堆假漂移。
  const result = diagnoseDrift([
    goodPlan({ plan_id: "other-plan", model: "different-model", sale_points: 50 }),
    goodPlan({ sale_points: 5000 }),
  ]);
  assert.equal(result.drifts.length, 1);
  assert.equal(result.drifts[0].field, "sale_points");
});

test("探测结果落库且漂移走 stderr 告警；降级不重复做", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/services/capability-probe-service.ts"),
    "utf8",
  );
  assert.match(source, /db\.capabilityProbe\.create/);
  assert.match(source, /console\.error/);
  /// 降级由 route discovery 完成，探测只诊断 —— 两处都做会打架。
  assert.match(source, /降级本身由/);
});

test("cron 路由：机器鉴权，漂移时 503 让外部拨测能直接告警", () => {
  const route = readFileSync(
    path.join(process.cwd(), "src/app/api/cron/capability-probe/route.ts"),
    "utf8",
  );
  assert.match(route, /machineAuthFailure\(req\)/);
  assert.match(route, /status: result\.ok \? 200 : 503/);
});
