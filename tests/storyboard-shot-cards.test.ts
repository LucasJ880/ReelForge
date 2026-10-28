import assert from "node:assert/strict";
import test from "node:test";
import {
  SHOT_CARD_LINE_PREFIX,
  buildShotCardUserPrompt,
  designStoryboardShotCards,
  formatShotCard,
  normalizeShotCards,
  readShotCardFromFramePrompt,
  storyboardShotCardsEnabled,
  type StoryboardShotCard,
} from "../src/lib/video-generation/shot-cards";
import {
  NEGATIVE_CONSTRAINTS_SEPARATOR,
  STORYBOARD_BEATS_SHORT,
  groundSegmentPromptInStoryboard,
} from "../src/lib/video-generation/storyboard-beats";
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

test("format / read：一行英文、可从帧提示词读回；没有卡 → null", () => {
  const text = formatShotCard(CARD);
  assert.equal(
    text,
    "24mm wide establishing shot. Camera: chest-high beside the sofa, locked off. Composition: family foreground; glare-covered TV midground; zebra blind background left. Action: one adult raises a hand 20cm to shield their eyes over two seconds. Ends on: family squints at the washed-out TV screen. Sound: quiet room tone, faint TV audio.",
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

  const texts = CARDS.map(formatShotCard);
  const out = groundSegmentPromptInStoryboard(TEMPLATE, { ...base, shotCards: texts });
  assert.match(out, /^0-4s · shot 1: recreate storyboard keyframe 1 \(reference image 3\) — immediate problem or desire hook\. 24mm shot 1\. Camera: /m);
  assert.match(out, /^4-8s · shot 2 \(hard cut\): recreate storyboard keyframe 2 \(reference image 4\)/m);
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
