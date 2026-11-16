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
  spokenLoad,
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
    genre: "lifestyle",
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
      logline: "A hand opens a zebra blind in a quiet living room and morning light sweeps in.",
      look: "Photorealistic handheld commercial, natural morning daylight, shallow depth of field.",
      voice: "a calm adult female voice speaking Mandarin, close-mic and unhurried",
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
          sound: 'The voice says "让早晨的光，按你的节奏进来。" over room tone.',
        },
      ],
      endState: "The blind is open with even light bands, the hand has left the frame, the room is bright.",
      throughout: ["the slat count and spacing stay exactly as in image 1"],
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
  /// Seedance 2.5 官方顺序：参考图对应 → 一句话梗概 → 时间线 → 全程成立的事
  const order = ["REFERENCES: image 1 = product shape", "Vertical 9:16, 15 seconds. A hand opens a zebra blind", "OPENING STATE:", "TIMELINE:", "AUDIO: Voice: a calm adult female voice", "END STATE:", "THROUGHOUT:"].map((part) => prompt.indexOf(part));
  assert.ok(order.every((position) => position >= 0), prompt);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "各段顺序固定");
  assert.match(prompt, /image 3 = the exact opening frame/);
  assert.match(prompt, /Shot 1 \(0-5s\): The hand pulls the chain/);
  assert.match(prompt, /Shot 2 \(5-15s\): .*Sound: The voice says "让早晨的光，按你的节奏进来。"/);
  assert.match(prompt, /Mix: the voice is clean and prominent/);
  assert.match(prompt, /THROUGHOUT: the slat count and spacing stay exactly as in image 1; No subtitles, no captions, no on-screen text\.$/);
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

test("脚本结构不合格在解析时就拒：缺必写项、没定片种、小数秒、时长越界、多余字段", () => {
  const base = job();
  const video = base.video as Record<string, unknown> & { shots: Array<Record<string, unknown>> };
  const { shots } = video;
  const noCamera: Record<string, unknown> = { ...shots[0] };
  delete noCamera.camera;
  assert.throws(() => parseDirectorJob({ ...base, video: { ...video, shots: [noCamera, shots[1]] } }));
  const { genre: _genre, ...noGenre } = base as Record<string, unknown>;
  void _genre;
  assert.throws(() => parseDirectorJob(noGenre));
  const { logline: _logline, ...noLogline } = video;
  void _logline;
  assert.throws(() => parseDirectorJob({ ...base, video: noLogline }));
  assert.throws(() => parseDirectorJob({ ...base, video: { ...video, shots: [{ ...shots[0], toSec: 4.5 }, { ...shots[1], fromSec: 4.5 }] } }));
  assert.throws(() => parseDirectorJob({ ...base, durationSec: 31 }));
  assert.throws(() => parseDirectorJob({ ...base, mood: "happy" }));
});

test("空间与光色：镜头 1 必写；后面的镜头不写就是沿用，提示词里不重复", () => {
  const base = job();
  const video = base.video as Record<string, unknown> & { shots: Array<Record<string, unknown>> };
  const bare = (shot: Record<string, unknown>) => {
    const copy = { ...shot };
    delete copy.space;
    delete copy.light;
    return copy;
  };
  const inherited = parsed({ video: { ...video, shots: [video.shots[0], bare(video.shots[1]!)] } });
  assert.deepEqual(lintDirectorJob(inherited).errors, []);
  const second = buildVideoPrompt(inherited).split("\n").find((line) => line.startsWith("Shot 2"))!;
  assert.doesNotMatch(second, /Space:|Light:/);
  assert.match(second, /Framing: .* Camera: .* Sound: /);
  const missing = parsed({ video: { ...video, shots: [bare(video.shots[0]!), video.shots[1]] } });
  assert.match(lintDirectorJob(missing).errors.join("\n"), /镜头 1 必须写 space 和 light/);
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

test("快销广告按节奏查：钩子 2 秒内、镜头够多够短、有配乐有口播；生活方式片不受这些约束", () => {
  const base = job();
  const video = base.video as Record<string, unknown> & { shots: Array<Record<string, unknown>> };
  /// 同一份慢节奏脚本标成快销：四条都要提醒
  const slow = lintDirectorJob(parsed({ genre: "fmcg" })).warnings.join("\n");
  assert.match(slow, /钩子要在 2 秒内/);
  assert.match(slow, /15 秒至少 5 个镜头（现在 2 个）/);
  assert.match(slow, /镜头 1 有 5 秒.*超过 4 秒就拖了/);
  assert.match(slow, /快销广告要写 music/);
  assert.equal(lintDirectorJob(parsed()).warnings.length, 0, "生活方式片照旧零提醒");

  /// 合格的快销节奏：2 + 2 + 3 + 3 + 3 + 2，钩子 2 秒，带配乐与口播
  /// 后面的镜头不重复写空间与光色，提示词才压得进紧凑目标
  const cut = (fromSec: number, toSec: number, sound: string) => {
    const shot: Record<string, unknown> = { ...video.shots[0], fromSec, toSec, sound };
    if (fromSec > 0) {
      delete shot.space;
      delete shot.light;
    }
    return shot;
  };
  const fast = parsed({
    genre: "fmcg",
    video: {
      ...video,
      music: "upbeat pop beat around 120 bpm with claps and plucked bass",
      shots: [
        cut(0, 2, 'The voice says "一拉就亮！"'),
        cut(2, 4, "A crisp click on the beat."),
        cut(4, 7, 'The voice says "柔光不刺眼。"'),
        cut(7, 10, "Fabric swish on the beat."),
        cut(10, 13, 'The voice says "白天夜晚随你调。"'),
        cut(13, 15, 'The voice says "现在下单。"'),
      ],
    },
  });
  assert.deepEqual(lintDirectorJob(fast), { errors: [], warnings: [] });
  assert.match(buildVideoPrompt(fast), /AUDIO: Voice: .*\. Music: upbeat pop beat around 120 bpm.*\. Mix: /);
});

test("口播念不念得完：中文约每秒 5 个字封顶、英文每秒 3 个词；有台词没写 voice 要提醒", () => {
  assert.deepEqual(spokenLoad('The voice says "一面细绒，一面羊羔绒。" softly'), { cjk: 9, words: 0 });
  assert.deepEqual(spokenLoad('He says "Six hours on the trail. Still hot."'), { cjk: 0, words: 7 });
  assert.deepEqual(spokenLoad("Room tone only."), { cjk: 0, words: 0 });
  const base = job();
  const video = base.video as Record<string, unknown> & { shots: Array<Record<string, unknown>> };
  const crammed = { ...video.shots[0], sound: 'The voice says "这条毯子一面是细绒一面是羊羔绒，冬天裹上特别暖和，现在下单还有优惠。"' };
  assert.match(lintDirectorJob(parsed({ video: { ...video, shots: [crammed, video.shots[1]] } })).warnings.join("\n"), /镜头 1 的台词 5 秒念不完（\d+ 个字）/);
  const { voice: _voice, ...noVoice } = video;
  void _voice;
  assert.match(lintDirectorJob(parsed({ video: noVoice })).warnings.join("\n"), /有台词但没写 voice/);
});

test("写法提醒：抽象形容词、只写「快」的运镜、否定句的全程要求、自己又写了一遍不要字幕、提示词太长", () => {
  const base = job();
  const video = base.video as Record<string, unknown> & { shots: Array<Record<string, unknown>> };
  const warnings = (overrides: Record<string, unknown>) => lintDirectorJob(parsed({ video: { ...video, ...overrides } })).warnings.join("\n");
  assert.match(warnings({ look: "A stunning cinematic premium commercial with natural daylight." }), /抽象形容词模型拍不出来（stunning, cinematic, premium）/);
  assert.match(warnings({ shots: [{ ...video.shots[0], camera: "Fast whip pan to the window." }, video.shots[1]] }), /镜头 1 的 camera 只写了「快」/);
  assert.doesNotMatch(warnings({ shots: [{ ...video.shots[0], camera: "Fast but controlled whip pan to the window." }, video.shots[1]] }), /只写了「快」/);
  assert.match(warnings({ throughout: ["never show a face"] }), /throughout 用正面描述写/);
  assert.doesNotMatch(warnings({ throughout: ["no background music, only room tone"] }), /正面描述/, "声音上的否定句模型听");
  assert.match(warnings({ throughout: ["no on-screen text or captions"] }), /不用写字幕 \/ 画面文字/);
  const long = "The hand pulls the chain down slowly and the slats rotate open while light spills across the wall, the sofa, the rug and the far corner of the room in even bands";
  const padded = Array.from({ length: 5 }, (_, index) => ({
    ...(index === 0 ? video.shots[0] : {}),
    fromSec: index * 3,
    toSec: index * 3 + 3,
    action: `${long} ${index}.`,
    framing: `${long}.`,
    camera: `${long}.`,
    sound: `${long}.`,
  }));
  assert.match(warnings({ shots: padded }), /写到 3600 字以内更稳/);
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
