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

test("分辨率出族与画幅缺失都能逐字段定位(480P 已入审计族)", () => {
  const result = diagnoseDrift([
    goodPlan({
      resolution: "1080P",
      capabilities: { aspect_ratios: ["16:9"], input_images_max: 9 },
    }),
  ]);
  const fields = result.drifts.map((d) => d.field);
  assert.ok(fields.includes("resolution"));
  assert.ok(fields.includes("aspect_ratios"));

  /// 480P 按秒档 0803 起是合法审计族成员,不得再报分辨率漂移。
  const budget = diagnoseDrift([
    goodPlan({ resolution: "480P", sale_points: 68, unit: "second" }),
  ]);
  assert.equal(budget.auditedPlanFound, true);
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
