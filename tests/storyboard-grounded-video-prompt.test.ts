import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  STORYBOARD_BEATS_LONG,
  STORYBOARD_BEATS_SHORT,
  STORYBOARD_GROUNDING_MARKER,
  groundSegmentPromptInStoryboard,
  storyboardBeatLabel,
} from "../src/lib/video-generation/storyboard-beats";
import { buildStoryboardFramePlans } from "../src/lib/video-generation/storyboard-service";

/**
 * 1025 真机验收：单条视频照通用 UGC 配方拍成了客厅口播，商家写的场景与已确认的故事板帧都没进提示词；
 * 故事板帧还画成了四宫格 / 五宫格拼图。锁住：派发时按故事板改写提示词；出帧提示词单镜头。
 */
const TEMPLATE = [
  "9:16 vertical UGC-style short video shot on a phone, 15s continuous story told in 5 quick cuts.",
  "LOCATION: real lived-in home environment, natural clutter, daylight from window",
  "LIGHTING: bright natural morning daylight through the window",
  "CHARACTER IDENTITY LOCK: keep the cast.",
  "PRODUCT SHAPE LOCK: keep the product.",
  "0-3s: tight close-up on the character's face showing frustration with Customers don't know if this product fits their daily life.",
  "Audio: generate native speech for the approved voice-only dialogue below, with subtle real room ambience.",
  'Spoken dialogue (voice only, exact wording, zh-CN, warm confident): "带它出门。"',
  "Do not render subtitles, captions, readable text, or a music bed.",
].join("\n");

const STORY = "一只金毛在公园奔跑，主人在手机上看项圈摄像头的第一视角画面。";

test("单段 15s：商家原话 + 四帧按时间与参考图序号重拍；模板的居家场景与模板镜头表被替换", () => {
  const out = groundSegmentPromptInStoryboard(TEMPLATE, {
    aspectRatio: "9:16", story: STORY, beats: STORYBOARD_BEATS_SHORT, productPhotoCount: 1, totalDurationSec: 15, fromSec: 0, toSec: 15,
  });
  assert.match(out, /一只金毛在公园奔跑/);
  assert.match(out, /image 1 is a real photo of the product/);
  assert.match(out, /^0-4s: recreate storyboard keyframe 1 \(reference image 2\) — immediate problem or desire hook\.$/m);
  assert.match(out, /^11-15s: recreate storyboard keyframe 4 \(reference image 5\)/m);
  assert.doesNotMatch(out, /LOCATION: real lived-in home|LIGHTING: bright natural morning|Customers don't know/);
  assert.match(out, /CHARACTER IDENTITY LOCK/);
  assert.match(out, /Spoken dialogue .*"带它出门。"/);
  assert.match(out, /ambient sound that fits the location/);
  // 幂等：已改写的不二次改写
  assert.equal(groundSegmentPromptInStoryboard(out, { aspectRatio: "9:16", story: STORY, beats: STORYBOARD_BEATS_SHORT, productPhotoCount: 1, totalDurationSec: 15, fromSec: 0, toSec: 15 }), out);
  assert.ok(out.includes(STORYBOARD_GROUNDING_MARKER));
});

test("30s 两段：每段只拿落在自己时间窗内的帧，时间相对段起点；无实拍时参考图从帧开始数", () => {
  const second = groundSegmentPromptInStoryboard(TEMPLATE, {
    aspectRatio: "16:9", story: STORY, beats: STORYBOARD_BEATS_LONG, productPhotoCount: 0, totalDurationSec: 30, fromSec: 15, toSec: 30,
  });
  assert.match(second, /images 1-5 are the approved storyboard keyframes/);
  assert.doesNotMatch(second, /keyframe 1 \(|keyframe 2 \(/);
  assert.match(second, /^0-3s: recreate storyboard keyframe 3 \(reference image 3\)/m);
  assert.match(second, /^9-15s: recreate storyboard keyframe 5 \(reference image 5\)/m);
});

test("超长商家描述被截到预算内，整段提示词不超供应商 5000 字上限", () => {
  const out = groundSegmentPromptInStoryboard(TEMPLATE, {
    aspectRatio: "9:16", story: "很长".repeat(2000), beats: STORYBOARD_BEATS_SHORT, productPhotoCount: 3, totalDurationSec: 15, fromSec: 0, toSec: 15,
  });
  assert.ok(out.length < 5000, `length ${out.length}`);
});

test("出帧提示词：先写这一帧、故事只作连续性背景、单镜头硬约束", () => {
  const [first] = buildStoryboardFramePlans({ prompt: STORY, durationSec: 15, aspectRatio: "9:16" });
  const lines = first.prompt.split("\n");
  assert.match(lines[0], /single continuous camera shot/);
  assert.match(lines[1], /^THIS FRAME 1\/4: /);
  assert.match(lines[2], /^STORY CONTEXT \(continuity only/);
  assert.match(first.prompt, /SINGLE SHOT LOCK: .*never a grid, panels, collage/);
});

test("界面上的节奏名按语言显示，未知的原样显示", () => {
  assert.equal(storyboardBeatLabel(STORYBOARD_BEATS_SHORT[0], false), "0–3 秒 · 开场钩子：痛点或期待");
  assert.equal(storyboardBeatLabel(STORYBOARD_BEATS_LONG[4], true), "Closing frame, with room for the call to action");
  assert.equal(storyboardBeatLabel("custom beat", false), "custom beat");
});

test("接线：派发前按故事板改写提示词并写回 directorPlan", async () => {
  const service = await readFile("src/lib/services/video-service.ts", "utf8");
  assert.match(service, /requireApprovedStoryboardVideoInputsForBrief\(briefId\)/);
  assert.match(service, /seedancePrompt: groundSegmentPromptInStoryboard\(segment\.seedancePrompt/);
  assert.match(service, /directorPlan: groundedPlan as unknown as Prisma\.InputJsonValue/);
});

/**
 * P02-C：bible 落进提示词的人物 / 产品行（CHARACTER ( / PRODUCT ( / PRODUCT: / NO on-camera person）
 * 在按故事板改写时必须保留——故事板帧只锚镜头，主播参考与产品描述的文字锚不能整行丢掉。
 * 口播链路依赖 `Audio:` 与 `Spoken dialogue` 行，同样必须原样保留。
 */
const BIBLE_TEMPLATE = [
  "9:16 vertical UGC-style short video shot on a phone, 15s continuous story told in 4 quick cuts.",
  "",
  "CHARACTER (must match the presenter reference photo — same face, hair, skin tone and build; keep 100% identical in every cut): The exact person in the presenter reference photo, oat-colored loungewear.",
  "LOCATION: real lived-in home environment, natural clutter, daylight from window",
  "PRODUCT (must exactly match the reference images): a navy linen roman shade with a white cord lock.",
  "LIGHTING: bright natural morning daylight through the window",
  "0-4s: tight close-up on the character's face.",
  "",
  "Audio: generate native speech for the approved voice-only dialogue below, with subtle real room ambience.",
  'Spoken dialogue (voice only, exact wording, zh-CN, warm confident): "带它出门。"',
  "Do not render subtitles, captions, readable text, or a music bed.",
  "Style: authentic handheld iPhone footage",
].join("\n");

test("P02-C：CHARACTER ( / PRODUCT ( 行在 grounding 后保留，LOCATION / LIGHTING / 镜头表仍被替换", () => {
  const out = groundSegmentPromptInStoryboard(BIBLE_TEMPLATE, {
    aspectRatio: "9:16", story: STORY, beats: STORYBOARD_BEATS_SHORT, productPhotoCount: 2, totalDurationSec: 15, fromSec: 0, toSec: 15,
  });
  assert.match(out, /^CHARACTER \(must match the presenter reference photo[^\n]*oat-colored loungewear\.$/m);
  assert.match(out, /^PRODUCT \(must exactly match the reference images\): a navy linen roman shade/m);
  assert.doesNotMatch(out, /^LOCATION: |^LIGHTING: |^0-4s: tight close-up|^Style: /m);
  // 保留行排在故事板镜头表之后
  assert.ok(out.indexOf(STORYBOARD_GROUNDING_MARKER) < out.indexOf("CHARACTER ("));
});

test("P02-C：PRODUCT: 与 NO on-camera person（纯产品模版）行也保留", () => {
  const productOnly = BIBLE_TEMPLATE
    .replace(/^CHARACTER \([^\n]*$/m, "NO on-camera person: the product is the only hero of every shot.")
    .replace(/^PRODUCT \([^\n]*$/m, "PRODUCT: a navy linen roman shade with a white cord lock.");
  const out = groundSegmentPromptInStoryboard(productOnly, {
    aspectRatio: "9:16", story: STORY, beats: STORYBOARD_BEATS_SHORT, productPhotoCount: 0, totalDurationSec: 15, fromSec: 0, toSec: 15,
  });
  assert.match(out, /^NO on-camera person: the product is the only hero of every shot\.$/m);
  assert.match(out, /^PRODUCT: a navy linen roman shade with a white cord lock\.$/m);
  assert.doesNotMatch(out, /PRODUCT IDENTITY LOCK/);
});

test("P02-C：Audio: 与 Spoken dialogue 开头的行在 grounding 后原样保留（口播链路依赖）", () => {
  const out = groundSegmentPromptInStoryboard(BIBLE_TEMPLATE, {
    aspectRatio: "9:16", story: STORY, beats: STORYBOARD_BEATS_SHORT, productPhotoCount: 2, totalDurationSec: 15, fromSec: 0, toSec: 15,
  });
  assert.match(out, /^Audio: generate native speech for the approved voice-only dialogue below, with subtle ambient sound that fits the location\.$/m);
  assert.match(out, /^Spoken dialogue \(voice only, exact wording, zh-CN, warm confident\): "带它出门。"$/m);
  assert.match(out, /^Do not render subtitles, captions, readable text, or a music bed\.$/m);
  // 幂等：二次改写不丢这些行
  const again = groundSegmentPromptInStoryboard(out, {
    aspectRatio: "9:16", story: STORY, beats: STORYBOARD_BEATS_SHORT, productPhotoCount: 2, totalDurationSec: 15, fromSec: 0, toSec: 15,
  });
  assert.equal(again, out);
});
