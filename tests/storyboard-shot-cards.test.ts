import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SHOT_CARD_LINE_PREFIX,
  SHOT_CARD_SYSTEM_PROMPT,
  buildShotCardUserPrompt,
  designStoryboardShotCards,
  formatShotCard,
  formatShotCardSequence,
  normalizeShotCards,
  readShotCardFromFramePrompt,
  storyboardShotCardsEnabled,
  type StoryboardShotCard,
} from "../src/lib/video-generation/shot-cards";
import {
  NEGATIVE_CONSTRAINTS_SEPARATOR,
  STORYBOARD_BEATS_LONG,
  STORYBOARD_BEATS_SHORT,
  groundSegmentPromptInStoryboard,
} from "../src/lib/video-generation/storyboard-beats";
import {
  STORYBOARD_NEW_LOCATION_CONTINUITY_LOCK,
  applyStoryboardReferenceRoles,
} from "../src/lib/video-generation/storyboard-frame-inputs";
import {
  buildRegeneratedStoryboardFramePrompt,
  buildStoryboardFramePlans,
} from "../src/lib/video-generation/storyboard-service";
import {
  batchReferenceManifestLine,
  withBatchReferenceManifest,
} from "../src/lib/video-generation/batch-reference-manifest";

/**
 * 2026-10-28 · 借鉴 LibTV 公开画布：镜头卡（焦段 / 机位与运镜幅度 / 前中后景 / 动作 / 结束状态 / 同步声）
 * 在建故事板时写进帧提示词，派发视频时读回接到镜头行；批量提交补「参考图说明」。
 * 没有卡时出帧与派发逐字节不变（旧行为由 storyboard-grounded-video-prompt / video-reference-layout 锁着）。
 */

const CARD: StoryboardShotCard = {
  lens: "24mm wide establishing shot",
  camera: "chest-high beside the sofa, locked off",
  composition: "family foreground; glare-covered TV midground; zebra blind background left",
  action: "one adult raises a hand 20cm to shield their eyes over two seconds",
  endState: "family squints at the washed-out TV screen",
  sound: "quiet room tone, faint TV audio",
};

const CARDS = STORYBOARD_BEATS_SHORT.map((_, index) => ({ ...CARD, lens: `${24 + index * 10}mm shot ${index + 1}` }));

test("normalize：恰好取 count 张；任何一张缺镜头 / 机位 / 动作整体作废；字段压成一行并截断", () => {
  const cards = normalizeShotCards({ shots: [...CARDS, CARD] }, 4);
  assert.equal(cards?.length, 4);
  assert.equal(normalizeShotCards({ shots: CARDS.slice(0, 3) }, 4), null);
  assert.equal(normalizeShotCards({ shots: [{ ...CARD, action: "" }, ...CARDS.slice(1)] }, 4), null);
  assert.equal(normalizeShotCards("nope", 4), null);
  const [long] = normalizeShotCards([{ ...CARD, composition: `a\n  b ${"x".repeat(400)}.` }], 1)!;
  assert.ok(long.composition.length <= 160);
  assert.match(long.composition, /^a b x+…$/);
});

test("format / read：一行英文（动作与尾态排在景别机位前）、可从帧提示词读回；没有卡 → null", () => {
  const text = formatShotCard(CARD);
  assert.equal(
    text,
    "Action: one adult raises a hand 20cm to shield their eyes over two seconds. Ends on: family squints at the washed-out TV screen. Shot: 24mm wide establishing shot. Camera: chest-high beside the sofa, locked off. Composition: family foreground; glare-covered TV midground; zebra blind background left. Sound: quiet room tone, faint TV audio.",
  );
  assert.equal(readShotCardFromFramePrompt(`line\n${SHOT_CARD_LINE_PREFIX}${text}\nmore`), text);
  assert.equal(readShotCardFromFramePrompt("no card here"), null);
  assert.equal(readShotCardFromFramePrompt(null), null);
});

test("design：关开关 / LLM 不可用 / 超时 / 抛错 / 输出不合格 → null；正常 → 卡，提示词带节奏时间窗与实拍张数", async () => {
  const input = { story: "午后客厅太刺眼，拉一下斑马帘就柔和了。", beats: STORYBOARD_BEATS_SHORT, durationSec: 15, aspectRatio: "9:16", productImageCount: 2, personImageCount: 0 };
  const ok = async () => ({ data: { shots: CARDS }, modelUsed: "m", tokenUsage: null, raw: "" });
  assert.equal(await designStoryboardShotCards(input, { enabled: false, llmAvailable: () => true, chat: ok as never }), null);
  assert.equal(await designStoryboardShotCards(input, { enabled: true, llmAvailable: () => false, chat: ok as never }), null);
  assert.equal(
    await designStoryboardShotCards(input, { enabled: true, llmAvailable: () => true, chat: (() => new Promise(() => undefined)) as never, timeoutMs: 10 }),
    null,
  );
  assert.equal(
    await designStoryboardShotCards(input, { enabled: true, llmAvailable: () => true, chat: (async () => { throw new Error("429"); }) as never }),
    null,
  );
  assert.equal(
    await designStoryboardShotCards(input, { enabled: true, llmAvailable: () => true, chat: (async () => ({ data: { shots: [] } })) as never }),
    null,
  );
  let seen: { stage?: string; tier?: string; user?: string } = {};
  const cards = await designStoryboardShotCards(input, {
    enabled: true,
    llmAvailable: () => true,
    chat: (async (options: { stage?: string; tier?: string; user?: string }) => {
      seen = options;
      return ok();
    }) as never,
  });
  assert.equal(cards?.length, 4);
  assert.equal(seen.tier, "fast");
  assert.equal(seen.stage, "storyboard_shot_cards");
  assert.match(seen.user!, /2 real photo\(s\) of the product/);
  assert.match(seen.user!, /^1\. 0-4s · immediate problem or desire hook$/m);
  assert.match(buildShotCardUserPrompt({ ...input, personImageCount: 1 }), /presenter photo was uploaded/);
  assert.equal(storyboardShotCardsEnabled({ STORYBOARD_SHOT_CARDS: "off" }), false);
  assert.equal(storyboardShotCardsEnabled({}), true);
});

test("出帧：有卡时帧按卡构图并落一行 SHOT CARD；重做沿用同一张卡；无卡与旧输出逐字节一致", () => {
  const story = "午后客厅太刺眼，拉一下斑马帘就柔和了。";
  const plain = buildStoryboardFramePlans({ prompt: story, durationSec: 15, aspectRatio: "9:16", productImageCount: 2 });
  const nulls = buildStoryboardFramePlans({ prompt: story, durationSec: 15, aspectRatio: "9:16", productImageCount: 2, shotCards: null });
  assert.deepEqual(nulls, plain);
  const carded = buildStoryboardFramePlans({ prompt: story, durationSec: 15, aspectRatio: "9:16", productImageCount: 2, shotCards: CARDS });
  for (const [index, plan] of carded.entries()) {
    const lines = plan.prompt.split("\n");
    assert.match(lines[1], /framed exactly as the shot card below at the moment its action begins\.$/);
    assert.equal(lines[2], `${SHOT_CARD_LINE_PREFIX}${formatShotCard(CARDS[index])}`);
    assert.match(plan.prompt, /SINGLE SHOT LOCK/);
    assert.ok(plan.prompt.length <= 5000);
    assert.equal(readShotCardFromFramePrompt(plan.prompt), formatShotCard(CARDS[index]));
  }
  const regenerated = buildRegeneratedStoryboardFramePrompt({
    story,
    durationSec: 15,
    aspectRatio: "9:16",
    ordinal: 2,
    beat: carded[2].beat,
    shotCard: readShotCardFromFramePrompt(carded[2].prompt),
    inputs: [],
  });
  assert.equal(readShotCardFromFramePrompt(regenerated), formatShotCard(CARDS[2]));
  assert.match(regenerated, /REGENERATION/);
});

const TEMPLATE = [
  "9:16 vertical UGC-style short video shot on a phone, 15s continuous story told in 5 quick cuts.",
  "LOCATION: real lived-in home environment",
  "PRODUCT SHAPE LOCK: keep the product.",
  "0-3s: tight close-up.",
  "Audio: generate native speech for the approved voice-only dialogue below, with subtle real room ambience.",
  'Spoken dialogue (voice only, exact wording, zh-CN, warm confident): "拉一下，客厅就柔和了。"',
  "Do not render subtitles, captions, readable text, or a music bed.",
].join("\n");

test("派发：有卡 → 镜头行带卡与硬切、加 LOOK / 产品不变量 / 旁白时间窗；无卡 → 与旧格式一致", () => {
  const base = { aspectRatio: "9:16", story: "午后客厅太刺眼，拉一下斑马帘就柔和了。", beats: STORYBOARD_BEATS_SHORT, productPhotoCount: 2, totalDurationSec: 15, fromSec: 0, toSec: 15 };
  const plain = groundSegmentPromptInStoryboard(TEMPLATE, base);
  assert.equal(groundSegmentPromptInStoryboard(TEMPLATE, { ...base, shotCards: [null, null, null, null] }), plain);
  assert.doesNotMatch(plain, /LOOK:|PRODUCT INVARIANTS|SPEECH TIMING|shot 1/);

  const texts = formatShotCardSequence(CARDS);
  const out = groundSegmentPromptInStoryboard(TEMPLATE, { ...base, shotCards: texts });
  assert.match(out, /^0-4s · shot 1: from storyboard keyframe 1 \(reference image 3\)\. Action: one adult raises a hand .* Shot: 24mm shot 1\. Camera: /m);
  assert.match(out, /^4-8s · shot 2 \(hard cut\): from storyboard keyframe 2 \(reference image 4\)\. /m);
  assert.match(out, /^Each shot opens on its keyframe and then moves; never hold a keyframe still\.$/m);
  assert.doesNotMatch(out, /recreate storyboard keyframe|— immediate problem or desire hook/, "卡模式不再「复刻关键帧」、不写通用节奏句");
  assert.match(out, /^LOOK: photoreal live-action commercial footage/m);
  assert.match(out, /^PRODUCT INVARIANTS: .* of images 1-2;/m);
  assert.match(out, /^SPEECH TIMING: one narrator only; .* by 14s;/m);
  assert.match(out, /Spoken dialogue .*"拉一下，客厅就柔和了。"/);
  assert.match(out, /^PRODUCT SHAPE LOCK/m);

  const textOnly = groundSegmentPromptInStoryboard(TEMPLATE.replace(/^Spoken dialogue.*$/m, ""), { ...base, productPhotoCount: 0, shotCards: texts });
  assert.doesNotMatch(textOnly, /PRODUCT INVARIANTS|SPEECH TIMING/);
  assert.match(textOnly, /^LOOK:/m);
});

test("派发预算：超长故事 + 超长卡 + 长负面词，整段仍在 5000 字内；故事保底、卡被均匀压短而不是整段丢", () => {
  const longCards = CARDS.map((card) => formatShotCard({ ...card, composition: "y".repeat(150), action: "z".repeat(150), endState: "w".repeat(150) }));
  const negativePrompt = "n".repeat(600);
  const out = groundSegmentPromptInStoryboard(TEMPLATE, {
    aspectRatio: "9:16",
    story: "很长".repeat(2000),
    beats: STORYBOARD_BEATS_SHORT,
    productPhotoCount: 3,
    totalDurationSec: 15,
    fromSec: 0,
    toSec: 15,
    negativePrompt,
    shotCards: longCards,
  });
  assert.ok(out.length + NEGATIVE_CONSTRAINTS_SEPARATOR.length + negativePrompt.length <= 4900, `length ${out.length}`);
  assert.match(out, /STORY \(the merchant's own description[^\n]*很长很长/);
  assert.equal((out.match(/· shot \d[^\n]*Camera: /g) ?? []).length, 4);
});

test("批量参考图说明：按真正发出去的张数编号，与模板 input_images[n] 同一记法；超预算原样返回；幂等", () => {
  assert.equal(
    batchReferenceManifestLine({ productPhotoCount: 2, frameCount: 4 }),
    "REFERENCE IMAGES: input_images[1]-input_images[2] are real photos of the product — the only source of truth for its shape, proportions, colors, controls and printed marks; match it exactly. input_images[3]-input_images[6] are the approved storyboard keyframes in story order — follow their location, people, wardrobe, light and framing; where a keyframe and the product photos disagree about the product, the product photos win.",
  );
  assert.match(batchReferenceManifestLine({ productPhotoCount: 1, frameCount: 0 })!, /^REFERENCE IMAGES: input_images\[1\] is a real photo/);
  assert.match(batchReferenceManifestLine({ productPhotoCount: 0, frameCount: 1 })!, /input_images\[1\] is the approved storyboard keyframe — follow .*framing\.$/);
  assert.equal(batchReferenceManifestLine({ productPhotoCount: 0, frameCount: 0 }), null);

  const prompt = "Opening line.\nUse input_images[1], input_images[2] as the product truth.";
  const out = withBatchReferenceManifest(prompt, { productPhotoCount: 2, frameCount: 4 });
  assert.equal(out.split("\n")[0], "Opening line.");
  assert.match(out.split("\n")[1], /^REFERENCE IMAGES: /);
  assert.equal(withBatchReferenceManifest(out, { productPhotoCount: 2, frameCount: 4 }), out);
  const huge = `Opening.\n${"p".repeat(4300)}`;
  assert.equal(withBatchReferenceManifest(huge, { productPhotoCount: 2, frameCount: 4, negativePrompt: "n".repeat(300) }), huge);
});

test("派发预算：连一张卡都放不下时整段退回旧格式（不留只加 LOOK / 不变量行、没有卡的半成品）", () => {
  const base = {
    aspectRatio: "9:16",
    story: "午后客厅太刺眼，拉一下斑马帘就柔和了。",
    beats: STORYBOARD_BEATS_SHORT,
    productPhotoCount: 2,
    totalDurationSec: 15,
    fromSec: 0,
    toSec: 15,
    negativePrompt: "n".repeat(3900),
  };
  const plain = groundSegmentPromptInStoryboard(TEMPLATE, base);
  const carded = groundSegmentPromptInStoryboard(TEMPLATE, { ...base, shotCards: formatShotCardSequence(CARDS) });
  assert.equal(carded, plain);
  assert.doesNotMatch(carded, /LOOK:|PRODUCT INVARIANTS/);
});

/**
 * 2026-10-29 · 镜头导演 P0（借鉴朋友的 ai-video-workflow 方法包；计划 docs/superpowers/plans/2026-10-29-shot-direction-p0.md）：
 * 镜头卡加首态 / 地点 / 谁说话；拆掉互相打架的锁；参考图写清只取什么；口播稿交给镜头卡设计。
 */
const DIRECTED = [
  {
    startState: "woman at the counter, pot in her right hand, open empty cup",
    action: "she pours hot coffee into the cup",
    endState: "cup full and steaming, pot set down",
    location: "Home kitchen",
    voice: "voice_over",
    lens: "35mm medium shot",
    camera: "chest height, locked off",
    composition: "pot foreground, woman midground",
    sound: "coffee pouring",
  },
  { action: "her right hand twists the lid shut", endState: "lid closed, hand resting on it", location: "the home kitchen", voice: "voice-over", lens: "85mm close-up", camera: "counter height, slow 10cm push-in", composition: "cup centered", sound: "lid clicks" },
  { action: "she unscrews the lid", endState: "lid in her right hand, steam rising", location: "office desk", voice: "off-screen", lens: "50mm medium shot", camera: "eye level, locked off", composition: "laptop foreground", sound: "office tone" },
  { action: "steam drifts up", endState: "whole cup centered", location: "Office desk", voice: "none", lens: "100mm macro", camera: "low angle, locked off", composition: "cup centered", sound: "quiet office" },
];

const LOCKED_TEMPLATE = [
  "CHARACTER IDENTITY LOCK: keep the cast.",
  "SCENE GEOMETRY LOCK: keep one physically coherent location with unchanged windows.",
  "PRODUCT SHAPE LOCK: keep the product.",
  "LIP-SYNC LOCK: lips match the words.",
  "Audio: generate native speech for the approved voice-only dialogue below, with subtle real room ambience.",
  'Spoken dialogue (voice only, exact wording, zh-CN, warm confident): "早上一杯热咖啡。"',
  "Do not render subtitles, captions, on-screen text, or a music bed.",
].join("\n");

test("P0 normalize：首态 / 地点 / 谁说话；没写首态且没换地点就接上一张的尾态，换地点不接；旧的六字段卡照常通过", () => {
  const cards = normalizeShotCards({ shots: DIRECTED }, 4)!;
  assert.equal(cards[0].startState, DIRECTED[0].startState);
  assert.equal(cards[1].startState, "cup full and steaming, pot set down", "同一厨房（大小写、the 不算换地点）→ 接上一张尾态");
  assert.equal(cards[2].startState, "", "换到办公室不补首态");
  assert.equal(cards[3].startState, "lid in her right hand, steam rising");
  assert.deepEqual(cards.map((card) => card.voice), ["voice_over", "voice_over", "voice_over", "none"]);
  const [odd] = normalizeShotCards({ shots: [{ ...DIRECTED[0], voice: "loudly", location: "back room. v2" }] }, 1)!;
  assert.equal(odd.voice, null);
  assert.equal(odd.location, "back room v2", "地点名里的句点去掉，免得搅乱按句读卡");
  const [legacy] = normalizeShotCards({ shots: [CARD] }, 1)!;
  assert.equal(legacy.startState, "");
  assert.equal(legacy.voice, null);
});

test("P0 format：首态 → 动作 → 尾态 → 谁说话 → 景别 / 机位 / 构图 / 声音；地点和上一张不同的卡（第一张除外）以 New location 开头", () => {
  const cards = normalizeShotCards({ shots: DIRECTED }, 4)!;
  const texts = formatShotCardSequence(cards);
  assert.equal(
    texts[0],
    "Starts on: woman at the counter, pot in her right hand, open empty cup. Action: she pours hot coffee into the cup. Ends on: cup full and steaming, pot set down. Voice: off-screen narrator only. Shot: 35mm medium shot. Camera: chest height, locked off. Composition: pot foreground, woman midground. Sound: coffee pouring.",
  );
  assert.doesNotMatch(texts[1]!, /New location/);
  assert.match(texts[2]!, /^New location: office desk\. Action: she unscrews the lid\./);
  assert.doesNotMatch(texts[3]!, /New location/);
  assert.match(texts[3]!, /Voice: no narration in this shot\./);
  assert.deepEqual(formatShotCardSequence([null, cards[1]]), [null, formatShotCard(cards[1])]);
});

test("P0 design：口播稿进镜头卡的用户提示词（按台词顺序排镜头）；没有口播稿就让 voice 全写 none；系统提示词要首态 / 地点 / 谁说话", () => {
  const base = { story: "午后客厅太刺眼，拉一下斑马帘就柔和了。", beats: STORYBOARD_BEATS_SHORT, durationSec: 15, aspectRatio: "9:16", productImageCount: 2, personImageCount: 0 };
  assert.match(
    buildShotCardUserPrompt({ ...base, voiceoverScript: "  拉一下，\n客厅就柔和了。 " }),
    /^Voice-over script \(one voice, spoken across the whole video in this order; never rewrite it\): 拉一下， 客厅就柔和了。$/m,
  );
  assert.match(buildShotCardUserPrompt(base), /^No voice-over script: set every "voice" to "none"\.$/m);
  assert.match(SHOT_CARD_SYSTEM_PROMPT, /"startState":"","action":"","endState":"","location":"","voice":""/);
  assert.match(SHOT_CARD_SYSTEM_PROMPT, /Never name feelings/);
});

test("P0 出帧：换地点那一帧换用「换地点版」连续性锁，前帧只管人、衣着与光线；提交时重排入参、重做都沿用", () => {
  const cards = normalizeShotCards({ shots: DIRECTED }, 4)!;
  const plans = buildStoryboardFramePlans({ prompt: "通勤保温杯", durationSec: 15, aspectRatio: "9:16", productImageCount: 2, shotCards: cards });
  const [, kitchen, office, desk] = plans.map((plan) => plan.prompt);
  assert.ok(office.includes(STORYBOARD_NEW_LOCATION_CONTINUITY_LOCK));
  assert.doesNotMatch(office, /CONTINUITY LOCK: keep the same room/);
  assert.match(office, /image 3 = previous storyboard keyframe — same person, wardrobe and light only; this frame is a new location, not its room/);
  for (const prompt of [kitchen, desk]) {
    assert.match(prompt, /CONTINUITY LOCK: keep the same room/);
    assert.match(prompt, /previous approved storyboard keyframe — continuity only \(same room/);
  }
  const inputs = [
    { url: "p1", role: "product" as const },
    { url: "f2", role: "prior_frame" as const },
  ];
  assert.match(applyStoryboardReferenceRoles(office, inputs), /image 2 = previous storyboard keyframe — same person, wardrobe and light only/);
  const regenerated = buildRegeneratedStoryboardFramePrompt({
    story: "通勤保温杯",
    durationSec: 15,
    aspectRatio: "9:16",
    ordinal: 2,
    beat: plans[2].beat,
    shotCard: readShotCardFromFramePrompt(office),
    inputs,
  });
  assert.ok(regenerated.includes(STORYBOARD_NEW_LOCATION_CONTINUITY_LOCK));
  assert.match(regenerated, /image 2 = previous storyboard keyframe — same person, wardrobe and light only/);
});

test("P0 派发（Shuyu）：画外音段去掉口型锁并写明没人开口；段内换地点时场景锁只管同一地点、镜头标硬切到新地点；参考图写清只取什么", () => {
  const texts = formatShotCardSequence(normalizeShotCards({ shots: DIRECTED }, 4)!);
  const base = { aspectRatio: "9:16", story: "通勤保温杯", beats: STORYBOARD_BEATS_SHORT, productPhotoCount: 2, totalDurationSec: 15, fromSec: 0, toSec: 15 };
  const out = groundSegmentPromptInStoryboard(LOCKED_TEMPLATE, { ...base, shotCards: texts });
  assert.doesNotMatch(out, /LIP-SYNC LOCK/);
  assert.match(out, /^SPEECH TIMING: one off-screen narrator only, and nobody on screen speaks or moves their lips; .* by 14s;/m);
  assert.match(out, /^SCENE GEOMETRY LOCK: within each location keep/m);
  assert.doesNotMatch(out, /keep one physically coherent location/);
  assert.match(out, /^8-11s · shot 3 \(hard cut to a new location\): from storyboard keyframe 3 \(reference image 5\)\. New location: office desk\. Action: /m);
  assert.doesNotMatch(out, /Voice: /, "谁说话不逐镜写，段里一句写清");
  assert.match(out, /images 1-2 are real photos of the product — copy only the product itself \(shape, colors, printed marks\), not their background, surface, hands, props, price tags or watermarks\./);
  assert.match(out, /each is the first moment of its shot: match its people, location, wardrobe, light and framing, then play the action forward from it\./);
  assert.match(out, /^CHARACTER IDENTITY LOCK/m);

  const kitchenOnly = groundSegmentPromptInStoryboard(LOCKED_TEMPLATE, { ...base, shotCards: [texts[0], texts[1], null, null] });
  assert.match(kitchenOnly, /^SCENE GEOMETRY LOCK: keep one physically coherent location/m, "不换地点的段场景锁原样");

  const onCamera = normalizeShotCards({ shots: DIRECTED.map((card, index) => ({ ...card, voice: index === 0 ? "on_camera" : "voice_over" })) }, 4)!;
  const presenter = groundSegmentPromptInStoryboard(LOCKED_TEMPLATE, { ...base, personCount: 1, shotCards: formatShotCardSequence(onCamera) });
  assert.match(presenter, /^LIP-SYNC LOCK/m);
  assert.match(presenter, /SPEECH TIMING: one voice only: the presenter speaks on camera in shot 1 and the same voice continues off screen in the other shots;/);
  assert.match(presenter, /Image 3 is the presenter reference photo — the on-camera person must be this exact person \(same face, hair, skin tone and build\); wardrobe and setting follow the keyframes\./);

  const silent = groundSegmentPromptInStoryboard(LOCKED_TEMPLATE.replace(/^Spoken dialogue.*$/m, ""), { ...base, shotCards: texts });
  assert.doesNotMatch(silent, /SPEECH TIMING/);
  assert.match(silent, /^LIP-SYNC LOCK/m, "没有口播就不动口型锁");

  const legacy = groundSegmentPromptInStoryboard(LOCKED_TEMPLATE, { ...base, shotCards: CARDS.map((card) => formatShotCard(card)) });
  assert.match(legacy, /^SPEECH TIMING: one narrator only;/m, "10-28 的旧卡没写谁说话：旁白时间窗同初版");
  assert.match(legacy, /^LIP-SYNC LOCK/m);
  assert.match(legacy, /^SCENE GEOMETRY LOCK: keep one physically coherent location/m);
});

test("P0 派发：30 秒第二段从换地点那一帧开场——段首换地点不算段内换地点，场景锁原样", () => {
  const five = normalizeShotCards({ shots: [...DIRECTED, { ...DIRECTED[3], action: "she sips from the cup" }] }, 5)!;
  const out = groundSegmentPromptInStoryboard(LOCKED_TEMPLATE, {
    aspectRatio: "9:16", story: "通勤保温杯", beats: STORYBOARD_BEATS_LONG, productPhotoCount: 2,
    totalDurationSec: 30, fromSec: 15, toSec: 30, shotCards: formatShotCardSequence(five),
  });
  assert.match(out, /^0-3s · shot 1: from storyboard keyframe 3 \(reference image 5\)\. New location: office desk\./m);
  assert.match(out, /^SCENE GEOMETRY LOCK: keep one physically coherent location/m);
});

test("P0 接线：创作台把口播稿带给故事板但不算进提交指纹；service 只交给镜头卡设计，不进幂等哈希", async () => {
  const studio = await readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /const fingerprint = JSON\.stringify\(storyboardBody\);/);
  assert.match(studio, /body: JSON\.stringify\(narration \? \{ \.\.\.storyboardBody, voiceoverScript: narration \} : storyboardBody\)/);
  const service = await readFile("src/lib/video-generation/storyboard-service.ts", "utf8");
  assert.match(service, /voiceoverScript: input\.voiceoverScript \?\? null,/);
  const hash = service.slice(service.indexOf("function requestHash("), service.indexOf("function resolveStoryboardPersonImages"));
  assert.ok(hash.length > 0);
  assert.doesNotMatch(hash, /voiceover/);
});
