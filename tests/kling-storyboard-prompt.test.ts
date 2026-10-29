import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  KLING_VIDEO_PROMPT_LIMIT,
  NEGATIVE_CONSTRAINTS_SEPARATOR,
  STORYBOARD_BEATS_LONG,
  STORYBOARD_BEATS_SHORT,
  STORYBOARD_GROUNDING_MARKER,
  groundSegmentPromptForOpeningFrame,
  storyboardOpeningFrameOrdinal,
  storyboardOpeningFrameUrl,
} from "../src/lib/video-generation/storyboard-beats";
import { RUNWAY_MODEL_LIMITS } from "../src/lib/providers/runway";
import { __test__ as promptIntelTest } from "../src/lib/video-generation/prompt-intelligence";
import { formatShotCardSequence, normalizeShotCards } from "../src/lib/video-generation/shot-cards";

/**
 * Runway Kling O3 的故事板视频提示词（2026-10-28 灰度真机）：Seedance 2.5 拦写实人脸参考图，故事板视频改走 Kling。
 * Kling 是图生视频（本段第一张关键帧作开场帧）、参考图没有序号语义、提示词上限 2500 字（Runway 请求校验实测）。
 */

const long = (n: number, unit = "x") => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
const DIALOGUE = `Spoken dialogue (voice only, exact wording, zh-CN, warm confident): "${long(300, "带它出门，")}"`;
/// 与 storyboard-grounded-video-prompt 测试同一份「最重」的模板：每条锁行都很长
const HEAVY = [
  `LOCATION: ${long(400)}`,
  `PRODUCT (must exactly match the reference images): ${long(400)}`,
  `LIGHTING: ${long(200)}`,
  `CHARACTER IDENTITY LOCK: ${long(200)}`,
  `SCENE GEOMETRY LOCK: ${long(200)}`,
  `PRODUCT SHAPE LOCK: ${long(200)}`,
  `LIP-SYNC LOCK: ${long(200)}`,
  `LIGHTING CONTINUITY LOCK: ${long(200)}`,
  `0-3s: ${long(300)}`,
  `Audio: generate native speech for the approved voice-only dialogue below, with subtle real room ambience. ${long(100)}`,
  DIALOGUE,
  "Do not render subtitles, captions, readable text, or a music bed.",
  `Style: ${long(300)}`,
].join("\n");

const wire = (prompt: string, negative: string | null) => (negative ? `${prompt}${NEGATIVE_CONSTRAINTS_SEPARATOR}${negative}` : prompt);

test("上限与 provider 同值；开场帧序号按「总时长 ÷ 帧数」切，与 grounding 的节奏一致", () => {
  assert.equal(KLING_VIDEO_PROMPT_LIMIT, RUNWAY_MODEL_LIMITS.klingO3_pro.promptMax);
  assert.equal(storyboardOpeningFrameOrdinal({ frameCount: 4, totalDurationSec: 15, fromSec: 0 }), 0);
  /// 30 秒 5 帧（每帧 6 秒）：第二段从 15 秒开始 → 第 3 帧开场
  assert.equal(storyboardOpeningFrameOrdinal({ frameCount: 5, totalDurationSec: 30, fromSec: 15 }), 2);
  assert.equal(storyboardOpeningFrameOrdinal({ frameCount: 5, totalDurationSec: 30, fromSec: 29 }), 4);
  const refs = ["p1", "p2", "cut", "f1", "f2", "f3", "f4"];
  const layout = { productPhotoCount: 2, anchorCount: 1, personCount: 0, frameCount: 4 };
  assert.equal(storyboardOpeningFrameUrl(refs, layout, { totalDurationSec: 15, fromSec: 0 }), "f1");
  assert.equal(storyboardOpeningFrameUrl(refs, null, { totalDurationSec: 15, fromSec: 0 }), null);
  assert.equal(storyboardOpeningFrameUrl(refs.slice(0, 3), layout, { totalDurationSec: 15, fromSec: 0 }), null, "越界不猜");
});

test("最重的模板 + 两种负面：发出去的总长 ≤ 2400（留 100 余量）；台词与必留行原样，锁行让位，不按序号点名参考图", () => {
  const llmNegative = "no mirrored signage, no duplicated storefront text, no extra windows, ".repeat(9).slice(0, 600);
  for (const negative of [promptIntelTest.DEFAULT_NEGATIVE_PROMPT, llmNegative]) {
    const out = groundSegmentPromptForOpeningFrame(HEAVY, {
      aspectRatio: "9:16", story: "很".repeat(4000), beats: STORYBOARD_BEATS_SHORT, productPhotoCount: 2,
      totalDurationSec: 15, fromSec: 0, toSec: 15, negativePrompt: negative,
      shotCards: STORYBOARD_BEATS_SHORT.map((_, index) => `Camera slowly pushes in on shot ${index + 1}. ${long(500, "detail ")}`),
    });
    assert.ok(wire(out, negative).length <= KLING_VIDEO_PROMPT_LIMIT - 100, `wire ${wire(out, negative).length}`);
    assert.ok(out.includes(DIALOGUE), "口播台词一个字不动");
    assert.match(out, /^Audio: generate native speech[^\n]*subtle ambient sound that fits the location/m);
    assert.match(out, /^Do not render subtitles/m);
    assert.match(out, /^PRODUCT \(must exactly match the reference images\): x/m);
    assert.match(out, /It opens exactly on the opening frame, which is storyboard keyframe 1\./);
    assert.match(out, /^STORY \(the merchant's own description[^\n]*很/m, "故事仍有内容，只是让位");
    assert.match(out, /^REFERENCE IMAGES: 2 real photos of the product \(match it exactly\); the other approved storyboard keyframes in story order/m);
    assert.doesNotMatch(out, /\bimages? \d/u, "Kling 的参考图没有序号语义，不写 image N");
    assert.ok(out.includes(STORYBOARD_GROUNDING_MARKER));
    /// 这份模板重到一张卡都放不下：整段退回旧格式（2026-10-29 起与 Shuyu 版同一原则）
    assert.match(out, /^0-\d+s · shot 1: storyboard keyframe 1 — /m);
    assert.match(out, /· shot 2 \(hard cut\): storyboard keyframe 2 — /);
    assert.doesNotMatch(out, /Each shot opens on its keyframe/);
  }
});

test("短模板：预算够时把质感行和锁行也带上；已改写过的提示词原样返回（重试不叠加）", () => {
  const light = [
    "PRODUCT: a navy NORDA tumbler with a silver lid; keep the printed NORDA wordmark and mountain mark exactly as in the reference photos.",
    "CHARACTER IDENTITY LOCK: same young man, same coat, every shot.",
    "Spoken dialogue (voice only, exact wording, zh-CN): \"装热饮，一上午都是热的。\"",
    "Do not render subtitles, captions, on-screen text, or a music bed.",
  ].join("\n");
  const input = {
    aspectRatio: "9:16", story: "NORDA 随行保温杯：清晨通勤，地铁站台拿出来喝一口热咖啡，到办公室放在桌上热气还在。", beats: STORYBOARD_BEATS_SHORT,
    productPhotoCount: 1, totalDurationSec: 15, fromSec: 0, toSec: 15, negativePrompt: promptIntelTest.DEFAULT_NEGATIVE_PROMPT,
  };
  const out = groundSegmentPromptForOpeningFrame(light, input);
  assert.match(out, /^LOOK: photoreal live-action/m);
  assert.match(out, /^CHARACTER IDENTITY LOCK: same young man/m);
  assert.match(out, /^REFERENCE IMAGES: a real photo of the product/m);
  assert.ok(out.includes(input.story), "预算够时故事完整保留");
  assert.equal(groundSegmentPromptForOpeningFrame(out, input), out);
});

test("30 秒第二段：从第 3 帧开场，只列本段的镜头", () => {
  const out = groundSegmentPromptForOpeningFrame("Spoken dialogue: \"第二段\"", {
    aspectRatio: "9:16", story: "第二段", beats: STORYBOARD_BEATS_LONG, productPhotoCount: 1,
    totalDurationSec: 30, fromSec: 15, toSec: 30,
  });
  assert.match(out, /15s, one continuous photorealistic story\. It opens exactly on the opening frame, which is storyboard keyframe 3\./);
  assert.doesNotMatch(out, /storyboard keyframe 1 —/);
  assert.match(out, /storyboard keyframe 5 — /);
});

test("派发接线：Kling 线路用开场帧版改写，首派与分段重提都把本段开场帧标 first_frame", async () => {
  const service = await readFile("src/lib/services/video-service.ts", "utf8");
  assert.match(service, /isKlingRunwayModel\(routeRead\.videoModelSnapshot\)\s*\? groundSegmentPromptForOpeningFrame\s*: groundSegmentPromptInStoryboard/);
  assert.match(service, /openingFrameUrl: segmentOpeningFrameUrl\(routeSnapshot\.videoModelSnapshot, brief\.directorPlan, plan, segment, referenceImageUrls\)/);
  assert.match(service, /const opening = segmentOpeningFrameUrl\(args\.model, args\.brief\.directorPlan, plan, segment, refs\);/);
  assert.equal((service.match(/role: url === (?:openingFrameUrl|opening) \? \("first_frame" as const\)/g) ?? []).length, 2);
});

/**
 * 2026-10-29 · 镜头导演 P0：卡模式下原话保底 200 字后先给镜头卡、再把剩的还给原话；卡按字段整段取舍，
 * 动作与尾态先于首态（开场关键帧已经画出首态）；画外音写一句 SPEECH 并去掉口型锁。
 */
test("P0（Kling）：保温杯样例——四镜都保住动作、不在字段中间截；原话完整；画外音一句 SPEECH、去掉口型锁；换地点标硬切", () => {
  const story = "我们卖 NORDA 不锈钢保温杯，500ml，杯身印着 NORDA 字样。想拍一个上班族早上通勤前把热咖啡倒进杯子，拧紧盖子塞进包里，到了办公室打开还冒热气。结尾说：到店或私信下单。";
  const cards = normalizeShotCards({ shots: [
    { startState: "woman in grey coat at the counter, pot in her right hand, open empty cup", action: "she pours hot coffee into the cup for two seconds", endState: "cup full and steaming, pot set down", location: "home kitchen", voice: "voice_over", lens: "35mm medium shot", camera: "chest height beside the counter, locked off", composition: "pot foreground, woman midground, morning window background", sound: "coffee pouring, kitchen room tone" },
    { action: "her right hand twists the lid shut in two turns", endState: "lid closed, right hand resting on it", location: "home kitchen", voice: "voice_over", lens: "85mm close-up", camera: "counter height, slow 10cm push-in", composition: "cup centered, NORDA print facing camera", sound: "lid thread clicks" },
    { startState: "closed cup on the office desk, her right hand on the lid", action: "she unscrews the lid and lifts it away", endState: "lid in her right hand, steam rising", location: "office desk", voice: "voice_over", lens: "50mm medium shot", camera: "eye level beside the desk, locked off", composition: "laptop foreground, cup midground, office background", sound: "lid unscrew, office ambience" },
    { action: "steam drifts up slowly", endState: "whole cup centered, NORDA print facing camera", location: "office desk", voice: "none", lens: "100mm macro", camera: "low angle on the desk, locked off", composition: "cup centered on the desk", sound: "quiet office tone" },
  ] }, 4)!;
  const template = [
    "PRODUCT (must exactly match the reference images): matte black stainless steel vacuum tumbler, 500ml, white NORDA wordmark printed on the body, twist lid.",
    "CHARACTER IDENTITY LOCK: every recurring person must keep the exact same face, age, hair, body proportions, outfit and accessories in every shot; do not swap, duplicate or restyle the cast.",
    "SCENE GEOMETRY LOCK: keep one physically coherent location with unchanged windows, furniture, room proportions, prop positions and light direction across every cut.",
    "LIP-SYNC LOCK: when dialogue is spoken, the speaker's lip movements must naturally match the words; the speaker's identity stays the same person throughout.",
    "Audio: generate native speech for the approved voice-only dialogue below, with subtle real room ambience.",
    'Spoken dialogue (voice only, exact wording, zh-CN, warm confident): "早上一杯热咖啡，倒进 NORDA，拧紧就走。到了公司打开，还是烫的。到店或私信下单。"',
    "Do not render subtitles, captions, on-screen text, or a music bed.",
  ].join("\n");
  const negative = promptIntelTest.DEFAULT_NEGATIVE_PROMPT;
  const out = groundSegmentPromptForOpeningFrame(template, {
    aspectRatio: "9:16", story, beats: STORYBOARD_BEATS_SHORT, productPhotoCount: 2,
    totalDurationSec: 15, fromSec: 0, toSec: 15, negativePrompt: negative, shotCards: formatShotCardSequence(cards),
  });
  assert.ok(wire(out, negative).length <= KLING_VIDEO_PROMPT_LIMIT - 100, `wire ${wire(out, negative).length}`);
  const shotLines = out.split("\n").filter((line) => / · shot \d/.test(line));
  assert.equal(shotLines.length, 4);
  for (const line of shotLines) {
    assert.match(line, /Action: [^.]+\./, line);
    assert.doesNotMatch(line, /…|Voice: /, `不在字段中间截、不逐镜写谁说话：${line}`);
  }
  assert.match(shotLines[0], /^0-4s · shot 1: from storyboard keyframe 1\. Action: she pours hot coffee into the cup for two seconds\. Ends on: cup full and steaming, pot set down\./);
  assert.match(shotLines[2], /^8-11s · shot 3 \(hard cut to a new location\): from storyboard keyframe 3\. New location: office desk\. Action: /);
  assert.ok(out.includes(story), "原话不到 200 字时完整保留");
  assert.match(out, /^SPEECH: one off-screen narrator only, and nobody on screen speaks or moves their lips; finish the whole line by 14s and never repeat it\.$/m);
  assert.doesNotMatch(out, /LIP-SYNC LOCK/);
  assert.match(out, /^Each shot opens on its keyframe and then moves; never hold a keyframe still\.$/m);
  assert.doesNotMatch(out, /\bimages? \d/u);

  const longStory = `${story}${"补充说明".repeat(200)}`;
  const tight = groundSegmentPromptForOpeningFrame(template, {
    aspectRatio: "9:16", story: longStory, beats: STORYBOARD_BEATS_SHORT, productPhotoCount: 2,
    totalDurationSec: 15, fromSec: 0, toSec: 15, negativePrompt: negative, shotCards: formatShotCardSequence(cards),
  });
  assert.ok(wire(tight, negative).length <= KLING_VIDEO_PROMPT_LIMIT - 100);
  const storyLine = tight.split("\n").find((line) => line.startsWith("STORY ("))!;
  assert.ok(storyLine.slice(storyLine.indexOf("): ") + 3).length >= 200, "长原话至少留 200 字");
  assert.equal(tight.split("\n").filter((line) => / · shot \d.*Action: /.test(line)).length, 4, "长原话不挤掉镜头卡的动作");
});
