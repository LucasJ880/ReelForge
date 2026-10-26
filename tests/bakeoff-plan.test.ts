/**
 * X-SCAF-8：bake-off 的纯函数——输入清单校验、同一份 prompt（生产启发式分镜）、参考图顺序、
 * 臂解析、幂等键、内置参考价与实时价核对、任务时间线。不触网、不调 LLM。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BAKEOFF_REFERENCE_POINTS_PER_SECOND,
  bakeoffTaskKey,
  buildBakeoffPrompt,
  expandTasks,
  isTerminalShuyuStatus,
  livePriceSanity,
  observeTask,
  orderInputImages,
  parseArms,
  parseBakeoffManifest,
  referencePointsPerTask,
} from "../scripts/lib/bakeoff-plan";

const example = () =>
  JSON.parse(readFileSync(new URL("../scripts/bakeoff/e7-manifest.example.json", import.meta.url), "utf8"));

test("示例清单通过校验并补默认值", () => {
  const manifest = parseBakeoffManifest(example());
  assert.equal(manifest.experiment, "E7");
  assert.equal(manifest.items.length, 2);
  assert.deepEqual(manifest.items[1].storyboardFrames, []);
  const minimal = parseBakeoffManifest({
    experiment: "E12",
    items: [{ id: "a", productName: "x", productImages: ["https://e.com/a.png"] }],
  });
  assert.deepEqual([minimal.durationSec, minimal.aspectRatio, minimal.language], [15, "9:16", "en-US"]);
});

test("清单校验：非 HTTPS、重复 id、非法 id、多余字段、超时长都拒绝", () => {
  const base = { experiment: "E7", items: [{ id: "a", productName: "x", productImages: ["https://e.com/a.png"] }] };
  assert.throws(() => parseBakeoffManifest({ ...base, items: [{ ...base.items[0], productImages: ["http://e.com/a.png"] }] }), /HTTPS/);
  assert.throws(() => parseBakeoffManifest({ ...base, items: [base.items[0], base.items[0]] }), /id 重复/);
  assert.throws(() => parseBakeoffManifest({ ...base, items: [{ ...base.items[0], id: "a b" }] }), /id/);
  assert.throws(() => parseBakeoffManifest({ ...base, extra: 1 }), /不合法/);
  assert.throws(() => parseBakeoffManifest({ ...base, durationSec: 30 }), /durationSec/);
  assert.throws(() => parseBakeoffManifest({ ...base, items: [] }), /items/);
});

test("同一份 prompt：确定性、按清单时长重铺分镜、带画幅与品牌护栏，不含 URL", () => {
  const manifest = parseBakeoffManifest(example());
  const item = manifest.items[0];
  const a = buildBakeoffPrompt(manifest, item);
  const b = buildBakeoffPrompt(manifest, item);
  assert.equal(a.prompt, b.prompt);
  assert.equal(a.sha256, b.sha256);
  assert.match(a.prompt, /9:16/);
  assert.match(a.prompt, /15s/);
  assert.doesNotMatch(a.prompt, /https?:\/\//);
  assert.match(a.negativePrompt, /no logo/);
  const other = buildBakeoffPrompt(manifest, manifest.items[1]);
  assert.notEqual(other.sha256, a.sha256);
  const short = buildBakeoffPrompt({ ...manifest, durationSec: 5 }, item);
  assert.doesNotMatch(short.prompt, /\b1[0-5]s\b/);
});

test("参考图顺序：实拍在前、故事板帧在后，按套餐上限截断", () => {
  const item = parseBakeoffManifest(example()).items[0];
  assert.deepEqual(orderInputImages(item, 9), [...item.productImages, ...item.storyboardFrames]);
  assert.deepEqual(orderInputImages(item, 4), [...item.productImages, item.storyboardFrames[0]]);
  assert.deepEqual(orderInputImages(item, 2), item.productImages.slice(0, 2));
  assert.deepEqual(orderInputImages(item, 0), []);
});

test("臂：plan_id 列表，空 / 重复 / 非法都拒绝", () => {
  assert.deepEqual(parseArms(" video-plan-04 , video-plan-08 "), ["video-plan-04", "video-plan-08"]);
  assert.throws(() => parseArms(""), /至少/);
  assert.throws(() => parseArms("a,a"), /重复/);
  assert.throws(() => parseArms("bad id"), /不合法/);
});

test("幂等键：exp-2611- 前缀、稳定、≤120、各维度不同则不同", () => {
  const spec = { experiment: "E7", runTag: "20261101", itemId: "bottle", planId: "video-plan-08", rep: 1 };
  const key = bakeoffTaskKey(spec);
  assert.equal(key, "exp-2611-E7-20261101-bottle-video-plan-08-r1");
  assert.equal(bakeoffTaskKey(spec), key);
  assert.notEqual(bakeoffTaskKey({ ...spec, rep: 2 }), key);
  assert.notEqual(bakeoffTaskKey({ ...spec, planId: "video-plan-04" }), key);
  assert.equal(bakeoffTaskKey({ ...spec, planId: "plan:a/b" }), "exp-2611-E7-20261101-bottle-plan_a_b-r1");
  const long = bakeoffTaskKey({ ...spec, itemId: "x".repeat(64), planId: "p".repeat(150) });
  assert.ok(long.length <= 120 && long.length >= 8);
  assert.notEqual(long, bakeoffTaskKey({ ...spec, itemId: "x".repeat(64), planId: `${"p".repeat(149)}q` }));
});

test("任务展开：条目 × 臂 × 重复，键互不相同", () => {
  const manifest = parseBakeoffManifest(example());
  const tasks = expandTasks(manifest, ["a", "b"], "t1", 3);
  assert.equal(tasks.length, 2 * 2 * 3);
  assert.equal(new Set(tasks.map((task) => task.key)).size, tasks.length);
});

test("内置参考价：已知分辨率按表；未知按最贵档保守估；实时价超 2 倍拒绝", () => {
  assert.equal(BAKEOFF_REFERENCE_POINTS_PER_SECOND["1080P"], 240);
  assert.equal(referencePointsPerTask("1080P", 15), 3_600);
  assert.equal(referencePointsPerTask("720P", 15), 1_425);
  assert.equal(referencePointsPerTask(null, 15), 3_600);
  assert.equal(referencePointsPerTask("720P", 4.2), 475);
  assert.deepEqual(livePriceSanity({ planId: "p", resolution: "1080P", livePointsPerTask: 7_200, durationSec: 15 }), { ok: true, reason: null });
  const spike = livePriceSanity({ planId: "p", resolution: "1080P", livePointsPerTask: 7_201, durationSec: 15 });
  assert.equal(spike.ok, false);
  assert.match(spike.reason!, /价格异动/);
});

test("时间线：processing 只记第一次；终态记完成时刻；refund 系列也算终态", () => {
  const t1 = new Date("2026-11-01T00:00:20.000Z");
  const t2 = new Date("2026-11-01T00:00:40.000Z");
  const t3 = new Date("2026-11-01T00:01:00.000Z");
  let timeline = observeTask({ submittedAt: "2026-11-01T00:00:00.000Z" }, "queued", t1);
  assert.equal(timeline.firstProcessingAt, undefined);
  timeline = observeTask(timeline, "processing", t2);
  timeline = observeTask(timeline, "processing", t3);
  assert.equal(timeline.firstProcessingAt, t2.toISOString());
  timeline = observeTask(timeline, "completed", t3);
  assert.equal(timeline.completedAt, t3.toISOString());
  assert.equal(isTerminalShuyuStatus("refunded"), true);
  assert.equal(isTerminalShuyuStatus("processing"), false);
  assert.equal(isTerminalShuyuStatus(null), false);
});
