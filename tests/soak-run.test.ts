import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkBudgetGate } from "../scripts/lib/experiment-budget";
import {
  SOAK_FRAMES_PER_ITEM,
  SOAK_GROUPS,
  SOAK_HOOK_ANGLES,
  SOAK_KEY_PREFIX,
  assertManifestMatches,
  assignRunwayRoutes,
  blankSoakAttempt,
  cardRerunBlocker,
  deriveSoakOutcome,
  estimateSoakSpend,
  expandSoakItems,
  initialSoakRecord,
  isSoakInFlight,
  nextSoakStep,
  parseWave,
  pendingSoakSpend,
  percentile,
  renderSoakReport,
  retrySoakRecord,
  parseVisionSince,
  selectCardRerunItems,
  selectSoakItems,
  shotCardSource,
  soakBlindPairs,
  soakBlindTally,
  soakCardPairs,
  soakDispatchBody,
  soakEndToEndMs,
  soakIdempotencyKey,
  soakPrompt,
  soakStoryboardBody,
  soakSubmitAllowance,
  summarizeSoak,
  type SoakFirstPassInput,
  type SoakItem,
  type SoakJobFact,
  type SoakRecord,
} from "../scripts/lib/soak-run";
import { blindLayout, parseGoldenSetCases, renderBlindReviewPage } from "../scripts/lib/video-golden-set";
import { EXPERIMENT_BATCH_KEY_PREFIX } from "../src/lib/experiments/run-key";
import { unifiedVideoGenerationRequestSchema } from "../src/lib/schemas/unified-input";
import { validateIdempotencyKey } from "../src/lib/services/video-dispatch-idempotency";
import { storyboardFrameCountForDuration } from "../src/lib/video-generation/storyboard-service";

/**
 * 真机压测（抖音矩阵上线前「轮 2」）的纯逻辑。真提交要预算闸放行，
 * 见 scripts/ops/soak-run.ts run --confirm-spend --max-points。
 */

async function loadItems(): Promise<SoakItem[]> {
  return expandSoakItems(parseGoldenSetCases(JSON.parse(await readFile("scripts/eval/golden-set.cases.json", "utf8"))));
}

const T0 = "2026-11-10T01:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();
const noScores = (input: Omit<SoakFirstPassInput, "scores">): SoakFirstPassInput => ({ ...input, scores: {} });

function job(overrides: Partial<SoakJobFact> = {}): SoakJobFact {
  return {
    id: "job-1",
    status: "SUCCEEDED",
    submissionState: "ACCEPTED",
    submissionErrorClass: null,
    route: "buddy",
    frameQaStatus: "PASSED",
    frameQaBlockCount: 0,
    frameQaCheckedAt: at(12),
    frameQaClaimedAt: null,
    retryCount: 0,
    submitAttempts: 1,
    submittedAt: at(5),
    finishedAt: at(12),
    superseded: false,
    unitPoints: 700,
    unitUsd: null,
    error: null,
    ...overrides,
  };
}

/// 一条走到指定阶段的记录
function recordAt(
  item: SoakItem,
  stage: "pending" | "generating" | "awaiting" | "approved" | "rendering" | "ready" | "video_failed" | "storyboard_failed",
  minutesToFinish = 14,
): SoakRecord {
  const record = initialSoakRecord(item);
  if (stage === "pending") return record;
  const { storyboard, dispatch, video } = record.current;
  Object.assign(storyboard, { requestedAt: T0, runId: `run-${item.id}`, status: "GENERATING" });
  storyboard.frames = Array.from({ length: SOAK_FRAMES_PER_ITEM }, (_, ordinal) => ({
    ordinal,
    attempt: 1,
    isCurrent: true,
    status: stage === "generating" ? "QUEUED" : "SUCCEEDED",
    submissionState: stage === "generating" ? "NOT_STARTED" : "ACCEPTED",
    planId: "image-2k",
    errorCode: null,
  }));
  if (stage === "generating") return record;
  if (stage === "storyboard_failed") {
    Object.assign(storyboard, { status: "FAILED", error: "第 3 帧提交确认未知" });
    Object.assign(storyboard.frames[2], { status: "FAILED", submissionState: "ACK_UNKNOWN", errorCode: "ACK_UNKNOWN" });
    return record;
  }
  storyboard.status = "AWAITING_APPROVAL";
  if (stage === "awaiting") return record;
  storyboard.status = "APPROVED";
  if (stage === "approved") return record;
  Object.assign(dispatch, { state: "accepted", briefId: `brief-${item.id}`, deliveryOrderId: `order-${item.id}`, httpStatus: 200 });
  video.briefStatus = "RENDERING";
  video.jobs = [job({ id: `job-${item.id}`, status: "RUNNING", finishedAt: null, frameQaStatus: null, frameQaCheckedAt: null })];
  if (stage === "rendering") return record;
  if (stage === "video_failed") {
    video.briefStatus = "RENDER_FAILED";
    video.jobs = [job({ id: `job-${item.id}`, status: "FAILED", frameQaStatus: null, frameQaCheckedAt: null, error: "[provider:failed] refunded" })];
    return record;
  }
  video.briefStatus = "RENDER_SUCCEEDED";
  video.finalVideoStatus = "READY";
  video.finalVideoUrl = `https://example.com/${item.id}.mp4`;
  video.finishedAt = at(minutesToFinish);
  video.jobs = [job({ id: `job-${item.id}`, route: item.route })];
  return record;
}

test("展开：10 个品类 × 2 个钩子角度 × A/B 两组 = 40 条（20 对），id 不重复；每对 A 在前 B 紧跟", async () => {
  const items = await loadItems();
  assert.deepEqual(SOAK_HOOK_ANGLES.map((angle) => angle.id), ["pain", "result"]);
  for (const angle of SOAK_HOOK_ANGLES) assert.match(angle.direction, /^开头/u, angle.id);
  assert.deepEqual(SOAK_GROUPS.map((group) => group.id), ["A", "B"]);
  assert.equal(items.length, 40);
  assert.equal(new Set(items.map((item) => item.id)).size, 40);
  assert.equal(new Set(items.map((item) => item.pairId)).size, 20);
  assert.equal(new Set(items.map((item) => item.caseId)).size, 10);
  for (const angle of SOAK_HOOK_ANGLES) assert.equal(items.filter((item) => item.angleId === angle.id).length, 20);
  for (const group of SOAK_GROUPS) assert.equal(items.filter((item) => item.group === group.id).length, 20);
  assert.ok(items.every((item) => item.route === "buddy"), "默认全走 Shuyu");
  assert.deepEqual(items.slice(0, 3).map((item) => `${item.id}/${item.pairId}/${item.group}`), [
    "bottle-pain-a/bottle-pain/A",
    "bottle-pain-b/bottle-pain/B",
    "earbuds-pain-a/earbuds-pain/A",
  ]);
  assert.match(soakPrompt({ story: "卖保温杯。" }, "result"), /^卖保温杯。\n开头钩子（结果前置）：开头第一个画面/u);
});

test("请求体：15 秒、9:16、中文口播，过线上的创作请求校验；Runway 条目才点名线路；B 组才带确认过的段提示词", async () => {
  const cases = parseGoldenSetCases(JSON.parse(await readFile("scripts/eval/golden-set.cases.json", "utf8")));
  for (const item of cases) {
    const assetIds = item.productImages.map((_, index) => `asset-${index}`);
    const storyboard = soakStoryboardBody(item, "result", assetIds);
    assert.deepEqual(
      [storyboard.durationSec, storyboard.aspectRatio, storyboard.approvalPolicy, storyboard.purpose],
      [15, "9:16", "MANUAL", "single-video-storyboard"],
    );
    assert.ok(storyboard.prompt.length <= 4000 && storyboard.sourceAssetIds.length <= 9, item.id);
    const body = soakDispatchBody({ item, angleId: "result", assetIds, storyboardRunId: "run-1", route: "buddy" });
    const parsed = unifiedVideoGenerationRequestSchema.safeParse(body.request);
    assert.ok(parsed.success, `${item.id}: ${parsed.success ? "" : parsed.error.message}`);
    assert.equal(body.request.rawPrompt, storyboard.prompt, "故事板与出片读的是同一段描述");
    assert.deepEqual(
      [body.request.selectedDuration, body.request.selectedAspectRatio, body.request.audio.voiceover.language, body.request.audio.voiceover.enabled],
      [15, "9:16", "zh-CN", true],
    );
    assert.equal(body.request.audio.voiceover.script, item.voiceover);
    assert.equal("videoRouteId" in body, false, "Shuyu 条目不点名线路，走客户默认线路");
    assert.equal("confirmedPrompts" in body, false, "A 组不带确认过的段提示词");
  }
  const base = { item: cases[0], angleId: "pain" as const, assetIds: ["a"], storyboardRunId: "run-1" };
  assert.equal(soakDispatchBody({ ...base, route: "runway" }).videoRouteId, "runway");
  const groupB = soakDispatchBody({ ...base, route: "buddy", confirmedPrompts: [{ segmentOrder: 0, prompt: "heuristic prompt" }] });
  assert.deepEqual(groupB.confirmedPrompts, [{ segmentOrder: 0, prompt: "heuristic prompt" }]);
  assert.deepEqual(groupB.request, soakDispatchBody({ ...base, route: "buddy" }).request, "两组交上去的创作请求一字不差");
});

test("帧数与幂等键：15 秒故事板 4 帧与线上一致；键带实验前缀、过派发接口的格式校验、同一次尝试不变", async () => {
  assert.equal(SOAK_FRAMES_PER_ITEM, storyboardFrameCountForDuration(15));
  assert.equal(SOAK_KEY_PREFIX, EXPERIMENT_BATCH_KEY_PREFIX);
  const [item] = await loadItems();
  const record = initialSoakRecord(item);
  const storyboardKey = soakIdempotencyKey("soak-1110", record, "storyboard");
  assert.equal(storyboardKey, "exp-2611-soak-1110:bottle-pain-a:a0:sb");
  assert.equal(soakIdempotencyKey("soak-1110", record, "dispatch"), "exp-2611-soak-1110:bottle-pain-a:a0:dispatch-r0");
  assert.equal(validateIdempotencyKey(soakIdempotencyKey("soak-1110", record, "dispatch")), "exp-2611-soak-1110:bottle-pain-a:a0:dispatch-r0");
  record.current.dispatch.retries = 1;
  assert.match(soakIdempotencyKey("soak-1110", record, "dispatch"), /dispatch-r1$/u, "可安全重试的派发错误换键");
  assert.equal(soakIdempotencyKey("soak-1110", record, "storyboard"), storyboardKey, "故事板的键不跟着派发重试变");
});

test("分波：按对分成 7 / 7 / 6 对（14 / 14 / 12 条）；一对的 A、B 永远同一波；每一波两个角度、两组都有", async () => {
  const items = await loadItems();
  const byWave = (wave: string) => items.filter((item) => item.wave === wave);
  assert.deepEqual([byWave("morning").length, byWave("noon").length, byWave("evening").length], [14, 14, 12]);
  for (const wave of ["morning", "noon", "evening"]) {
    assert.equal(new Set(byWave(wave).map((item) => item.angleId)).size, 2, `${wave} 两个角度都有`);
    assert.equal(byWave(wave).filter((item) => item.group === "A").length, byWave(wave).length / 2, `${wave} 两组各一半`);
  }
  for (const pairId of new Set(items.map((item) => item.pairId))) {
    const members = items.filter((item) => item.pairId === pairId);
    assert.deepEqual(members.map((item) => item.group), ["A", "B"], pairId);
    assert.equal(new Set(members.map((item) => item.wave)).size, 1, `${pairId} 两条同一波`);
  }
  assert.equal(parseWave("noon"), "noon");
  assert.equal(parseWave("all"), "all");
  assert.throws(() => parseWave("night"), /morning \| noon \| evening \| all/u);
  assert.throws(() => parseWave(null), /--wave/u);
});

test("选子集：--limit 2 冒烟 = 第一对的 A 与 B；按品类 / 角度 / 一对 / 单条点名；拼错的名字与空结果直接报错", async () => {
  const items = await loadItems();
  assert.deepEqual(selectSoakItems(items, { limit: 2 }).map((item) => item.id), ["bottle-pain-a", "bottle-pain-b"]);
  assert.equal(selectSoakItems(items, {}).length, 40);
  assert.equal(selectSoakItems(items, { cases: "bottle,serum" }).length, 8);
  assert.deepEqual(selectSoakItems(items, { cases: "bottle", angles: "result" }).map((item) => item.id), ["bottle-result-a", "bottle-result-b"]);
  assert.deepEqual(selectSoakItems(items, { arms: "serum-result, bottle-pain-b" }).map((item) => item.id), [
    "bottle-pain-b",
    "serum-result-a",
    "serum-result-b",
  ]);
  assert.throws(() => selectSoakItems(items, { cases: "bottel" }), /bottel/u);
  assert.throws(() => selectSoakItems(items, { angles: "shock" }), /shock/u);
  assert.throws(() => selectSoakItems(items, { arms: "bottle-shock" }), /bottle-shock/u);
  assert.throws(() => selectSoakItems(items, { arms: "bottle-pain", angles: "result" }), /一条都不剩/u);
  assert.throws(() => selectSoakItems(items, { limit: 0 }), /正整数/u);
});

test("线路：--runway n 按对挑（一对的 A、B 同一条线路），挑时段、角度、品类重复最少的；奇数、超量、负数报错；清单定了不能中途变", async () => {
  const items = await loadItems();
  const routed = assignRunwayRoutes(items, 4);
  const runway = routed.filter((item) => item.route === "runway");
  assert.deepEqual(runway.map((item) => `${item.id}@${item.wave}`), [
    "bottle-pain-a@morning",
    "bottle-pain-b@morning",
    "earbuds-result-a@evening",
    "earbuds-result-b@evening",
  ]);
  assert.equal(routed.filter((item) => item.route === "buddy").length, 36);
  for (const pairId of new Set(routed.map((item) => item.pairId))) {
    assert.equal(new Set(routed.filter((item) => item.pairId === pairId).map((item) => item.route)).size, 1, `${pairId} 两条同一条线路`);
  }
  assert.deepEqual(assignRunwayRoutes(items, 4), routed, "同样的输入永远挑同样的几对");
  assert.ok(assignRunwayRoutes(items, 0).every((item) => item.route === "buddy"));
  assert.equal(assignRunwayRoutes(items.slice(0, 2), 2).filter((item) => item.route === "runway").length, 2);
  assert.throws(() => assignRunwayRoutes(items, 3), /偶数/u);
  assert.throws(() => assignRunwayRoutes(items.slice(0, 2), 4), /超过了选中的 1 对/u);
  assert.throws(() => assignRunwayRoutes(items.slice(0, 3), 4), /超过了选中的 1 对/u, "落单的那条不成对，不参与");
  assert.throws(() => assignRunwayRoutes(items, -2), /非负整数/u);

  const manifest = { version: 1 as const, runKey: "soak-1110", createdAt: T0, items: routed };
  assert.doesNotThrow(() => assertManifestMatches(manifest, assignRunwayRoutes(items, 4)));
  assert.throws(() => assertManifestMatches(manifest, items), /换 --run-key/u, "Runway 条数变了");
  assert.throws(() => assertManifestMatches(manifest, routed.slice(0, 2)), /换 --run-key/u, "条目变了");
});

test("点数估算：两组分开列、按实时单价算，已提交的不再计；超过上限、余额不够、Runway 没给单价都拒绝花钱", async () => {
  const items = assignRunwayRoutes(await loadItems(), 4);
  const fresh = items.map((item) => initialSoakRecord(item));
  const prices = { frameUnitPoints: 60, shuyuVideoUnitPoints: 700, runwayVideoUnitUsd: 4.5 };
  const estimate = estimateSoakSpend({ records: fresh, ...prices });
  assert.deepEqual(estimate.lines.map((line) => [line.armId, line.count, line.points]), [
    ["A 组·故事板帧", 80, 4_800],
    ["A 组·Shuyu 视频", 18, 12_600],
    ["A 组·Runway 视频", 2, 0],
    ["B 组·故事板帧", 80, 4_800],
    ["B 组·Shuyu 视频", 18, 12_600],
    ["B 组·Runway 视频", 2, 0],
  ]);
  assert.equal(estimate.totalPoints, 34_800);
  assert.equal(estimate.totalUsd, 18);

  const gate = (maxPoints: number | null, availablePoints: number | null, maxUsd: number | null = 20) =>
    checkBudgetGate({ estimate, maxPoints, maxUsd, availablePoints, reservePoints: 7_000 });
  assert.equal(gate(35_000, 60_000).ok, true);
  assert.match(gate(34_799, 60_000).reasons.join("；"), /34800 点 > 硬上限 34799 点/u);
  assert.match(gate(null, 60_000).reasons.join("；"), /没给积分硬上限/u);
  assert.match(gate(35_000, 41_000).reasons.join("；"), /低于预留线 7000 点/u);
  assert.match(gate(35_000, null).reasons.join("；"), /没拿到 Shuyu 实时余额/u);
  assert.match(gate(35_000, 60_000, null).reasons.join("；"), /没给美元硬上限/u);

  const unpriced = estimateSoakSpend({ records: fresh, ...prices, runwayVideoUnitUsd: null });
  assert.deepEqual(unpriced.unpricedArms, ["A 组·Runway 视频", "B 组·Runway 视频"]);
  assert.equal(checkBudgetGate({ estimate: unpriced, maxPoints: 99_999, maxUsd: 99, availablePoints: 99_999, reservePoints: 0 }).ok, false);
  const oneShuyuA = fresh.filter((record) => record.route === "buddy" && record.group === "A").slice(0, 1);
  const noCatalog = estimateSoakSpend({ records: oneShuyuA, frameUnitPoints: null, shuyuVideoUnitPoints: null, runwayVideoUnitUsd: null });
  assert.deepEqual(noCatalog.unpricedArms, ["A 组·故事板帧", "A 组·Shuyu 视频"], "价目表读不到就是未定价，不拿旧常量顶");

  /// 账号的故事板帧走 Runway 出图时：帧按美元计、不算 Shuyu 点数；没给单价就是未定价，拒绝花钱
  const runwayFrames = estimateSoakSpend({ records: fresh, ...prices, frameRoute: "runway", runwayFrameUnitUsd: 0.2 });
  assert.deepEqual(runwayFrames.lines.filter((line) => line.armId.includes("故事板帧")).map((line) => [line.armId, line.count, line.points, line.usd]), [
    ["A 组·故事板帧（Runway 出图）", 80, 0, 16],
    ["B 组·故事板帧（Runway 出图）", 80, 0, 16],
  ]);
  assert.equal(runwayFrames.totalPoints, 25_200, "点数里只剩 Shuyu 视频");
  assert.equal(runwayFrames.totalUsd, 50, "160 帧 × $0.2 + 4 条 Runway 视频 × $4.5");
  assert.match(checkBudgetGate({ estimate: runwayFrames, maxPoints: 30_000, maxUsd: 40, availablePoints: 60_000, reservePoints: 7_000 }).reasons.join("；"), /\$50 > 硬上限 \$40/u);
  assert.deepEqual(
    estimateSoakSpend({ records: fresh, ...prices, frameRoute: "runway" }).unpricedArms,
    ["A 组·故事板帧（Runway 出图）", "B 组·故事板帧（Runway 出图）"],
  );
  const smokeFrames = recordAt({ ...items[2], route: "buddy" }, "ready");
  smokeFrames.current.storyboard.frames.forEach((frame) => (frame.planId = "runway:gpt_image_2"));
  const smokeSummary = summarizeSoak([smokeFrames], { now: new Date(at(60)) });
  assert.deepEqual(smokeSummary.frames.byPlan, { "runway:gpt_image_2": 4 });
  assert.match(renderSoakReport("soak-1110", smokeSummary, new Date(at(60))), /runway:gpt_image_2 4 帧（runway: 开头的按 Runway 美元计费，不扣 Shuyu 点数）/u);

  /// 续跑：已建故事板的不再计帧，已派发的不再计视频，到终态的一分不计
  const [first, second, third, fourth] = items;
  assert.deepEqual(pendingSoakSpend(recordAt(first, "pending")), { frames: 4, videos: 1 });
  assert.deepEqual(pendingSoakSpend(recordAt(first, "generating")), { frames: 0, videos: 1 });
  assert.deepEqual(pendingSoakSpend(recordAt(first, "approved")), { frames: 0, videos: 1 });
  assert.deepEqual(pendingSoakSpend(recordAt(first, "rendering")), { frames: 0, videos: 0 });
  assert.deepEqual(pendingSoakSpend(recordAt(first, "ready")), { frames: 0, videos: 0 });
  assert.deepEqual(pendingSoakSpend(recordAt(first, "storyboard_failed")), { frames: 0, videos: 0 });
  const resumed = estimateSoakSpend({
    records: [recordAt(first, "ready"), recordAt(second, "rendering"), recordAt(third, "awaiting"), recordAt(fourth, "pending")],
    ...prices,
  });
  assert.equal(resumed.totalPoints, 4 * 60 + 2 * 700);
});

test("断点续跑：每个阶段的下一步；有故事板号的不重建，有任务的不重派", async () => {
  const [item] = await loadItems();
  assert.deepEqual(nextSoakStep(recordAt(item, "pending")), { kind: "create_storyboard" });
  assert.deepEqual(nextSoakStep(recordAt(item, "generating")), { kind: "wait_storyboard" });
  assert.deepEqual(nextSoakStep(recordAt(item, "awaiting")), { kind: "approve_storyboard" });
  assert.deepEqual(nextSoakStep(recordAt(item, "approved")), { kind: "dispatch" });
  assert.deepEqual(nextSoakStep(recordAt(item, "rendering")), { kind: "wait_video" });
  assert.deepEqual(nextSoakStep(recordAt(item, "ready")), { kind: "done", outcome: { kind: "succeeded" } });

  /// 建故事板的请求发出去没拿到号：仍是 create（驱动先按键查库，再用同一个键重发），而且算在途
  const lost = recordAt(item, "pending");
  lost.current.storyboard.requestedAt = T0;
  assert.deepEqual(nextSoakStep(lost), { kind: "create_storyboard" });
  assert.equal(isSoakInFlight(lost), true);
  assert.equal(isSoakInFlight(recordAt(item, "pending")), false);
  assert.equal(soakIdempotencyKey("k", lost, "storyboard"), soakIdempotencyKey("k", recordAt(item, "pending"), "storyboard"));

  /// 派发请求发出去没拿到答复：同键重发；库里已经挂上 brief 的直接转去等成片
  const asked = recordAt(item, "approved");
  asked.current.dispatch.state = "requested";
  assert.deepEqual(nextSoakStep(asked), { kind: "dispatch" });
  asked.current.dispatch.briefId = "brief-x";
  assert.deepEqual(nextSoakStep(asked), { kind: "wait_video" });

  /// 库里还没同步到状态（刚建完）也只是等
  const unknown = recordAt(item, "generating");
  unknown.current.storyboard.status = null;
  assert.deepEqual(nextSoakStep(unknown), { kind: "wait_storyboard" });
});

test("终态判定：成片 READY 才算成功；段失败但还有段在跑（改交备用线路）不判死；取消与各阶段失败分开", async () => {
  const [item] = await loadItems();
  assert.equal(deriveSoakOutcome(blankSoakAttempt(0)), null);
  assert.deepEqual(deriveSoakOutcome(recordAt(item, "storyboard_failed").current), { kind: "failed", stage: "storyboard", reason: "第 3 帧提交确认未知" });
  assert.deepEqual(deriveSoakOutcome(recordAt(item, "video_failed").current), { kind: "failed", stage: "video", reason: "[provider:failed] refunded" });

  const rerouting = recordAt(item, "video_failed");
  rerouting.current.video.jobs = [
    job({ id: "old", status: "FAILED", superseded: true }),
    job({ id: "new", status: "RUNNING", route: "runway", finishedAt: null }),
  ];
  assert.equal(deriveSoakOutcome(rerouting.current), null, "改交 Runway 重拍中");

  const stitchFailed = recordAt(item, "rendering");
  Object.assign(stitchFailed.current.video, { finalVideoStatus: "FAILED", error: "ffmpeg exit 1" });
  assert.deepEqual(deriveSoakOutcome(stitchFailed.current), { kind: "failed", stage: "stitch", reason: "ffmpeg exit 1" });

  const rejected = recordAt(item, "approved");
  Object.assign(rejected.current.dispatch, { state: "rejected", code: "QUOTA_EXCEEDED", error: "本月额度已用尽" });
  assert.deepEqual(deriveSoakOutcome(rejected.current), { kind: "failed", stage: "dispatch", reason: "QUOTA_EXCEEDED：本月额度已用尽" });

  const refused = recordAt(item, "pending");
  Object.assign(refused.current.storyboard, { requestedAt: T0, error: "HTTP 400 VALIDATION_FAILED" });
  assert.equal(deriveSoakOutcome(refused.current)?.kind, "failed");

  const cancelled = recordAt(item, "rendering");
  cancelled.current.cancelledAt = at(3);
  assert.deepEqual(deriveSoakOutcome(cancelled.current), { kind: "cancelled" });
  assert.deepEqual(nextSoakStep(cancelled), { kind: "done", outcome: { kind: "cancelled" } });
  const raced = recordAt(item, "ready");
  raced.current.cancelledAt = at(20);
  assert.deepEqual(deriveSoakOutcome(raced.current), { kind: "succeeded" }, "取消晚于成片：片已经出了");
  const serverCancelled = recordAt(item, "generating");
  serverCancelled.current.storyboard.status = "CANCELLED";
  assert.deepEqual(deriveSoakOutcome(serverCancelled.current), { kind: "cancelled" });
});

test("重试：失败与已取消的换新一次尝试（换幂等键、旧的留档）；成功与在途的不碰", async () => {
  const [item] = await loadItems();
  const failed = recordAt(item, "video_failed");
  const oldKey = soakIdempotencyKey("soak-1110", failed, "storyboard");
  assert.equal(retrySoakRecord(failed), true);
  assert.equal(failed.current.attempt, 1);
  assert.equal(failed.history.length, 1);
  assert.equal(failed.history[0].video.briefStatus, "RENDER_FAILED");
  assert.notEqual(soakIdempotencyKey("soak-1110", failed, "storyboard"), oldKey);
  assert.deepEqual(nextSoakStep(failed), { kind: "create_storyboard" });
  assert.deepEqual(pendingSoakSpend(failed), { frames: 4, videos: 1 }, "重试要重新花一轮的钱");

  const cancelled = recordAt(item, "rendering");
  cancelled.current.cancelledAt = at(3);
  assert.equal(retrySoakRecord(cancelled), true);
  assert.equal(retrySoakRecord(recordAt(item, "ready")), false);
  assert.equal(retrySoakRecord(recordAt(item, "rendering")), false);
  assert.equal(retrySoakRecord(recordAt(item, "pending")), false);
});

test("投放节奏：整点小时内最多开 perHour 轮，再扣在途上限", () => {
  const now = new Date("2026-11-10T01:40:00.000Z");
  const base = { now, perHour: 8, maxInFlight: 6 };
  assert.equal(soakSubmitAllowance({ ...base, requestedAts: [], inFlight: 0 }), 6, "受在途上限约束");
  assert.equal(soakSubmitAllowance({ ...base, requestedAts: [], inFlight: 6 }), 0);
  const thisHour = Array.from({ length: 7 }, (_, index) => `2026-11-10T01:0${index}:00.000Z`);
  assert.equal(soakSubmitAllowance({ ...base, requestedAts: thisHour, inFlight: 0 }), 1);
  assert.equal(soakSubmitAllowance({ ...base, requestedAts: [...thisHour, "2026-11-10T01:30:00.000Z"], inFlight: 0 }), 0);
  assert.equal(soakSubmitAllowance({ ...base, requestedAts: ["2026-11-10T00:59:59.000Z", null], inFlight: 0 }), 6, "上一个小时发的不占这一小时的名额");
});

test("百分位与端到端：最近秩；没成片没有端到端时长", async () => {
  assert.equal(percentile([], 0.9), null);
  assert.equal(percentile([5], 0.9), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5), 5);
  assert.equal(percentile([10, 1, 9, 2, 8, 3, 7, 4, 6, 5], 0.9), 9);
  const [item] = await loadItems();
  assert.equal(soakEndToEndMs(recordAt(item, "ready", 14).current), 14 * 60_000);
  assert.equal(soakEndToEndMs(recordAt(item, "rendering").current), null);
});

test("放行线：四项全达标", async () => {
  const items = (await loadItems()).slice(0, 20);
  /// 20 条里 19 条成功（95%），成片用时 11–29 分钟
  const records = items.map((item, index) => (index === 0 ? recordAt(item, "video_failed") : recordAt(item, "ready", 10 + index)));
  const summary = summarizeSoak(records, { now: new Date(at(60)), firstPass: noScores({ firstPass: 17, total: 20, rated: 19 }) });
  assert.equal(summary.succeeded, 19);
  assert.equal(summary.failed, 1);
  assert.equal(summary.successRate, 0.95);
  assert.equal(summary.p50Ms, 20 * 60_000);
  assert.equal(summary.p90Ms, 28 * 60_000);
  assert.deepEqual(summary.gates.map((gate) => gate.verdict), ["达标", "达标", "达标", "达标"]);
  assert.deepEqual(summary.frameQa, { PASSED: 19, "(未写入)": 1 });
  assert.deepEqual(summary.failures, [{ id: items[0].id, stage: "video", reason: "[provider:failed] refunded" }]);
  const report = renderSoakReport("soak-1110", summary, new Date(at(60)));
  assert.match(report, /\| 成功率 \| ≥ 90\.0% \| 95\.0%（19 成 \/ 1 败） \| 达标 \|/u);
  assert.match(report, /\| 端到端 P90 \| ≤ 30 分 \| 28\.0 分（19 条成片） \| 达标 \|/u);
  assert.match(report, /\| 人工首过率 \| ≥ 80\.0% \| 85\.0%（17 \/ 20，已评 19 条） \| 达标 \|/u);
  assert.match(report, /没检不等于通过/u, "没写质检状态的段要提醒");
  assert.match(report, /放行线按全部条目算（A、B 两组合在一起）/u);
});

test("放行线：成功率、P90、UNVERIFIED、首过率逐项不达标", async () => {
  const items = (await loadItems()).slice(0, 10);
  /// 10 条里 2 条失败（80%），一条 45 分钟才出，一段质检没检成
  const records = items.map((item, index) =>
    index < 2 ? recordAt(item, index === 0 ? "storyboard_failed" : "video_failed") : recordAt(item, "ready", index === 9 ? 45 : 12),
  );
  records[5].current.video.jobs[0].frameQaStatus = "UNVERIFIED";
  records[6].current.video.jobs[0].frameQaStatus = "SKIPPED";
  const summary = summarizeSoak(records, { now: new Date(at(120)), firstPass: noScores({ firstPass: 6, total: 10, rated: 8 }) });
  assert.equal(summary.successRate, 0.8);
  assert.equal(summary.p90Ms, 45 * 60_000);
  assert.deepEqual(summary.gates.map((gate) => [gate.name, gate.verdict]), [
    ["成功率", "不达标"],
    ["端到端 P90", "不达标"],
    ["帧质检 UNVERIFIED", "不达标"],
    ["人工首过率", "不达标"],
  ]);
  assert.deepEqual(summary.frameQa, { PASSED: 6, UNVERIFIED: 1, SKIPPED: 1, "(未写入)": 1 });
  assert.deepEqual(summary.frames, { total: 40, failed: 1, cancelled: 0, ackUnknown: 1, failureRate: 1 / 40, byPlan: { "image-2k": 40 } });
  assert.match(renderSoakReport("soak-1110", summary, new Date(at(120))), /故事板出图走的套餐：image-2k 40 帧\n/u);
});

test("放行线：还有在途或没投的不抢着下结论；没有评分输入标「待人工评分」", async () => {
  const items = (await loadItems()).slice(0, 10);
  const records = items.map((item, index) => (index < 7 ? recordAt(item, "ready", 12) : index === 7 ? recordAt(item, "rendering") : recordAt(item, "pending")));
  const summary = summarizeSoak(records, { now: new Date(at(200)) });
  assert.equal(summary.inFlight, 1);
  assert.equal(summary.notStarted, 2);
  assert.equal(summary.longestInFlightMs, 200 * 60_000, "卡了 200 分钟的那条要看得见");
  assert.deepEqual(summary.gates.map((gate) => gate.verdict), ["待定", "待定", "待定", "待人工评分"]);
  assert.match(summary.gates[0].actual, /3 条未出结果/u);

  /// 剩下的全成功也到不了 90%：现在就能判不达标
  const doomed = items.map((item, index) => (index < 2 ? recordAt(item, "video_failed") : index < 9 ? recordAt(item, "ready", 12) : recordAt(item, "rendering")));
  assert.equal(summarizeSoak(doomed, { now: new Date(at(30)) }).gates[0].verdict, "不达标");
  /// 剩下的那条就算失败也有 19 / 20 = 95%：成功率现在就能判达标；P90 还要等它出结果
  const safe = (await loadItems()).slice(0, 20).map((item, index) => (index < 19 ? recordAt(item, "ready", 12) : recordAt(item, "rendering")));
  assert.deepEqual(summarizeSoak(safe, { now: new Date(at(30)) }).gates.slice(0, 2).map((gate) => gate.verdict), ["达标", "待定"]);

  /// 一条都没投
  const empty = summarizeSoak(items.map((item) => recordAt(item, "pending")), { now: new Date(at(0)) });
  assert.equal(empty.successRate, null);
  assert.deepEqual(empty.gates.map((gate) => gate.verdict), ["待定", "待定", "待定", "待人工评分"]);
});

test("汇总口径：取消的不进分母；重试救回来的不算首次成功；确认未知与改交线路单独数；按波与线路分组", async () => {
  const items = assignRunwayRoutes((await loadItems()).slice(0, 6), 2);
  const records = items.map((item) => recordAt(item, "ready", 12));
  /// 第 1 条：第一次失败、重试后成功 → 仍算失败
  const retried = recordAt(items[0], "video_failed");
  retrySoakRecord(retried);
  retried.current = recordAt(items[0], "ready", 12).current;
  records[0] = retried;
  /// 第 2 条：取消
  records[1] = recordAt(items[1], "rendering");
  records[1].current.cancelledAt = at(4);
  /// 第 3 条：视频提交确认未知
  records[2] = recordAt(items[2], "video_failed");
  records[2].current.video.jobs[0].submissionState = "ACK_UNKNOWN";
  /// 第 4 条：Shuyu 失败后改交 Runway 出片
  const rerouted = records.findIndex((record, index) => index > 2 && record.route === "buddy");
  records[rerouted].current.video.jobs = [job({ id: "old", status: "FAILED", superseded: true }), job({ id: "new", route: "runway" })];

  const summary = summarizeSoak(records, { now: new Date(at(60)) });
  assert.equal(summary.cancelled, 1);
  assert.equal(summary.retried, 1);
  assert.equal(summary.succeeded, 3);
  assert.equal(summary.failed, 2);
  assert.equal(summary.successRate, 0.6);
  assert.equal(summary.videoAckUnknown, 1);
  assert.equal(summary.rerouted, 1);
  assert.equal(summary.byWave.reduce((sum, group) => sum + group.started, 0), 6);
  assert.deepEqual(summary.byRoute.map((group) => [group.key, group.started]), [["buddy", 4], ["runway", 2]]);
  const report = renderSoakReport("soak-1110", summary, new Date(at(60)));
  assert.match(report, /1 条重试过；下面所有读数只看第一次尝试/u);
  assert.match(report, /视频提交确认未知：1 条/u);
  assert.match(report, /实际改交到别的线路：1 条/u);
  assert.match(report, /## 失败明细/u);
});

test("帧质检去留依据：结论分布、累计拦截次数、认领到成功的间隔（没撞上的如实标无法测量）、与人工评分对照", async () => {
  const items = (await loadItems()).slice(0, 6);
  const records = items.map((item, index) => (index === 5 ? recordAt(item, "video_failed") : recordAt(item, "ready", 12)));
  const qa = (index: number) => records[index].current.video.jobs[0];
  /// 第 1 段：轮询撞上了质检进行中，认领到任务成功隔了 30 秒
  qa(0).frameQaClaimedAt = at(11.5);
  /// 第 2 段：被拦过一次、重抽后放行；这一次的认领到成功隔了 60 秒
  Object.assign(qa(1), { frameQaBlockCount: 1, frameQaClaimedAt: at(11) });
  qa(2).frameQaStatus = "WOULD_BLOCK";
  qa(3).frameQaStatus = "UNVERIFIED";
  qa(4).frameQaStatus = "SKIPPED";
  /// 第 6 段：连拦两次、免费重抽用完，停在 BLOCKED
  Object.assign(qa(5), { frameQaStatus: "BLOCKED", frameQaBlockCount: 2 });

  const bare = summarizeSoak(records, { now: new Date(at(60)) }).frameQaEvidence;
  assert.equal(bare.jobs, 6);
  assert.deepEqual(bare.statuses, { PASSED: 2, BLOCKED: 1, WOULD_BLOCK: 1, UNVERIFIED: 1, SKIPPED: 1 });
  assert.equal(bare.blockCount, 3);
  assert.equal(bare.flaggedItems, 3, "拦过一次的、影子判拦的、停在 BLOCKED 的");
  assert.deepEqual(bare.overhead, { measured: 2, unmeasured: 4, p50Ms: 30_000, p90Ms: 60_000 });
  assert.equal(bare.human, null);
  const bareReport = renderSoakReport("soak-1110", summarizeSoak(records, { now: new Date(at(60)) }), new Date(at(60)));
  assert.match(bareReport, /## 帧质检去留依据/u);
  assert.match(bareReport, /PASSED 2，BLOCKED 1，WOULD_BLOCK 1，UNVERIFIED 1，SKIPPED 1/u);
  assert.match(bareReport, /累计拦截 3 次/u);
  assert.match(bareReport, /供应商出片到任务转成功的间隔无法测量/u);
  assert.match(bareReport, /测到 2 段，P50 30\.0 秒 \/ P90 60\.0 秒；另有 4 段没测到/u);
  assert.match(bareReport, /与人工评分的对照：待人工评分/u);
  assert.match(bareReport, /数字小结：6 段里放行 2 段、拦下 1 段、影子判拦 1 段、没检成 1 段、跳过 1 段，累计拦截 3 次；人工对照待人工评分。/u);

  /// 人工：前两条合格，影子判拦的与没检成的两条不合格，跳过的合格，停在 BLOCKED 的没有成片可评
  const scores = { [items[0].id]: "ok", [items[1].id]: "ok", [items[2].id]: "bad", [items[3].id]: "bad", [items[4].id]: "ok" } as const;
  const rated = summarizeSoak(records, { now: new Date(at(60)), firstPass: { firstPass: 3, total: 6, rated: 5, scores } });
  assert.deepEqual(rated.frameQaEvidence.human, {
    rated: 5,
    humanBad: 2,
    humanBadFlagged: 1,
    flaggedRated: 2,
    flaggedHumanBad: 1,
    table: [
      { status: "BLOCKED", ok: 0, bad: 0, unrated: 1 },
      { status: "PASSED", ok: 2, bad: 0, unrated: 0 },
      { status: "SKIPPED", ok: 1, bad: 0, unrated: 0 },
      { status: "UNVERIFIED", ok: 0, bad: 1, unrated: 0 },
      { status: "WOULD_BLOCK", ok: 0, bad: 1, unrated: 0 },
    ],
  });
  const ratedReport = renderSoakReport("soak-1110", rated, new Date(at(60)));
  assert.match(ratedReport, /\| WOULD_BLOCK \| 0 \| 1 \| 0 \|/u);
  assert.match(ratedReport, /人工判不合格 2 条，其中质检拦过 1 条；质检拦过的 3 条里人工评了 2 条，判不合格 1 条。/u);

  /// 一段都没撞上质检进行中：整项如实标无法测量，不估
  qa(0).frameQaClaimedAt = null;
  qa(1).frameQaClaimedAt = null;
  const blind = summarizeSoak(records, { now: new Date(at(60)) });
  assert.deepEqual(blind.frameQaEvidence.overhead, { measured: 0, unmeasured: 6, p50Ms: null, p90Ms: null });
  assert.match(renderSoakReport("soak-1110", blind, new Date(at(60))), /认领到任务转成功的间隔：无法测量（6 段有结论/u);
});

test("出方案对照：两组各自的成功率、P50 / P90、出方案阶段用时；两组都出片的才配成一对；盲评揭盲给 B 组的胜平负", async () => {
  const items = (await loadItems()).slice(0, 8);
  /// 4 对：A 组全成（12 分钟）；B 组 3 成（15 分钟）1 败
  const records = items.map((item, index) => (item.group === "A" ? recordAt(item, "ready", 12) : index === 7 ? recordAt(item, "video_failed") : recordAt(item, "ready", 15)));
  for (const record of records) {
    record.current.storyboard.createMs = record.group === "A" ? 50_000 : 2_000;
    record.current.dispatch.requestMs = record.group === "A" ? 60_000 : 58_000;
    record.current.dispatch.localPlanMs = record.group === "A" ? null : 300;
  }
  records[0].current.storyboard.degradedStages = ["shot_cards"];

  const pairs = soakBlindPairs(records);
  assert.deepEqual(pairs.map((pair) => pair.pairId), ["bottle-pain", "earbuds-pain", "serum-pain"], "B 组失败的那一对不进盲评");
  assert.deepEqual(pairs[0].videos, { A: "https://example.com/bottle-pain-a.mp4", B: "https://example.com/bottle-pain-b.mp4" });

  const layout = [
    { caseId: "bottle-pain", left: "B", right: "A" },
    { caseId: "earbuds-pain", left: "A", right: "B" },
  ];
  const tally = soakBlindTally(layout, { "bottle-pain": { overall: "left", hook: "right" }, "earbuds-pain": { overall: "tie" } }, " 小王 ");
  assert.equal(tally.reviewer, "小王");
  assert.equal(tally.pairsVoted, 2);
  assert.deepEqual(tally.rows.find((row) => row.id === "overall"), { id: "overall", label: "整体", win: 1, tie: 1, loss: 0 });
  assert.deepEqual(tally.rows.find((row) => row.id === "hook"), { id: "hook", label: "前 2 秒钩子", win: 0, tie: 0, loss: 1 });
  assert.equal(tally.rows.length, 7, "六项 + 整体");

  const ballots = [{ reviewer: " 小王 ", votes: { "bottle-pain": { overall: "left", hook: "right" }, "earbuds-pain": { overall: "tie" } } } as const];
  const summary = summarizeSoak(records, { now: new Date(at(60)), blind: { layout, ballots } });
  const [a, b] = summary.planComparison.groups;
  assert.deepEqual(
    [a.key, a.started, a.succeeded, a.failed, a.successRate, a.p50Ms, a.storyboardCreateP50Ms, a.dispatchRequestP50Ms, a.localPlanP50Ms, a.degradedStoryboards],
    ["A", 4, 4, 0, 1, 12 * 60_000, 50_000, 60_000, null, 1],
  );
  assert.deepEqual(
    [b.key, b.started, b.succeeded, b.failed, b.successRate, b.p50Ms, b.storyboardCreateP50Ms, b.dispatchRequestP50Ms, b.localPlanP50Ms, b.degradedStoryboards],
    ["B", 4, 3, 1, 0.75, 15 * 60_000, 2_000, 58_000, 300, 0],
  );
  assert.deepEqual([summary.planComparison.pairs, summary.planComparison.pairsReady], [4, 3]);
  const report = renderSoakReport("soak-1110", summary, new Date(at(60)));
  assert.match(report, /## 出方案对照/u);
  assert.match(report, /\| B 组（不调 OpenAI 出方案） \| 4 \| 3 \| 1 \| 0 \| 75\.0% \| 15\.0 分 \| 15\.0 分 \| 2\.0 秒 \| 58\.0 秒 \| 0\.3 秒 \| 0 \|/u);
  assert.match(report, /共 4 对，两组都出了成片、可以盲评的 3 对/u);
  /// 第一对的 A 组镜头卡超时退回了模板（上面记了 shot_cards 降级），单独成一层，不和纯文字写卡的三对混成一个数
  assert.deepEqual(
    summary.planComparison.strata.map((stratum) => [stratum.source, stratum.pairs, stratum.pairsReady, stratum.a.succeeded, stratum.b.succeeded]),
    [["text", 3, 2, 3, 2], ["fallback", 1, 1, 1, 1]],
  );
  assert.match(report, /\| 纯文字写卡 \| 3 \| 3 \/ 3 \| 12\.0 分 \| 2 \/ 3 \| 15\.0 分 \| 2 \| 小王：B 胜 0 \/ 平 1 \/ 负 0 \|/u);
  assert.match(report, /\| 卡没用上、退回模板节拍 \| 1 \| 1 \/ 1 \| 12\.0 分 \| 1 \/ 1 \| 15\.0 分 \| 1 \| 小王：B 胜 1 \/ 平 0 \/ 负 0 \|/u);
  assert.match(report, /盲评 · A 组镜头卡：纯文字写卡 · 评审 小王（评了 1 对）/u);
  assert.match(report, /没有给看图写卡开关的生效时刻（--vision-since）/u);
  assert.match(
    report,
    /数字小结：A 组成功率 100\.0%、P50 12\.0 分 \/ P90 12\.0 分；B 组成功率 75\.0%、P50 15\.0 分 \/ P90 15\.0 分；纯文字写卡 3 对的盲评整体（小王：B 胜 0 \/ 平 1 \/ 负 0）；卡没用上、退回模板节拍 1 对的盲评整体（小王：B 胜 1 \/ 平 0 \/ 负 0）。/u,
  );
  assert.match(renderSoakReport("soak-1110", summarizeSoak(records, { now: new Date(at(60)) }), new Date(at(60))), /盲评待评/u);
});

test("盲评页：左右按运行键随机、页面与文件名里不出现组别，票按「用例-角度」记", async () => {
  const pairIds = ["bottle-pain", "earbuds-pain", "serum-pain", "tintTrio-pain", "bottle-result", "earbuds-result"];
  const layout = blindLayout("soak-1110", pairIds, ["A", "B"]);
  assert.deepEqual(layout, blindLayout("soak-1110", pairIds, ["A", "B"]), "同一个运行键布局不变");
  assert.ok(layout.every((pair) => pair.left !== pair.right && ["A", "B"].includes(pair.left)));
  const html = renderBlindReviewPage({
    runKey: "soak-1110",
    sections: layout.map((pair, index) => ({
      id: pair.caseId,
      title: `${index + 1}. 保温杯 · 痛点开场`,
      notes: [{ label: "商家原话", text: "卖 <保温杯>" }],
      leftSrc: `review/${pair.caseId}-L.mp4`,
      rightSrc: `review/${pair.caseId}-R.mp4`,
    })),
  });
  assert.equal(html.match(/<section /gu)?.length, 6);
  assert.match(html, /name="bottle-pain-overall" value="left"/u);
  assert.match(html, /<video src="review\/tintTrio-pain-R\.mp4"/u);
  assert.match(html, /卖 &lt;保温杯&gt;/u, "说明文字要转义");
  assert.doesNotMatch(html, /A 组|B 组|OpenAI|-a\.mp4|-b\.mp4/u, "页面里看不出哪段是哪一组");
  assert.match(html, /"votes-" \+ "soak-1110" \+ "\.json"/u);
});

test("镜头卡写法分层：按建故事板的时刻与开关生效时刻的先后判，降级与合并调用另算；开关前后的波次不混成一个数", async () => {
  const items = (await loadItems()).slice(0, 8);
  const since = parseVisionSince("2026-11-10T02:00:00Z");
  assert.equal(since, "2026-11-10T02:00:00.000Z");
  assert.equal(parseVisionSince("2026-11-10T10:00:00+08:00"), "2026-11-10T02:00:00.000Z");
  assert.equal(parseVisionSince(null), null);
  assert.throws(() => parseVisionSince("2026-11-10 02:00"), /带时区的 ISO 时刻/u, "不带时区的时刻含糊，不收");
  assert.throws(() => parseVisionSince("soon"), /带时区的 ISO 时刻/u);

  /// 4 对都成片。第 1 对：合并看图调用出了结果；第 2 对：开关生效前建的；第 3、4 对：生效后建的（01:00 起 +90 分 = 02:30）
  const records = items.map((item) => recordAt(item, "ready", 12));
  records[0].current.storyboard.hasVisualReference = true;
  for (const record of records.slice(4)) record.current.storyboard.requestedAt = at(90);
  for (const record of records.slice(4)) record.current.video.finishedAt = at(102);
  const sourceOf = (index: number, visionSince: string | null) => shotCardSource(records[index].current, visionSince);
  assert.deepEqual([sourceOf(0, since), sourceOf(2, since), sourceOf(4, since), sourceOf(6, since)], ["direction", "text", "vision", "vision"]);
  assert.equal(sourceOf(4, null), "text", "没给生效时刻就不认作看图卡");
  /// 合并看图调用没存下盘点的那种（11-10 的 bottle-pain-a）：库里认不出，靠它关掉的部署时刻认
  const early = recordAt(items[2], "ready", 12);
  assert.equal(shotCardSource(early.current, since), "text");
  assert.equal(shotCardSource(early.current, since, at(10)), "direction", "在合并调用关掉之前建的");
  assert.equal(shotCardSource(early.current, since, at(0)), "text", "正好在关掉那一刻及之后建的不算");
  assert.throws(() => parseVisionSince("yesterday", "--direction-until"), /--direction-until 要给带时区的 ISO 时刻/u);
  assert.equal(shotCardSource(recordAt(items[0], "pending").current, since), null);
  const degraded = recordAt(items[4], "ready", 12);
  Object.assign(degraded.current.storyboard, { requestedAt: at(90), degradedStages: ["shot_cards"], hasVisualReference: true });
  assert.equal(shotCardSource(degraded.current, since), "fallback", "线上记了镜头卡降级 = 实际没有卡，优先于其它判断");

  const layout = [
    { caseId: "bottle-pain", left: "A", right: "B" },
    { caseId: "earbuds-pain", left: "A", right: "B" },
    { caseId: "serum-pain", left: "B", right: "A" },
    { caseId: "tintTrio-pain", left: "A", right: "B" },
  ];
  /// 这位评审每一对都选了左边
  const votes = Object.fromEntries(layout.map((pair) => [pair.caseId, { overall: "left" as const }]));
  const summary = summarizeSoak(records, { now: new Date(at(120)), visionSince: since, blind: { layout, ballots: [{ reviewer: "小李", votes }] } });
  assert.equal(summary.planComparison.visionSince, since);
  assert.deepEqual(
    summary.planComparison.strata.map((stratum) => [stratum.source, stratum.pairs, stratum.pairsReady, stratum.tallies.map((tally) => tally.rows.at(-1))]),
    [
      ["text", 1, 1, [{ id: "overall", label: "整体", win: 0, tie: 0, loss: 1 }]],
      ["vision", 2, 2, [{ id: "overall", label: "整体", win: 1, tie: 0, loss: 1 }]],
      ["direction", 1, 1, [{ id: "overall", label: "整体", win: 0, tie: 0, loss: 1 }]],
    ],
  );
  const report = renderSoakReport("soak-1110", summary, new Date(at(120)));
  assert.match(report, /\| 看图写卡（开关生效后建的） \| 2 \| 2 \/ 2 \| 12\.0 分 \| 2 \/ 2 \| 12\.0 分 \| 2 \| 小李：B 胜 1 \/ 平 0 \/ 负 1 \|/u);
  assert.match(report, /看图写卡开关的生效时刻按 2026-11-10T02:00:00\.000Z 算（人给的）/u);
  assert.match(report, /失败时线上会静默退回纯文字写卡、库里不留标记/u);
  assert.match(
    report,
    /纯文字写卡 1 对的盲评整体（小李：B 胜 0 \/ 平 0 \/ 负 1）；看图写卡（开关生效后建的） 2 对的盲评整体（小李：B 胜 1 \/ 平 0 \/ 负 1）；合并看图调用开着时建的 1 对的盲评整体（小李：B 胜 0 \/ 平 0 \/ 负 1）。/u,
  );

  /// 没给生效时刻：生效后建的两对会和纯文字写卡混在一层，报告要说明
  const unlabelled = summarizeSoak(records, { now: new Date(at(120)) });
  assert.deepEqual(unlabelled.planComparison.strata.map((stratum) => [stratum.source, stratum.pairs]), [["text", 3], ["direction", 1]]);
  assert.match(renderSoakReport("soak-1110", unlabelled, new Date(at(120))), /否则会和纯文字写卡混在一层/u);
});

test("镜头卡对照的重拍轮：只挑对照轮里纯文字卡、已成片的 A 组；两边都成片且这一轮确实建在开关生效之后才配对；揭盲数看图卡的胜平负", async () => {
  const items = (await loadItems()).slice(0, 12);
  const since = "2026-11-10T02:00:00.000Z";
  /// 对照轮（早波）6 对：第 1 对走了合并看图调用，第 2 对的卡退回了模板，第 3 对的 A 没成片，第 4–6 对正常
  const baseline = items.map((item) => recordAt(item, "ready", 12));
  baseline[0].current.storyboard.hasVisualReference = true;
  baseline[2].current.storyboard.degradedStages = ["shot_cards"];
  baseline[4] = recordAt(items[4], "video_failed");

  const picked = selectCardRerunItems(baseline, since, 4);
  assert.deepEqual(picked.map((item) => item.id), ["tintTrio-pain-a", `${items[8].pairId}-a`, `${items[10].pairId}-a`], "不够 4 对就有几对取几对");
  assert.ok(picked.every((item) => item.group === "A" && item.route === "buddy"));
  assert.deepEqual(selectCardRerunItems(baseline, since, 1).map((item) => item.pairId), ["tintTrio-pain"]);
  assert.throws(() => selectCardRerunItems(baseline.slice(0, 6), since, 0), /正整数/u);
  assert.throws(() => selectCardRerunItems(baseline.slice(0, 6), since, 4), /没法配对/u);
  /// 对照轮自己若是开关生效后建的，它的 A 组已经是看图卡，不能再当纯文字对照
  const lateBaseline = baseline.map((record) => ({ ...record, current: { ...record.current, storyboard: { ...record.current.storyboard, requestedAt: at(90) } } }));
  assert.throws(() => selectCardRerunItems(lateBaseline, since, 4), /没法配对/u);
  /// 对照轮里建在合并调用开着那段时间的条目也不能当纯文字对照
  assert.throws(() => selectCardRerunItems(baseline, since, 4, at(5)), /没法配对/u);

  /// 这一轮：第 1 条在开关生效后建、成片；第 2 条建早了；第 3 条的卡退回了模板
  const rerun = picked.map((item) => recordAt(item, "ready", 12));
  for (const record of rerun) {
    record.current.storyboard.requestedAt = at(90);
    record.current.video.finishedAt = at(104);
    record.current.video.finalVideoUrl = `https://example.com/rerun-${record.id}.mp4`;
  }
  rerun[1].current.storyboard.requestedAt = at(30);
  rerun[2].current.storyboard.degradedStages = ["shot_cards"];
  const pairs = soakCardPairs(baseline, rerun, since);
  assert.deepEqual(pairs.ready, [
    {
      pairId: "tintTrio-pain",
      caseId: "tintTrio",
      angleId: "pain",
      videos: { text: "https://example.com/tintTrio-pain-a.mp4", vision: "https://example.com/rerun-tintTrio-pain-a.mp4" },
    },
  ]);
  assert.deepEqual(pairs.excluded, [
    { pairId: items[8].pairId, reason: "这一轮建在看图写卡开关生效之前" },
    { pairId: items[10].pairId, reason: "这一轮的卡没用上、退回了模板节拍" },
  ]);
  assert.deepEqual(
    soakCardPairs(baseline, rerun, null).excluded.map((entry) => entry.reason).slice(0, 1),
    ["没给看图写卡的生效时刻（--vision-since），不能认定这一轮是看图卡"],
  );
  const inFlight = [recordAt(picked[0], "rendering")];
  inFlight[0].current.storyboard.requestedAt = at(90);
  assert.deepEqual(soakCardPairs(baseline, inFlight, since).excluded, [{ pairId: "tintTrio-pain", reason: "这一轮还没出结果" }]);

  /// 揭盲：左边是看图卡，评审整体选左、钩子选右
  const layout = [{ caseId: "tintTrio-pain", left: "vision", right: "text" }];
  const ballots = [{ reviewer: "小王", votes: { "tintTrio-pain": { overall: "left" as const, hook: "right" as const } } }];
  assert.deepEqual(soakBlindTally(layout, ballots[0].votes, "小王", "vision").rows.at(-1), { id: "overall", label: "整体", win: 1, tie: 0, loss: 0 });
  assert.deepEqual(soakBlindTally(layout, ballots[0].votes, "小王", "vision").rows[0], { id: "hook", label: "前 2 秒钩子", win: 0, tie: 0, loss: 1 });

  const summary = summarizeSoak(rerun, { now: new Date(at(120)), visionSince: since, baseline: { runKey: "soak-1110", records: baseline }, blind: { layout, ballots } });
  assert.deepEqual(
    [summary.cardComparison?.baselineRunKey, summary.cardComparison?.pairs, summary.cardComparison?.pairsReady, summary.cardComparison?.excluded.length],
    ["soak-1110", 3, 1, 2],
  );
  const report = renderSoakReport("soak-1110v", summary, new Date(at(120)));
  assert.match(report, /## 镜头卡对照（纯文字 对 看图）/u);
  assert.doesNotMatch(report, /## 出方案对照/u, "重拍轮没有 B 组，不出出方案对照");
  assert.match(report, /这一轮投了 3 对，两边都成片、可以盲评的 1 对/u);
  assert.match(report, /\| 整体 \| 1 \| 0 \| 0 \|/u);
  assert.match(report, /数字小结：1 对可比；盲评整体（小王：看图卡 胜 1 \/ 平 0 \/ 负 0）。/u);
  assert.equal(summarizeSoak(rerun, { now: new Date(at(120)) }).cardComparison, null, "不是重拍轮就没有这一节");
});

test("重拍轮开工前的拦截：没给看图写卡的生效时刻、或现在还早于它，都不许投", () => {
  const since = "2026-11-10T02:00:00.000Z";
  assert.match(cardRerunBlocker(null, new Date("2026-11-10T05:00:00Z")) ?? "", /必须给 --vision-since/u);
  assert.match(cardRerunBlocker(since, new Date("2026-11-10T01:59:59Z")) ?? "", /现在还早于 --vision-since（2026-11-10T02:00:00\.000Z）/u);
  assert.equal(cardRerunBlocker(since, new Date("2026-11-10T02:00:00Z")), null);
  assert.equal(cardRerunBlocker(since, new Date("2026-11-10T04:30:00Z")), null);
});
