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

test("🔴 0728 场景：套餐 ID 轮换要报出新旧值，而不是「什么都没找到」", () => {
  const result = diagnoseDrift([goodPlan({ plan_id: "video-plan-07" })]);
  assert.equal(result.auditedPlanFound, false);
  const drift = result.drifts.find((d) => d.field === "plan_id");
  assert.ok(drift, "必须定位到 plan_id 这个字段");
  assert.equal(drift.expected, SHUYU_VIDEO_PLAN_ID);
  assert.equal(drift.actual, "video-plan-07");
});

test("🔴 计价漂移最危险：sale_points 变了要精确报出", () => {
  /// 审计写死 900 分。上游调价后若不拦，会「按 900 计价却实际扣别的分」。
  const result = diagnoseDrift([goodPlan({ sale_points: 1200 })]);
  const drift = result.drifts.find((d) => d.field === "sale_points");
  assert.ok(drift);
  assert.equal(drift.expected, "900");
  assert.equal(drift.actual, "1200");
});

test("分辨率降档与画幅缺失都能逐字段定位", () => {
  const result = diagnoseDrift([
    goodPlan({
      resolution: "480P",
      capabilities: { aspect_ratios: ["16:9"], input_images_max: 9 },
    }),
  ]);
  const fields = result.drifts.map((d) => d.field);
  assert.ok(fields.includes("resolution"));
  assert.ok(fields.includes("aspect_ratios"));
});

test("video 套餐整体消失是最严重一档，单独标记", () => {
  const result = diagnoseDrift([
    goodPlan({ kind: "image", plan_id: "img-1" }),
  ]);
  assert.equal(result.videoPlansGone, true);
  assert.equal(result.drifts[0].field, "kind=video");
});

test("多个 video 套餐时优先对比同 ID，其次同型号", () => {
  /// 上游同时挂着新旧两个套餐时，要对比的是我们锁定的那个，
  /// 不能拿一个无关套餐报一堆假漂移。
  const result = diagnoseDrift([
    goodPlan({ plan_id: "other-plan", model: "different-model", sale_points: 50 }),
    goodPlan({ sale_points: 1200 }),
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
