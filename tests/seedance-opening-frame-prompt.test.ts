import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatShotCard, formatShotCardSequence, normalizeShotCards } from "../src/lib/video-generation/shot-cards";
import {
  SEEDANCE_OPENING_FRAME_MARKER,
  groundSegmentPromptForOpeningFrame,
  groundSegmentPromptForSeedanceOpeningFrame,
  groundSegmentPromptInStoryboard,
  shuyuOpeningFramePromptEnabled,
} from "../src/lib/video-generation/storyboard-beats";
import {
  STORYBOARD_STORY_CONTEXT_PREFIX,
  readStoryContextFromFramePrompt,
} from "../src/lib/video-generation/storyboard-frame-inputs";
import { renderStoryInEnglish, storyEnglishEnabled, storyNeedsEnglish } from "../src/lib/video-generation/story-english";
import {
  CHARACTER_SHEET_ASPECT_RATIO,
  buildCharacterSheetPrompt,
  storyHasRecurringSubject,
} from "../src/lib/video-generation/character-sheet";

test("人物设定图（GPT 人物版）：有人或动物反复出镜才出；提示词全英文、从开场帧取人、不画商品与文字", () => {
  assert.equal(storyHasRecurringSubject(["Action: her right hand twists the lid shut.", null]), true);
  assert.equal(storyHasRecurringSubject(["Action: the golden retriever runs toward camera."]), true);
  assert.equal(storyHasRecurringSubject(["Action: a hand tears open the bag.", "Action: beans pour into the grinder."]), false);
  /// 镜头卡常用身份词 + 中性代词写人（10-29 首版漏判了耳机 / 背包 / 咖啡三条）
  assert.equal(storyHasRecurringSubject(["Starts on: Passenger grips the pole with right hand."]), true);
  assert.equal(storyHasRecurringSubject(["Action: Hiker unclips the black buckle."]), true);
  assert.equal(storyHasRecurringSubject(["Action: The barista raises the open bag 15cm to their nose."]), true);
  const prompt = buildCharacterSheetPrompt({ productPhotoCount: 3 });
  assert.match(prompt, /image 1, the opening storyboard frame/u);
  assert.match(prompt, /Images 2-4 show the product: leave the product out of the sheet entirely\./u);
  assert.match(prompt, /full-body front view, full-body three-quarter view, full-body side view, and a head-and-shoulders close-up/u);
  assert.match(prompt, /AVOID: text, labels/u);
  assert.doesNotMatch(prompt, /[㐀-鿿]/u);
  assert.equal(CHARACTER_SHEET_ASPECT_RATIO, "16:9");
});

test("首帧版给 Kling（开场帧排第 1 张、2500 字）：序号整体后移、商品限制跟着改；不带负面也装得下，卡和故事都保住保底", () => {
  const out = groundSegmentPromptForSeedanceOpeningFrame(TEMPLATE, {
    aspectRatio: "9:16",
    story: STORY_EN,
    beats: BEATS,
    productPhotoCount: 3,
    personCount: 1,
    personRole: "character_sheet",
    openingFrameFirst: true,
    promptLimit: 2500,
    totalDurationSec: 15,
    fromSec: 0,
    toSec: 15,
    shotCards: watchCards(),
  });
  assert.ok(out.length <= 2500, `${out.length}`);
  assert.match(out, /^REFERENCES: Image 1 is the opening frame: start exactly on it, then move\./mu);
  assert.match(out, /Image 2 is a character sheet — keep these exact faces, hair and wardrobe/u);
  assert.match(out, /Images 3-5 are real photos of the product — copy the product only/u);
  assert.match(out, /printed marks of images 3-5 in every shot/u);
  assert.match(out, /^SPEECH: one off-screen narrator only/mu, "2500 字一档用一句话的口播时间窗");
  for (const shot of ["0-4s: ", "4-8s (hard cut): ", "8-11s (hard cut): ", "11-15s (hard cut to a new location): "]) {
    const line = out.split("\n").find((candidate) => candidate.startsWith(shot));
    assert.ok(line && /Action: /u.test(line) && /Ends on: /u.test(line), `${shot} 保住动作与尾态`);
  }
  assert.ok(out.includes('Spoken dialogue (voice only, exact wording, zh-CN, warm confident): "清晨五点半，看一眼就出发。钢壳加皮表带，经得起野外。"'));
});

test("Shuyu 首帧版 + 人物设定图：人物位写成设定图的职责，不写主播照", () => {
  const out = groundSegmentPromptForSeedanceOpeningFrame(TEMPLATE, {
    aspectRatio: "9:16",
    story: STORY_EN,
    beats: BEATS,
    productPhotoCount: 2,
    personCount: 1,
    personRole: "character_sheet",
    totalDurationSec: 15,
    fromSec: 0,
    toSec: 15,
    shotCards: watchCards(),
  });
  assert.match(out, /Image 3 is a character sheet of the people and animals in the story/u);
  assert.match(out, /Image 4 is the opening frame/u);
  assert.doesNotMatch(out, /the presenter — /u);
});

/**
 * 2026-10-29 · 按 Kelin 团队的做法改提示词：全程英文；Shuyu（Seedance 2.5）单段只带开场帧 + 商品参考，
 * 剧情交给按秒的时间线；镜头卡补齐六项里的「光色」。
 */

const CJK = /[㐀-鿿]/u;
const STORY_ZH = "极简钢壳野战表，黑色表盘、棕色皮表带。想拍清晨露营，男生在帐篷外拉起袖子看时间，表盘在逆光里反光，然后他背上包出发。";
const STORY_EN =
  "A minimalist steel field watch with a black dial and a brown leather strap. Early-morning camping: a man outside his tent pulls up his sleeve to check the time, the dial catches the backlight, then he shoulders his backpack and sets off.";

test("英文化：中文原话才去翻；已是英文原样用；译文按 JSON 收、还是中文就拒收；失败 / 超时 / 不可用一律 null", async () => {
  assert.equal(storyNeedsEnglish(STORY_ZH), true);
  assert.equal(storyNeedsEnglish(STORY_EN), false);

  let calls = 0;
  const chat = (async (options: { stage?: string; tier: string; maxTokens?: number }) => {
    calls += 1;
    assert.equal(options.stage, "story_english");
    assert.equal(options.tier, "fast");
    assert.ok((options.maxTokens ?? 0) >= 4000, "推理模型要给思考留余量");
    return { data: { english: `  ${STORY_EN}\n` }, modelUsed: "stub", tokenUsage: null };
  }) as never;
  assert.equal(await renderStoryInEnglish(`  ${STORY_EN}  `, { chat, llmAvailable: () => true }), STORY_EN);
  assert.equal(calls, 0, "英文原话不调模型");
  assert.equal(await renderStoryInEnglish(STORY_ZH, { chat, llmAvailable: () => true }), STORY_EN);
  assert.equal(calls, 1);

  const stillChinese = (async () => ({ data: { english: STORY_ZH }, modelUsed: "stub", tokenUsage: null })) as never;
  assert.equal(await renderStoryInEnglish(STORY_ZH, { chat: stillChinese, llmAvailable: () => true }), null);
  /// 商品上印的中文品牌名逐字保留：零星中文可以
  const keepsBrand = (async () => ({ data: { english: "A jar of 老干妈 chili sauce on a wooden table." }, modelUsed: "stub", tokenUsage: null })) as never;
  assert.equal(await renderStoryInEnglish("桌上一瓶老干妈辣酱", { chat: keepsBrand, llmAvailable: () => true }), "A jar of 老干妈 chili sauce on a wooden table.");

  const broken = (async () => {
    throw new Error("OpenAI 返回了空响应");
  }) as never;
  assert.equal(await renderStoryInEnglish(STORY_ZH, { chat: broken, llmAvailable: () => true }), null);
  assert.equal(await renderStoryInEnglish(STORY_ZH, { chat, llmAvailable: () => false }), null);
  const slow = (() => new Promise(() => {})) as never;
  assert.equal(await renderStoryInEnglish(STORY_ZH, { chat: slow, llmAvailable: () => true, timeoutMs: 5 }), null);
});

test("一键退回开关：STORYBOARD_STORY_ENGLISH=off 不翻、SHUYU_OPENING_FRAME_PROMPT=off 回逐帧版；缺省都开", async () => {
  assert.equal(storyEnglishEnabled({}), true);
  assert.equal(storyEnglishEnabled({ STORYBOARD_STORY_ENGLISH: " OFF " }), false);
  assert.equal(shuyuOpeningFramePromptEnabled({}), true);
  assert.equal(shuyuOpeningFramePromptEnabled({ SHUYU_OPENING_FRAME_PROMPT: "off" }), false);
  let calls = 0;
  const chat = (async () => {
    calls += 1;
    return { data: { english: STORY_EN }, modelUsed: "stub", tokenUsage: null };
  }) as never;
  assert.equal(await renderStoryInEnglish(STORY_ZH, { enabled: false, chat, llmAvailable: () => true }), null);
  assert.equal(calls, 0, "关着就不调模型");
  const service = await readFile("src/lib/services/video-service.ts", "utf8");
  assert.match(service, /&& plan\?\.segmentPlan\.length === 1\s*&& shuyuOpeningFramePromptEnabled\(\);/u);
});

test("帧提示词读回英文故事：有 STORY CONTEXT 行取正文，没有就 null（旧 run 退回原话）", () => {
  const prompt = ["Create ONE photorealistic commercial storyboard keyframe…", `${STORYBOARD_STORY_CONTEXT_PREFIX}${STORY_EN}`, "FORMAT: 9:16."].join("\n");
  assert.equal(readStoryContextFromFramePrompt(prompt), STORY_EN);
  assert.equal(readStoryContextFromFramePrompt("FORMAT: 9:16."), null);
  assert.equal(readStoryContextFromFramePrompt(`${STORYBOARD_STORY_CONTEXT_PREFIX}   `), null);
  assert.equal(readStoryContextFromFramePrompt(null), null);
});

test("镜头卡补齐六项：光色字段收进卡、排在构图后声音前；旧卡没有光色照旧", () => {
  const [card] = normalizeShotCards(
    {
      shots: [
        {
          startState: "man stands at the tent entrance, sleeve over the watch",
          action: "he pulls his left sleeve up 12cm",
          endState: "black dial visible at chest height",
          location: "campsite",
          voice: "voice_over",
          lens: "35mm medium shot",
          camera: "1.4m high beside the tent, slow 20cm push-in",
          composition: "tent edge foreground, man midground, sunrise background",
          light: "low warm sunrise backlight from camera right",
          sound: "wind, distant birds",
        },
      ],
    },
    1,
  )!;
  assert.equal(card.light, "low warm sunrise backlight from camera right");
  assert.match(formatShotCard(card), /Composition: [^.]+\. Light: low warm sunrise backlight from camera right\. Sound: /u);
  assert.doesNotMatch(formatShotCard({ ...card, light: undefined }), /Light:/u);
});

function watchCards(): Array<string | null> {
  const cards = normalizeShotCards(
    {
      shots: [
        { startState: "man at the tent entrance, watch under his left sleeve", action: "he pulls the sleeve up 12cm with his right hand", endState: "left wrist raised, black dial visible", location: "campsite", voice: "voice_over", lens: "35mm medium shot", camera: "1.4m high beside the tent, slow 20cm push-in", composition: "tent edge foreground, man midground, sunrise behind", light: "low warm sunrise backlight", sound: "wind, sleeve rustle" },
        { action: "he turns the wrist 25 degrees toward the sun", endState: "steel case catches a brief reflection", location: "campsite", voice: "voice_over", lens: "85mm close-up", camera: "wrist height, locked off", composition: "watch fills midground", light: "low warm sunrise backlight", sound: "soft wind" },
        { action: "his thumb smooths the leather strap down 3cm", endState: "strap lies flat, case visible", location: "campsite", voice: "voice_over", lens: "100mm macro", camera: "wrist height, slow 10cm push-in", composition: "strap and case fill the frame", light: "low warm sunrise backlight", sound: "leather rub" },
        { startState: "he wears the backpack and faces the trail", action: "he takes three steps forward along the trail", endState: "walking away, watch visible on the swinging wrist", location: "forest trail", voice: "voice_over", lens: "50mm medium full shot", camera: "1.2m high behind him, slow 30cm pan right", composition: "trail leads into the trees", light: "low warm sunrise backlight", sound: "footsteps on gravel" },
      ],
    },
    4,
  )!;
  return formatShotCardSequence(cards);
}

const TEMPLATE = [
  "PRODUCT (must exactly match the reference images): minimalist field watch, round brushed steel case, matte black dial, dark brown stitched leather strap.",
  "CHARACTER IDENTITY LOCK: every recurring person must keep the exact same face, age, hair, body proportions, outfit and accessories in every shot; do not swap, duplicate or restyle the cast.",
  "LIP-SYNC LOCK: when dialogue is spoken, the speaker's lip movements must naturally match the words; the speaker's identity stays the same person throughout.",
  "Audio: generate native speech for the approved voice-only dialogue below, with subtle real room ambience.",
  'Spoken dialogue (voice only, exact wording, zh-CN, warm confident): "清晨五点半，看一眼就出发。钢壳加皮表带，经得起野外。"',
  "Do not render subtitles, captions, on-screen text, or a music bed.",
].join("\n");

const BEATS = [
  "0–3s · immediate problem or desire hook",
  "3–7s · faithful product reveal",
  "7–11s · simple product demonstration and proof",
  "11–15s · resolved result with clean CTA-safe composition",
];

function grounded(overrides: Partial<Parameters<typeof groundSegmentPromptForSeedanceOpeningFrame>[1]> = {}): string {
  return groundSegmentPromptForSeedanceOpeningFrame(TEMPLATE, {
    aspectRatio: "9:16",
    story: STORY_EN,
    beats: BEATS,
    productPhotoCount: 2,
    totalDurationSec: 15,
    fromSec: 0,
    toSec: 15,
    negativePrompt: "blurry, distorted product, extra fingers",
    shotCards: watchCards(),
    ...overrides,
  });
}

test("Shuyu 首帧版：七段结构、只认开场帧、按秒时间线；除口播台词外全英文；比逐帧版短", () => {
  const out = grounded();
  const lines = out.split("\n");
  assert.ok(lines[0].startsWith("FORMAT: 9:16, 15s, one photorealistic live-action commercial"));
  assert.match(out, /^REFERENCES: Images 1-2 are real photos of the product — copy only the product itself/mu);
  assert.match(out, /Image 3 is the opening frame: the video starts exactly on it/u);
  assert.doesNotMatch(out, /keyframe|reference image 4/iu, "不再逐张复刻关键帧");
  assert.ok(out.includes(`STORY (the merchant's own description; it decides who is on screen, where, and what happens): ${STORY_EN}`));
  assert.ok(out.includes(SEEDANCE_OPENING_FRAME_MARKER));
  assert.match(out, /^0-4s: Starts on: man at the tent entrance/mu);
  assert.match(out, /^4-8s \(hard cut\): /mu);
  assert.match(out, /^11-15s \(hard cut to a new location\): New location: forest trail\./mu);
  assert.match(out, /Light: low warm sunrise backlight/u);
  assert.match(out, /^SPEECH TIMING: one off-screen narrator only, and nobody on screen speaks or moves their lips;/mu);
  assert.doesNotMatch(out, /LIP-SYNC LOCK/u, "全是画外音：去掉口型锁");
  assert.match(out, /^KEY CONSTRAINTS: the product keeps the exact shape, proportions, colors, parts and printed marks of images 1-2/mu);
  assert.match(out, /no on-screen text, subtitles, logos, watermarks or background music\.$/mu);
  assert.ok(!out.includes("Do not render subtitles"), "模板那行与 KEY CONSTRAINTS 重复，不再写");

  const chineseLines = lines.filter((line) => CJK.test(line));
  assert.deepEqual(chineseLines.map((line) => line.slice(0, 16)), ["Spoken dialogue "], "只有口播台词保留原文");

  const keyframeVersion = groundSegmentPromptInStoryboard(TEMPLATE, {
    aspectRatio: "9:16",
    story: STORY_ZH,
    beats: BEATS,
    productPhotoCount: 2,
    totalDurationSec: 15,
    fromSec: 0,
    toSec: 15,
    negativePrompt: "blurry, distorted product, extra fingers",
    shotCards: watchCards(),
  });
  assert.ok(out.length < keyframeVersion.length, `首帧版 ${out.length} 字应短于逐帧版 ${keyframeVersion.length} 字`);
  assert.ok(out.length <= 3600, `首帧版 ${out.length} 字`);
});

test("Shuyu 首帧版：有主播照时开场帧排在主播后面；改写过的不再改写，另外两版也认这个标记", () => {
  const withPresenter = grounded({ personCount: 1 });
  assert.match(withPresenter, /Image 3 is the presenter — the on-camera person is this exact person/u);
  assert.match(withPresenter, /Image 4 is the opening frame/u);

  const once = grounded();
  const input = {
    aspectRatio: "9:16",
    story: STORY_EN,
    beats: BEATS,
    productPhotoCount: 2,
    totalDurationSec: 15,
    fromSec: 0,
    toSec: 15,
    shotCards: watchCards(),
  };
  assert.equal(groundSegmentPromptForSeedanceOpeningFrame(once, input), once);
  assert.equal(groundSegmentPromptInStoryboard(once, input), once);
  assert.equal(groundSegmentPromptForOpeningFrame(once, input), once);
});

test("Shuyu 首帧版：没有镜头卡的镜头退回节奏句；超长台词与负面也装得下 5000 字，台词一字不动", () => {
  const noCards = grounded({ shotCards: [null, null, null, null] });
  assert.match(noCards, /^0-4s: immediate problem or desire hook\.$/mu);
  const longLine = `Spoken dialogue (voice only, exact wording, zh-CN, warm confident): "${"清晨五点半，看一眼就出发。".repeat(40)}"`;
  const longTemplate = TEMPLATE.replace(/^Spoken dialogue.*$/mu, longLine);
  const out = groundSegmentPromptForSeedanceOpeningFrame(longTemplate, {
    aspectRatio: "9:16",
    story: STORY_EN.repeat(4),
    beats: BEATS,
    productPhotoCount: 2,
    totalDurationSec: 15,
    fromSec: 0,
    toSec: 15,
    negativePrompt: "x".repeat(600),
    shotCards: watchCards(),
  });
  assert.ok(out.includes(longLine));
  assert.ok(out.length + "\nNegative constraints: ".length + 600 <= 5000, `${out.length}`);
});
