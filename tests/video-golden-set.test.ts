import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AI_SCORED_DIMENSIONS,
  CHARACTER_SHEET_ORDINAL,
  blindLayout,
  initialRunRecord,
  nextGoldenSetStep,
  normalizeAiScores,
  parseArms,
  goldenSetRequestKey,
  parseGoldenSetCases,
  pendingSpend,
  retryFailedSteps,
  selectCases,
  tallyBlindVotes,
} from "../scripts/lib/video-golden-set";
import { voiceoverBudget } from "../src/lib/video-generation/voiceover-writer";

/**
 * 视频评测集（2026-10-29）：同一批用例、同一条 Shuyu 线路比较新旧代码出的片。
 * 这里只测纯逻辑；真机出片要预算闸放行（scripts/eval/video-golden-set.ts run --confirm-spend --max-points）。
 */

test("用例文件：10 个品类、id 不重复、商品图都是 https、15 秒竖屏；口播稿 15 秒说得完", async () => {
  const cases = parseGoldenSetCases(JSON.parse(await readFile("scripts/eval/golden-set.cases.json", "utf8")));
  assert.equal(cases.length, 10);
  assert.equal(new Set(cases.map((item) => item.category)).size, 10, "每条一个品类");
  for (const item of cases) {
    assert.ok(item.productImages.every((url) => url.startsWith("https://")), item.id);
    assert.equal(item.durationSec, 15);
    assert.equal(item.aspectRatio, "9:16");
    assert.ok(item.watchFor.length >= 3, `${item.id} 要写清最容易翻车的地方`);
    const spoken = Array.from(item.voiceover.replace(/\s+/gu, "")).length;
    assert.ok(spoken <= voiceoverBudget(15, false), `${item.id} 口播 ${spoken} 字超过 15 秒预算`);
  }
  assert.throws(() => parseGoldenSetCases({ version: 1, cases: [cases[0], cases[0]] }), /重复/);
  assert.deepEqual(selectCases(cases, "watch,bottle").map((item) => item.id), ["bottle", "watch"]);
  assert.throws(() => selectCases(cases, "bottle,nope"), /nope/);
});

test("臂：名字=git 版本；名字小写开头、不重复；没给就报错", () => {
  assert.deepEqual(parseArms("old=3431ff4, new=HEAD"), [
    { id: "old", ref: "3431ff4" },
    { id: "new", ref: "HEAD" },
  ]);
  assert.deepEqual(parseArms("wip=."), [{ id: "wip", ref: "." }]);
  assert.throws(() => parseArms(""), /至少/);
  assert.throws(() => parseArms("Old=1"), /名字=git/);
  assert.throws(() => parseArms("old"), /名字=git/);
  assert.throws(() => parseArms("a=1,a=2"), /重复/);
});

const fresh = () =>
  initialRunRecord({
    caseId: "bottle",
    armId: "new",
    ref: "9cc6b2b",
    sha: "9cc6b2b",
    framePrompts: ["f1", "f2", "f3", "f4"],
    video: { prompt: "v", negativePrompt: null, durationSec: 15 },
  });

test("续跑：帧一张张出（前帧出好才提交下一帧），齐了才出视频；有任务号的只续查不重提；失败就停", () => {
  const record = fresh();
  assert.deepEqual(nextGoldenSetStep(record), { kind: "submit_frame", ordinal: 0 });
  assert.deepEqual(pendingSpend(record), { frames: 4, videos: 1 });

  Object.assign(record.frames[0], { status: "submitted", taskId: "t0" });
  assert.deepEqual(nextGoldenSetStep(record), { kind: "poll_frame", ordinal: 0 });
  assert.deepEqual(pendingSpend(record), { frames: 3, videos: 1 }, "已提交的不再算待花费");

  Object.assign(record.frames[0], { status: "succeeded", outputUrl: "https://out/0.png" });
  assert.deepEqual(nextGoldenSetStep(record), { kind: "submit_frame", ordinal: 1 });

  for (const frame of record.frames) Object.assign(frame, { status: "succeeded", outputUrl: "https://out.png" });
  assert.deepEqual(nextGoldenSetStep(record), { kind: "submit_video" });
  Object.assign(record.video, { status: "submitted", taskId: "v1" });
  assert.deepEqual(nextGoldenSetStep(record), { kind: "poll_video" });
  Object.assign(record.video, { status: "succeeded", outputUrl: "https://out.mp4" });
  assert.deepEqual(nextGoldenSetStep(record), { kind: "download_video" });
  record.video.localFile = "new/bottle.mp4";
  assert.deepEqual(nextGoldenSetStep(record), { kind: "done" });
  assert.deepEqual(pendingSpend(record), { frames: 0, videos: 0 });

  const broken = fresh();
  Object.assign(broken.frames[1], { status: "failed", error: "refunded" });
  Object.assign(broken.frames[0], { status: "succeeded", outputUrl: "https://out/0.png" });
  assert.deepEqual(nextGoldenSetStep(broken), { kind: "failed", reason: "帧 2 失败：refunded" });
  assert.deepEqual(pendingSpend(broken), { frames: 0, videos: 0 }, "停在失败的不再花钱");
});

test("重试换键：Shuyu 把请求键当幂等键，放回失败的那一步时尝试次数 +1、键随之换新；成功的不动", () => {
  const record = fresh();
  assert.equal(goldenSetRequestKey("golden-1029", record, { ordinal: 2 }), "golden-1029:new:bottle:frame-2-a0");
  assert.equal(goldenSetRequestKey("golden-1029", record, "video"), "golden-1029:new:bottle:video-a0");
  Object.assign(record.frames[0], { status: "succeeded", outputUrl: "https://out/0.png" });
  Object.assign(record.frames[1], { status: "failed", error: "refunded", taskId: "t1" });
  assert.equal(retryFailedSteps(record), 1);
  assert.deepEqual(
    { status: record.frames[1].status, attempt: record.frames[1].attempt, taskId: record.frames[1].taskId, error: record.frames[1].error },
    { status: "pending", attempt: 1, taskId: null, error: null },
  );
  assert.equal(record.frames[0].status, "succeeded");
  assert.equal(goldenSetRequestKey("golden-1029", record, { ordinal: 1 }), "golden-1029:new:bottle:frame-1-a1");
  assert.deepEqual(nextGoldenSetStep(record), { kind: "submit_frame", ordinal: 1 });
  assert.equal(retryFailedSteps(record), 0, "没有失败的就什么都不动");

  /// 提交时 504、没拿到任务号也换新键：同键重提 Shuyu 回 409 且不给任务号，会永远卡住
  const unacked = fresh();
  Object.assign(unacked.video, { status: "failed", error: "Shuyu video submission failed (504)" });
  for (const frame of unacked.frames) Object.assign(frame, { status: "succeeded", outputUrl: "https://out.png" });
  assert.equal(retryFailedSteps(unacked), 1);
  assert.equal(unacked.video.status, "pending");
  assert.equal(goldenSetRequestKey("golden-1029", unacked, "video"), "golden-1029:new:bottle:video-a1");

  /// Shuyu 当场拒单并明说「用同一个请求键重试、没扣点」：照它说的沿用原键
  const validation = fresh();
  Object.assign(validation.video, {
    status: "failed",
    error: "Reference-image validation is temporarily unavailable. Retry with the same Idempotency-Key; no generation points were charged.",
  });
  for (const frame of validation.frames) Object.assign(frame, { status: "succeeded", outputUrl: "https://out.png" });
  assert.equal(retryFailedSteps(validation), 1);
  assert.equal(goldenSetRequestKey("golden-1029", validation, "video"), "golden-1029:new:bottle:video-a0");
});

test("人物设定图（Kelin 精控）：帧齐了才出设定图、设定图好了才出视频；请求键、重试与花费都算它；没有设定图的旧记录照旧", () => {
  const record = initialRunRecord({
    caseId: "earbuds",
    armId: "kelin",
    ref: ".",
    sha: "9cc6b2b+dirty",
    framePrompts: ["opening frame"],
    characterSheetPrompt: "Create ONE photorealistic character reference sheet…",
    video: { prompt: "v", negativePrompt: null, durationSec: 15 },
  });
  assert.equal(record.characterSheet?.ordinal, CHARACTER_SHEET_ORDINAL);
  assert.deepEqual(pendingSpend(record), { frames: 2, videos: 1 }, "设定图与帧同价，算进帧");
  assert.deepEqual(nextGoldenSetStep(record), { kind: "submit_frame", ordinal: 0 });
  Object.assign(record.frames[0], { status: "succeeded", outputUrl: "https://out/0.png" });
  assert.deepEqual(nextGoldenSetStep(record), { kind: "submit_sheet" });
  assert.equal(goldenSetRequestKey("golden-kelin", record, "sheet"), "golden-kelin:kelin:earbuds:sheet-a0");
  Object.assign(record.characterSheet!, { status: "submitted", taskId: "s0" });
  assert.deepEqual(nextGoldenSetStep(record), { kind: "poll_sheet" });
  Object.assign(record.characterSheet!, { status: "failed", error: "refunded" });
  assert.deepEqual(nextGoldenSetStep(record), { kind: "failed", reason: "人物设定图失败：refunded" });
  assert.equal(retryFailedSteps(record), 1);
  assert.equal(goldenSetRequestKey("golden-kelin", record, "sheet"), "golden-kelin:kelin:earbuds:sheet-a1");
  Object.assign(record.characterSheet!, { status: "succeeded", outputUrl: "https://out/sheet.png" });
  assert.deepEqual(nextGoldenSetStep(record), { kind: "submit_video" });

  const legacy = fresh();
  delete (legacy as { characterSheet?: unknown }).characterSheet;
  for (const frame of legacy.frames) Object.assign(frame, { status: "succeeded", outputUrl: "https://out.png" });
  assert.deepEqual(nextGoldenSetStep(legacy), { kind: "submit_video" }, "10-29 之前落盘的记录没有这个字段");
});

test("盲评左右：同一轮可复现、两个臂都在、不会整轮都放同一边", async () => {
  const cases = parseGoldenSetCases(JSON.parse(await readFile("scripts/eval/golden-set.cases.json", "utf8")));
  const ids = cases.map((item) => item.id);
  const layout = blindLayout("golden-1029", ids, ["old", "new"]);
  assert.deepEqual(blindLayout("golden-1029", ids, ["old", "new"]), layout);
  for (const pair of layout) assert.deepEqual([pair.left, pair.right].sort(), ["new", "old"]);
  const leftNew = layout.filter((pair) => pair.left === "new").length;
  assert.ok(leftNew > 0 && leftNew < ids.length, `新版在左 ${leftNew} 条`);
});

test("AI 预评归一：0–2 整数才收，越界 / 缺项记空；证据压成一行；口播那项 AI 不评", () => {
  const scores = normalizeAiScores({
    scores: {
      hook: { score: 2, evidence: "  开场\n直接倒茶  " },
      product: { score: 3, evidence: "x" },
      physics: { score: 1.5 },
      story: 0,
    },
  });
  assert.deepEqual(scores.hook, { score: 2, evidence: "开场 直接倒茶" });
  assert.equal(scores.product.score, null);
  assert.equal(scores.physics.score, null);
  assert.equal(scores.story.score, 0);
  assert.equal(scores.motion.score, null);
  assert.ok(!(AI_SCORED_DIMENSIONS as readonly string[]).includes("voice"));
  assert.equal(normalizeAiScores("not json").hook.score, null);
});

test("人评揭盲：按左右布局还原成臂的胜平负，没评的项不计", () => {
  const layout = [
    { caseId: "bottle", left: "new", right: "old" },
    { caseId: "watch", left: "old", right: "new" },
  ];
  const tally = tallyBlindVotes(layout, {
    bottle: { product: "left", overall: "left" },
    watch: { product: "right", overall: "tie" },
  });
  assert.deepEqual(tally.product.new, { win: 2, tie: 0, loss: 0 });
  assert.deepEqual(tally.product.old, { win: 0, tie: 0, loss: 2 });
  assert.deepEqual(tally.overall.new, { win: 1, tie: 1, loss: 0 });
  assert.deepEqual(tally.hook.new, { win: 0, tie: 0, loss: 0 });
});

test("护栏：评测工具绝不碰数据库，花钱必须过预算闸，盲评文件名不带臂名", async () => {
  const runner = await readFile("scripts/eval/video-golden-set.ts", "utf8");
  assert.match(runner, /process\.env\.DATABASE_URL = NO_DATABASE_URL;/);
  assert.match(runner, /if \(flags\["confirm-spend"\] !== true\) \{/);
  assert.match(runner, /const gate = checkBudgetGate\(/);
  assert.match(runner, /join\(reviewDir, `\$\{item\.id\}-\$\{side\}\.mp4`\)/);
  const builder = await readFile("scripts/eval/build-arm-prompts.ts", "utf8");
  assert.doesNotMatch(builder, /from "\.\.?\//, "复制进旧版工作区运行：只能用 @/ 别名引用那一版的代码");
});
