import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFramePrompt,
  buildVideoPrompt,
  directorRequestKey,
  initialDirectorState,
  lintDirectorJob,
  meetsResolution,
  nextDirectorVideoStep,
  openAiFrameSize,
  parseDirectorJob,
  rankDirectorVideoPlans,
  selectedFrameVariant,
  videoReferenceOrder,
  DIRECTOR_VIDEO_PROMPT_MAX,
  type DirectorPriceEntry,
  type DirectorVideoAttempt,
} from "../scripts/lib/director-plan";

/**
 * 导演线路（2026-11-16）：Claude 写镜头脚本 → OpenAI gpt-image-2 出故事板 → Shuyu Seedance 出片。
 * 这里守纯逻辑：脚本校验、提示词拼装、套餐阶梯（默认 720P）、断点续跑不重复花钱。
 */

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "zebra-blind-01",
    title: "Zebra blind morning light",
    aspectRatio: "9:16",
    durationSec: 15,
    references: [
      { id: "product-front", source: "photos/front.jpg", role: "product shape, slat spacing and fabric texture; ignore its background", kind: "product" },
      { id: "product-detail", source: "https://example.com/detail.jpg", role: "bottom rail and chain detail only; ignore the hand holding it", kind: "product" },
    ],
    frames: [
      {
        id: "opening",
        prompt:
          "A sunlit living room window with the zebra blind fully lowered and its slats closed, soft morning light glowing through the fabric, a hand resting on the chain at the right edge, no face in frame.",
        references: ["product-front", "product-detail"],
        variants: 2,
      },
    ],
    video: {
      openingFrame: "opening",
      references: ["product-front", "product-detail"],
      look: "Photorealistic handheld commercial, natural morning daylight, shallow depth of field.",
      openingState: "The blind is lowered with slats closed; a hand rests on the chain, the room is dim and warm.",
      shots: [
        {
          fromSec: 0,
          toSec: 5,
          action: "The hand pulls the chain down slowly and the slats rotate open.",
          space: "Window fills the frame, sofa edge at lower left, hand enters from the right.",
          framing: "Medium shot, window centered, chain on the right third.",
          camera: "Locked off with a slight handheld breathing.",
          light: "Warm backlight through the fabric, soft shadows on the wall.",
          sound: "Quiet room tone, the soft click of the chain.",
        },
        {
          fromSec: 5,
          toSec: 15,
          action: "Light bands sweep across the room as the slats settle open.",
          space: "Same window, light stripes travel over the sofa and floor.",
          framing: "Slow reveal from the window to the lit room, product stays in the left half.",
          camera: "Slow pull back, ending still.",
          light: "Bright striped daylight, neutral white balance.",
          sound: 'A calm female voice says "让早晨的光，按你的节奏进来。" then silence.',
        },
      ],
      endState: "The blind is open with even light bands, the hand has left the frame, the room is bright.",
      constraints: ["keep the slat count and spacing exactly as in image 1", "no on-screen text"],
    },
    ...overrides,
  };
}

const parsed = (overrides: Record<string, unknown> = {}) => parseDirectorJob(job(overrides));

test("合格的脚本：零错误零提醒；提示词按固定顺序拼，参考图编号与提交顺序一致、开场帧在最后", () => {
  const good = parsed();
  assert.deepEqual(lintDirectorJob(good), { errors: [], warnings: [] });
  assert.deepEqual(
    videoReferenceOrder(good).map((reference) => [reference.id, reference.openingFrame]),
    [["product-front", false], ["product-detail", false], ["opening", true]],
  );
  const prompt = buildVideoPrompt(good);
  const order = ["FORMAT: Vertical 9:16, 15 seconds", "REFERENCES: image 1 = product shape", "OPENING STATE:", "TIMELINE:", "END STATE:", "CONSTRAINTS:"].map((part) => prompt.indexOf(part));
  assert.ok(order.every((position) => position >= 0), prompt);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "各段顺序固定");
  assert.match(prompt, /image 3 = the exact opening frame/);
  assert.match(prompt, /0-5s: The hand pulls the chain/);
  assert.match(prompt, /5-15s: .*Sound: A calm female voice says "让早晨的光，按你的节奏进来。"/);
  assert.ok(prompt.length < DIRECTOR_VIDEO_PROMPT_MAX);

  const frame = buildFramePrompt(good, good.frames[0]!);
  assert.match(frame, /REFERENCE ROLES: image 1 = product shape.*; image 2 = bottom rail/);
  assert.match(frame, /Vertical 9:16 photorealistic still frame/);
});

test("出图尺寸：各画幅都是精确比例且宽高能被 16 整除（gpt-image-2 的要求）", () => {
  for (const [ratio, expected] of [["9:16", 9 / 16], ["16:9", 16 / 9], ["1:1", 1]] as const) {
    const [width, height] = openAiFrameSize(ratio).split("x").map(Number) as [number, number];
    assert.equal(width % 16, 0);
    assert.equal(height % 16, 0);
    assert.ok(Math.abs(width / height - expected) < 1e-9, ratio);
  }
});

test("脚本结构不合格在解析时就拒：缺六项之一、时长越界、多余字段", () => {
  const base = job();
  const shots = (base.video as { shots: Array<Record<string, unknown>> }).shots;
  const noLight: Record<string, unknown> = { ...shots[0] };
  delete noLight.light;
  assert.throws(() => parseDirectorJob({ ...base, video: { ...(base.video as object), shots: [noLight, shots[1]] } }));
  assert.throws(() => parseDirectorJob({ ...base, durationSec: 31 }));
  assert.throws(() => parseDirectorJob({ ...base, mood: "happy" }));
});

test("检查拦下的错误：时间线没铺满 / 不相接、引用不存在的图、提示词里有中文、没有商品实拍", () => {
  const base = job();
  const video = base.video as Record<string, unknown> & { shots: Array<Record<string, unknown>> };
  const errors = (overrides: Record<string, unknown>) => lintDirectorJob(parsed(overrides)).errors.join("\n");

  assert.match(errors({ durationSec: 20 }), /镜头铺到 15 秒，时长是 20 秒/);
  assert.match(errors({ video: { ...video, shots: [video.shots[0], { ...video.shots[1], fromSec: 6 }] } }), /镜头 2 应从 5 秒开始/);
  assert.match(errors({ video: { ...video, openingFrame: "missing" } }), /开场帧 missing 不在 frames 里/);
  assert.match(errors({ video: { ...video, references: ["product-front", "ghost"] } }), /出片引用了不存在的参考图：ghost/);
  assert.match(
    errors({ video: { ...video, shots: [{ ...video.shots[0], action: "手慢慢拉下拉绳，百叶转开。" }, video.shots[1]] } }),
    /镜头 1 的 action 里有非英文内容/,
  );
  /// 台词在英文双引号里可以是商家原文，不算
  assert.equal(lintDirectorJob(parsed()).errors.length, 0);
  assert.match(
    errors({ references: (base.references as Array<Record<string, unknown>>).map((reference) => ({ ...reference, kind: "scene" })) }),
    /至少要有一张商品实拍图/,
  );
});

test("检查给的提醒：正脸风险（写明不露脸就不提醒）、一拍多个动作、首帧提前露出结果、镜头太短", () => {
  const base = job();
  const video = base.video as Record<string, unknown> & { shots: Array<Record<string, unknown>> };
  const frames = base.frames as Array<Record<string, unknown>>;
  const warnings = (overrides: Record<string, unknown>) => lintDirectorJob(parsed(overrides)).warnings.join("\n");

  const facePrompt = "A woman smiling at the camera in a sunlit living room, standing beside the lowered zebra blind, holding the chain.";
  assert.match(warnings({ frames: [{ ...frames[0], prompt: facePrompt }] }), /可能出现清晰正脸/);
  assert.doesNotMatch(warnings({}), /正脸/, "写了 no face in frame 的不提醒");
  assert.match(
    warnings({ video: { ...video, shots: [{ ...video.shots[0], action: "The hand pulls the chain and then opens the window." }, video.shots[1]] } }),
    /不止一个主动作/,
  );
  assert.match(warnings({ video: { ...video, openingState: "The blind is already open and the room is bright with light bands." } }), /提前露出了结果/);
  assert.match(
    warnings({ video: { ...video, shots: [{ ...video.shots[0], toSec: 1 }, { ...video.shots[1], fromSec: 1 }] } }),
    /镜头 1 只有 1 秒/,
  );
});

function price(overrides: Partial<DirectorPriceEntry> & { plan_id: string; display_name: string }): DirectorPriceEntry {
  return {
    kind: "video",
    model: "studio-video",
    unit: "second",
    resolution: "720P",
    sale_points: 144,
    capabilities: {
      aspect_ratios: ["9:16", "16:9", "1:1"],
      input_images_max: 30,
      modes: ["text2video", "image2video"],
      durations: Array.from({ length: 27 }, (_, index) => index + 4),
    },
    status: "available",
    ...overrides,
  };
}

/// 2026-11-16 实查的价目形态
const PRICES: DirectorPriceEntry[] = [
  price({ plan_id: "video-plan-113", display_name: "SY Seedance 2.5 特价 · 720P · 方案 113", unit: "generation", sale_points: 1500 }),
  price({ plan_id: "video-plan-87", display_name: "SY Seedance 2.5 VIP · 720P · 方案 87", sale_points: 144 }),
  price({ plan_id: "video-plan-91", display_name: "SY Seedance 2.5 VIP · 720P · 方案 91", sale_points: 160 }),
  price({ plan_id: "video-plan-88", display_name: "SY Seedance 2.5 VIP · 1080P · 方案 88", resolution: "1080P", sale_points: 420 }),
  price({ plan_id: "video-plan-92", display_name: "SY Seedance 2.5 VIP · 1080P · 方案 92", resolution: "1080P", sale_points: 520 }),
  price({ plan_id: "video-plan-86", display_name: "SY Seedance 2.5 VIP · 480P · 方案 86", resolution: "480P", sale_points: 90 }),
  price({ plan_id: "video-plan-84", display_name: "SY Seedance 2.0 VIP · 1080P · 方案 84", resolution: "1080P", sale_points: 160 }),
  price({ plan_id: "video-plan-85", display_name: "SY Seedance 2.0 VIP · 4K · 方案 85", resolution: "4K", sale_points: 520 }),
  price({ plan_id: "video-plan-70", display_name: "SY Kling 4.0 · 720P · 方案 70", sale_points: 52 }),
];

test("套餐阶梯默认 720P（11-16 定：1080P 太贵）：只取 Seedance 2.5 的 720P，按这条片的时长便宜的在前；不自动给 1080P、480P、别家模型", () => {
  const options = { durationSec: 15, aspectRatio: "9:16" as const, referenceCount: 3 };
  const ladder = rankDirectorVideoPlans(PRICES, options);
  assert.deepEqual(ladder.map((plan) => [plan.planId, plan.points]), [
    ["video-plan-113", 1500],
    ["video-plan-87", 2160],
    ["video-plan-91", 2400],
  ]);
  /// 短片按秒计价的反而便宜：5 秒 144×5 = 720 点 < 特价档的 1500
  assert.equal(rankDirectorVideoPlans(PRICES, { ...options, durationSec: 5 })[0]!.planId, "video-plan-87");
});

test("套餐阶梯：显式点名才用 1080P，之后可降到 720P；--no-step-down 等价于把底抬到起始档；4K 永远不取", () => {
  const options = { durationSec: 15, aspectRatio: "9:16" as const, referenceCount: 3 };
  const ladder = rankDirectorVideoPlans(PRICES, { ...options, maxResolution: "1080P" });
  assert.deepEqual(ladder.map((plan) => plan.planId), ["video-plan-88", "video-plan-92", "video-plan-113", "video-plan-87", "video-plan-91"]);
  assert.equal(ladder[0]!.points, 6300);
  assert.deepEqual(
    rankDirectorVideoPlans(PRICES, { ...options, maxResolution: "1080P", minResolution: "1080P" }).map((plan) => plan.planId),
    ["video-plan-88", "video-plan-92"],
  );
  assert.deepEqual(
    rankDirectorVideoPlans(PRICES, { ...options, maxResolution: "1080P", family: "seedance-2.0" }).map((plan) => plan.planId),
    ["video-plan-84"],
  );
  assert.deepEqual(rankDirectorVideoPlans(PRICES, { ...options, planId: "video-plan-91" }).map((plan) => plan.planId), ["video-plan-91"]);
});

test("套餐阶梯：收不下这么多参考图、不支持这个时长 / 画幅、已下架的档都不进", () => {
  const options = { durationSec: 15, aspectRatio: "9:16" as const, referenceCount: 3 };
  const only = (entry: DirectorPriceEntry) => rankDirectorVideoPlans([entry], options).length;
  const base = PRICES[1]!;
  assert.equal(only(base), 1);
  assert.equal(only({ ...base, capabilities: { ...base.capabilities, input_images_max: 2 } }), 0);
  assert.equal(only({ ...base, capabilities: { ...base.capabilities, durations: [4, 5, 6] } }), 0);
  assert.equal(only({ ...base, capabilities: { ...base.capabilities, aspect_ratios: ["16:9"] } }), 0);
  assert.equal(only({ ...base, capabilities: { ...base.capabilities, modes: ["text2video"] } }), 0);
  assert.equal(only({ ...base, status: "sold_out" }), 0);
});

test("成片分辨率要量过才算数：按短边判", () => {
  assert.equal(meetsResolution("720P", 720, 1280), true);
  assert.equal(meetsResolution("1080P", 720, 1280), false);
  assert.equal(meetsResolution("1080P", 1920, 1080), true);
  assert.equal(meetsResolution("720P", null, null), false);
});

function attempt(overrides: Partial<DirectorVideoAttempt>): DirectorVideoAttempt {
  return {
    attempt: 1,
    planId: "video-plan-113",
    displayName: "SY Seedance 2.5 特价 · 720P · 方案 113",
    resolution: "720P",
    points: 1500,
    requestKey: directorRequestKey("zebra-blind-01", 1),
    status: "submitting",
    ...overrides,
  };
}

test("断点续跑不重复花钱：有任务号的只续查；键落盘但确认未知的用同一个键重投；当场被拒的那一档不再试", () => {
  const state = initialDirectorState("zebra-blind-01");
  assert.deepEqual(nextDirectorVideoStep(state), { kind: "submit", attemptNumber: 1, triedPlanIds: [] });

  state.video.attempts.push(attempt({ status: "submitting" }));
  const resubmit = nextDirectorVideoStep(state);
  assert.equal(resubmit.kind, "resubmit");
  assert.equal(resubmit.kind === "resubmit" && resubmit.attempt.requestKey, directorRequestKey("zebra-blind-01", 1));

  state.video.attempts[0] = attempt({ status: "submitted", taskId: "task_1" });
  assert.equal(nextDirectorVideoStep(state).kind, "poll");
  state.video.attempts[0] = attempt({ status: "succeeded", taskId: "task_1", outputUrl: "https://example.com/a.mp4" });
  assert.equal(nextDirectorVideoStep(state).kind, "download");
  state.video.attempts[0] = attempt({ status: "succeeded", taskId: "task_1", outputUrl: "https://example.com/a.mp4", localFile: "a.mp4" });
  assert.equal(nextDirectorVideoStep(state).kind, "done");

  /// 当场被拒 → 下一次换档；受理后失败 → 可以再试同一档（由导演决定改不改脚本）
  state.video.attempts[0] = attempt({ status: "rejected" });
  assert.deepEqual(nextDirectorVideoStep(state), { kind: "submit", attemptNumber: 2, triedPlanIds: ["video-plan-113"] });
  state.video.attempts.push(attempt({ attempt: 2, planId: "video-plan-87", status: "failed", taskId: "task_2" }));
  assert.deepEqual(nextDirectorVideoStep(state), { kind: "submit", attemptNumber: 3, triedPlanIds: ["video-plan-113"] });
});

test("幂等键：同一任务同一次尝试永远同一个键，换一次尝试就换键，长度在 Shuyu 的 8–120 之内", () => {
  const key = directorRequestKey("zebra-blind-01", 1);
  assert.equal(key, directorRequestKey("zebra-blind-01", 1));
  assert.notEqual(key, directorRequestKey("zebra-blind-01", 2));
  assert.notEqual(key, directorRequestKey("zebra-blind-02", 1));
  assert.ok(key.length >= 8 && key.length <= 120);
});

test("开场帧定稿：只有一张成的直接用；多张必须导演挑过；挑的那张失败了不算", () => {
  const state = initialDirectorState("zebra-blind-01");
  assert.equal(selectedFrameVariant(state, "opening"), null);
  const done = (index: number) => ({ index, status: "done" as const, file: `frames/opening-v${index}.png`, createdAt: "2026-11-16T00:00:00.000Z" });
  state.frames.opening = { variants: [done(1)], selected: null };
  assert.equal(selectedFrameVariant(state, "opening")?.index, 1);
  state.frames.opening.variants.push(done(2));
  assert.equal(selectedFrameVariant(state, "opening"), null, "两张都成了，要先挑");
  state.frames.opening.selected = 2;
  assert.equal(selectedFrameVariant(state, "opening")?.index, 2);
  state.frames.opening.selected = 3;
  assert.equal(selectedFrameVariant(state, "opening"), null);
});
