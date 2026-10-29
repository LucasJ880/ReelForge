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
    assert.match(out, /^0-\d+s · shot 1: storyboard keyframe 1 — /m);
    assert.match(out, /· shot 2 \(hard cut\): storyboard keyframe 2 — /);
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
