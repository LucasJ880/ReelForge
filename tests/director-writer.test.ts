import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test, { mock } from "node:test";
import { openai } from "../src/lib/providers/openai";
import {
  DIRECTOR_PRODUCT_TYPES,
  DIRECTOR_VIDEO_PROMPT_MAX,
  buildVideoPrompt,
  lintDirectorJob,
  parseDirectorJob,
  videoReferenceOrder,
  type DirectorJob,
} from "../src/lib/video-generation/director-plan";
import {
  DIRECTOR_WRITER_BLOCKING_WARNINGS,
  DIRECTOR_WRITER_EXAMPLE_DRAFT,
  DIRECTOR_WRITER_EXAMPLE_DURATION_SEC,
  DIRECTOR_WRITER_MAX_ATTEMPTS,
  DIRECTOR_WRITER_PHOTOS_MAX,
  DIRECTOR_WRITER_SCHEMA_NAME,
  DIRECTOR_WRITER_SYSTEM_PROMPT,
  __test__,
  buildDirectorWriterUserMessage,
  compactDirectorJob,
  directorDraftSchema,
  isBlockingDirectorWarning,
  writeDirectorJob,
  type DirectorDraft,
  type DirectorWriterCompleter,
  type DirectorWriterInput,
} from "../src/lib/video-generation/director-writer";
import { DIRECTOR_WRITER_MODEL_ENV, createOpenAiDirectorCompleter, directorWriterModelChain } from "../src/lib/video-generation/director-writer-openai";

/**
 * 导演写手（线上对齐第 1 步）：模型写草稿 → 拼成 DirectorJob → 导演线路同一套校验 → 不合格带原话送回去改。
 * 全部用假的模型函数，不触网。草稿取自真机拍过、判过好的两份脚本（tmp/director/bib-scene-01、blanket-fmcg-02）
 * 和 30 秒那份（bib-30s-01），把 image N 换成了写手用的 photo-N。
 */

type Call = { system: string; user: string; images: string[]; schemaName: string };

/** 按顺序回放的假模型：回放到最后一条就一直用它；Error 当抛错。 */
function fakeCompleter(...replies: unknown[]): { complete: DirectorWriterCompleter; calls: Call[] } {
  const calls: Call[] = [];
  const complete: DirectorWriterCompleter = async (args) => {
    calls.push(args);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    return typeof reply === "string" ? reply : structuredClone(reply);
  };
  return { complete, calls };
}

// ---------------------------------------------------------------------------
// 口水巾场景版（bib-scene-01）：商家多给了一张自家餐厅的照片，排在第一张
// ---------------------------------------------------------------------------

const BIB_INPUT: DirectorWriterInput = {
  productName: "婴儿纱布口水巾三条装",
  description: "婴儿纱布口水巾三条装，白色、姜黄、灰褐三色。多层纱布柔软吸水，喂饭漏了有它接着，按扣一按就戴好。",
  sellingPoints: ["多层纱布，柔软不磨下巴", "三条轮换"],
  cta: "现在就带走",
  photos: [
    { id: "asset-room", url: "https://blob.example/room.jpg", note: "我家餐厅" },
    { id: "asset-set", url: "https://blob.example/set.jpg" },
    { id: "asset-edge", url: "https://blob.example/edge.jpg" },
    { id: "asset-snap", url: "https://blob.example/snap.jpg" },
  ],
  durationSec: 15,
  aspectRatio: "9:16",
};

function bibSceneDraft(): DirectorDraft {
  return {
    scenario: {
      who: "A baby of six to twelve months wears it; mom buys it",
      where: "The high chair at home",
      moment: "Feeding puree: one spoon in, half a spoon out",
      trouble: "Puree slides off the chin onto the clothes, several outfits a day",
      after: "The puree lands on the bib, the onesie stays clean, mom wipes the chin with it",
      emotion: "The baby's laugh, mom at ease",
    },
    productType: "soft",
    productTypeReason: "Gauze bibs: softness and absorbency, no print to protect",
    genre: "fmcg",
    genreReason: "A feed ad for a low-price pack: hook on the spill, end on the order",
    photos: [
      { photo: "photo-1", kind: "scene", useInVideo: true, role: "the dining nook: room, high chair and window light only" },
      { photo: "photo-2", kind: "product", useInVideo: true, role: "the three triangular gauze baby bibs: white, mustard and taupe, a round white fastener at the tips; ignore the background" },
      { photo: "photo-3", kind: "product", useInVideo: true, role: "fabric close-up: gauze weave, stacked layers, stitched edge" },
      { photo: "photo-4", kind: "product", useInVideo: true, role: "the round white fastener at a bib tip" },
    ],
    openingFrame:
      "A bright home dining nook at midday, as in photo-1. A baby about nine months old sits in a light wooden high chair with a white tray, cropped below the nose: only the closed lips, chubby chin, neck and chest are seen. The baby wears the mustard triangular gauze bib from photo-2 over a plain white onesie, the point of the triangle at mid-chest and large in the picture, its weave readable as in photo-3. An adult hand in a cream knit sleeve comes in from the right holding a small silicone spoon of orange pumpkin puree a few centimetres from the lips, nothing spilled yet. Soft daylight from a window on the left. Shot close from the front at the baby's chest height.",
    logline: "At lunch in a sunlit home a baby spills puree, the gauze bib catches it and mom wipes the chin clean with it.",
    look: "Handheld phone-style home video ad, bright soft daylight, close shots at high-chair height, hard cuts on the beat.",
    openingState: "The baby sits in the high chair in a clean mustard bib and mom's hand holds a spoon of orange puree at the lips.",
    voice: "a bright warm young mother's voice speaking Mandarin, upbeat, quick and close-mic",
    music: "light bouncy pop beat around 115 bpm with ukulele plucks and claps, cuts land on the beat",
    shots: [
      {
        fromSec: 0,
        toSec: 2,
        action: "The baby, cropped below the nose, turns away from the spoon and a blob of orange puree slides off the chin onto the mustard bib.",
        space: "High chair with white tray and puree bowl, mom's hand and spoon from the right, window on the left.",
        framing: "Close shot from the front at chest height, chin, bib and spoon fill the picture.",
        camera: "Fast but controlled push in to the chin and bib.",
        light: "Bright soft window daylight from the left, clean whites.",
        sound: 'A soft plop and a baby babble; the voice says "喂一口，漏半口？"',
      },
      {
        fromSec: 2,
        toSec: 4,
        action: "Hard cut. Mom's fingers lift the bib point: puree on the gauze, the white onesie underneath spotless.",
        framing: "Extreme close-up on the bib point, weave as in photo-3.",
        camera: "Locked off, the fingers move.",
        sound: 'A soft fabric rustle; the voice says "有它接着，衣服不脏。"',
      },
      {
        fromSec: 4,
        toSec: 7,
        action: "Hard cut. Mom's hand folds a clean corner of the bib up and wipes the baby's chin in one gentle stroke, the baby cropped below the nose.",
        framing: "Close shot from the front at chin height, hand, gauze and chin fill the picture.",
        camera: "Slow push in on the chin.",
        sound: 'A soft wipe; the voice says "纱布柔软，顺手一擦就干净。"',
      },
      {
        fromSec: 7,
        toSec: 10,
        action: "Hard cut. The baby, face visible with a clean chin, laughs and slaps the tray with both hands, the mustard bib on its chest.",
        framing: "Medium close shot from the front at the baby's eye height.",
        camera: "Locked off.",
        sound: 'A bright baby laugh and two tray slaps on the beat; the voice says "宝宝舒服，妈妈省心。"',
      },
      {
        fromSec: 10,
        toSec: 12,
        action: "Hard cut. Seen from behind the high chair, mom's hands press the round white fastener shut at the baby's nape on a fresh taupe bib.",
        framing: "Close shot from behind at shoulder height, the fastener sharp as in photo-4.",
        camera: "Locked off.",
        sound: 'A light click; the voice says "一按就换，三条轮换。"',
      },
      {
        fromSec: 12,
        toSec: 15,
        action: "Hard cut. On the tray in the same window light the three bibs lie neatly fanned, white, mustard and taupe, and mom's hand gives them one quick pat.",
        framing: "Product close shot from slightly above, the three bibs centred.",
        camera: "Short push in that stops dead on the last beat.",
        sound: 'A soft pat; the voice says "三条装，现在就带走！" and the music ends on a clean hit.',
      },
    ],
    endState: "The three bibs rest fanned on the tray in bright daylight, the hand lifted away, picture still.",
    throughout: [
      "the bibs stay exactly as photo-2 in colour, weave and fasteners",
      "one baby about nine months old in a plain white onesie",
      "mom is only seen as hands and a cream knit sleeve",
    ],
  };
}

// ---------------------------------------------------------------------------
// 毛毯快销版（blanket-fmcg-02）：两张实拍图
// ---------------------------------------------------------------------------

const BLANKET_INPUT: DirectorWriterInput = {
  productName: "双面绒毛毯",
  description: "双面绒毛毯，一面细绒一面羊羔绒，顺滑不掉毛，冬天窝在沙发上盖着很暖。暖窝家居出品。",
  photos: [
    { id: "hero", url: "https://blob.example/blanket-hero.png" },
    { id: "detail", url: "https://blob.example/blanket-detail.png", note: "面料特写" },
  ],
  durationSec: 15,
  aspectRatio: "9:16",
  voiceLanguage: "zh-CN",
  genre: "fmcg",
};

function blanketDraft(): DirectorDraft {
  return {
    scenario: {
      who: "Someone who curls up on the sofa in winter; they buy it for themselves",
      where: "The living-room sofa",
      moment: "Sitting down on a cold afternoon",
      trouble: "A thin throw that neither feels soft nor keeps the warmth in",
      after: "A hand sinks into the pile and the blanket wraps the shoulders",
      emotion: "The ease of dropping back into the sofa, seen from behind",
    },
    productType: "soft",
    productTypeReason: "A blanket: the hand pressing into the pile is the proof",
    genre: "fmcg",
    genreReason: "Set by the merchant: a punchy feed ad",
    photos: [
      { photo: "photo-1", kind: "product", useInVideo: true, role: "the blanket: sage velvety face, cream sherpa reverse, stitched hem; ignore the background" },
      { photo: "photo-2", kind: "product", useInVideo: true, role: "fabric close-up: pile and sherpa curl size; ignore the framing" },
    ],
    openingFrame:
      "A bright, airy living room at midday. The sage green blanket from photo-1 lies folded in a thick, plump rectangle on the seat of a light oatmeal sofa, one corner turned back to show its cream sherpa reverse. The blanket is large in the picture and fills the lower two thirds. A woman's bare hand with fingers spread hovers a few centimetres above the centre of the blanket, coming in from the top edge of the picture, about to press down; only the hand and wrist are in the picture. Strong soft daylight pours in from a window on the left through white sheer curtains. Shot close from slightly above at sofa-seat height.",
    logline: "Hands press, stroke, flip and shake out a sage and sherpa blanket on a sunlit sofa.",
    look: "Handheld phone-style product ad, bright window daylight, crisp close-ups, hard cuts on the beat.",
    openingState: "The folded blanket sits on the oatmeal sofa and a hand hovers just above it, about to press down.",
    voice: "a bright young female voice speaking Mandarin, upbeat, quick and close-mic",
    music: "upbeat pop beat around 120 bpm with claps and plucked bass, cuts land on the beat",
    shots: [
      {
        fromSec: 0,
        toSec: 2,
        action: "The hand drops and presses into the blanket, the pile sinking to the knuckles.",
        space: "Blanket fills the lower two thirds on the sofa seat, window on the left.",
        framing: "Close shot from slightly above at sofa-seat height.",
        camera: "Fast but controlled push in to the fingertips.",
        light: "Bright soft window daylight from the left, crisp highlights on the pile.",
        sound: 'A soft fabric thump; the voice says "摸一下就回不去！"',
      },
      {
        fromSec: 2,
        toSec: 4,
        action: "Hard cut. Fingertips rake across the sage pile and leave a darker brushed trail.",
        framing: "Extreme close-up, individual fibres visible as in photo-2.",
        camera: "Fast but controlled track following the fingers.",
        sound: 'A dry swish; the voice says "细绒面，顺滑不掉毛。"',
      },
      {
        fromSec: 4,
        toSec: 7,
        action: "Hard cut. A hand flips the corner wide open and squeezes the cream sherpa curls.",
        framing: "Close-up on the corner: sage face left, sherpa and stitched hem right.",
        camera: "Slow push in on the fingers.",
        sound: 'A soft squish; the voice says "翻过来，是羊羔绒。"',
      },
      {
        fromSec: 7,
        toSec: 10,
        action: "Hard cut. Two hands shake the blanket open toward the camera and it billows until it fills the picture.",
        space: "In front of the sofa, hands only: the open blanket covers everything behind it from the first frame.",
        framing: "Medium shot of the whole open blanket, sherpa showing at a flipping edge.",
        camera: "Locked off, slow motion for this shot only.",
        sound: "A deep fabric whoosh on the beat drop, no voice.",
      },
      {
        fromSec: 10,
        toSec: 13,
        action: "Hard cut. A woman seen from behind pulls the blanket around her shoulders and drops back into the sofa.",
        space: "She faces the bright window, daylight on the sage fabric across her back.",
        framing: "Medium close shot from behind, shoulders and blanket fill the picture.",
        camera: "Fast but controlled push in to her shoulders.",
        sound: 'A cosy rustle; the voice says "裹上它，沙发秒变暖窝。"',
      },
      {
        fromSec: 13,
        toSec: 15,
        action: "Hard cut. The folded blanket sits on the sofa, sherpa corner turned back, and a hand gives it one quick pat.",
        space: "Sofa seat and window light as in shot 1.",
        framing: "Product close shot, blanket centred and large.",
        camera: "Short push in that stops dead on the last beat.",
        sound: 'A pat; the voice says "今天就带走！" and the music ends on a clean hit.',
      },
    ],
    endState: "The folded blanket rests on the sofa in bright daylight, sherpa corner showing, hand lifted away, picture still.",
    throughout: [
      "the blanket stays exactly as photo-1 in colour and texture",
      "one single blanket in every shot",
      "only hands, forearms and the back of a head are ever seen",
    ],
  };
}

/** 把草稿改一处再交回去（深拷贝，不动原件）。 */
function edited(draft: DirectorDraft, change: (copy: DirectorDraft) => void): DirectorDraft {
  const copy = structuredClone(draft);
  change(copy);
  return copy;
}

// ---------------------------------------------------------------------------
// 30 秒十二镜头（bib-30s-01）
// ---------------------------------------------------------------------------

function bib30Draft(): DirectorDraft {
  const terse = (fromSec: number, toSec: number, action: string, framing: string, camera: string, sound: string, space?: string) => ({
    fromSec,
    toSec,
    action,
    framing,
    camera,
    sound,
    ...(space ? { space } : {}),
  });
  return {
    ...bibSceneDraft(),
    photos: [
      { photo: "photo-1", kind: "scene", useInVideo: false, role: "the dining nook: room and window light only" },
      { photo: "photo-2", kind: "product", useInVideo: true, role: "the three triangular gauze baby bibs: white, mustard, taupe, round white fasteners; ignore the background" },
      { photo: "photo-3", kind: "product", useInVideo: true, role: "fabric close-up: gauze weave, layers, stitched edge" },
      { photo: "photo-4", kind: "product", useInVideo: true, role: "the round white fastener at a bib tip" },
    ],
    openingFrame:
      "A bright home dining nook at midday. A baby in a light wooden high chair, cropped below the nose, wears the mustard gauze bib from photo-2 over a white onesie while an adult hand in a cream knit sleeve holds a spoon of orange puree at the lips; a bowl of puree on the white tray.",
    logline: "A baby spills lunch and the gauze bib catches it; hands show its layers, absorbency and fastener; the happy baby wears all three colours.",
    look: "Handheld phone-style e-commerce ad, bright daylight, close shots, hard cuts on the beat.",
    music: "light bouncy pop beat around 115 bpm with ukulele and claps, cuts on the beat",
    shots: [
      {
        fromSec: 0,
        toSec: 2,
        action: "The baby, cropped below the nose, turns from the spoon and a small blob of orange puree drops from the chin onto the mustard bib.",
        space: "High chair, white tray, puree bowl, window on the left.",
        framing: "Close shot from the front at chest height.",
        camera: "Fast but controlled push in to the chin and bib.",
        light: "Bright soft window daylight.",
        sound: 'A soft plop; the voice says "喂一口，漏半口？"',
      },
      terse(2, 4, "Hard cut. Mom's fingers lift the bib point, the puree blob still on the gauze, the white onesie underneath spotless.", "Extreme close-up on the bib point.", "Locked off.", 'A fabric rustle; the voice says "有它接着，衣服不脏。"'),
      terse(4, 7, "Hard cut. Mom's hand wipes the chin with a clean corner of the bib and the baby, face visible, breaks into a laugh.", "Close shot from the front at the baby's eye height.", "Slow push in on the face and bib.", 'A baby laugh; the voice says "顺手一擦，干干净净。"'),
      terse(7, 9, "Hard cut. On a pale oak table a hand fans the three bibs apart: white, mustard, taupe.", "Top-down close shot, the bibs fill the picture.", "Locked off.", 'A fabric slide; the voice says "一包三条，三种颜色。"'),
      terse(9, 12, "Hard cut. Hands only: thumb and fingers rub apart the stacked gauze layers at the mustard bib's stitched edge.", "Extreme close-up as in photo-3.", "Slow push in on the fingertips.", 'A dry soft rustle; the voice says "多层纱布，软到不磨下巴。"'),
      terse(12, 14, "Hard cut. A water drop falls from a glass dropper onto the mustard gauze and sinks in at once, leaving a small damp mark.", "Close shot from slightly above.", "Fast but controlled push in to the drop.", 'A tiny plip; the voice says "口水一滴，秒吸干。"'),
      terse(14, 17, "Hard cut. Seen from behind in the high chair, mom's hands press the round white fastener shut at the baby's nape on a taupe bib.", "Close shot from behind, the fastener sharp as in photo-4.", "Locked off.", 'A light click; the voice says "轻轻一按就戴好。"'),
      terse(17, 20, "Hard cut. The baby, face visible, in the taupe bib laughs and slaps the tray with both hands.", "Medium close shot from the front.", "Locked off.", 'A bright laugh and two tray slaps; the voice says "宝宝舒服，妈妈省心。"'),
      terse(20, 22, "Hard cut. Outdoors, the baby seen from behind in a stroller wears the white bib, mom's hand tucking its point flat.", "Close shot from behind at stroller height.", "Steady forward walk.", 'Birdsong; the voice says "出门也好搭。"', "A sunny park path."),
      terse(22, 25, "Hard cut. Hands only: two hands clip the three bibs onto a drying line and they sway lightly.", "Medium close shot, the three bibs in a row.", "Slow sideways track.", 'Clothes pegs clicking; the voice says "脏了一洗，晾晾就干。"', "A sunny window at home."),
      terse(25, 27, "Hard cut. In the high chair the baby, face visible, in the mustard bib reaches both hands toward the camera, beaming.", "Close shot from the front.", "Fast but controlled push in.", 'A happy squeal; the voice says "三条轮着换。"'),
      terse(27, 30, "Hard cut. On the oak table the three bibs lie neatly fanned, white, mustard and taupe, and a hand gives them one quick pat.", "Product close shot from slightly above, bibs centred.", "Short push in that stops dead on the last beat.", 'A soft pat; the voice says "三条装，现在就带走！" and the music ends on a clean hit.'),
    ],
    endState: "The three bibs rest fanned on the oak table in bright daylight, the hand lifted away, picture still.",
    throughout: [
      "the bibs stay exactly as photo-2 in colour, weave and fasteners",
      "one baby about nine months old, fine dark hair, white onesie",
      "mom is only seen as hands and a cream knit sleeve",
    ],
  };
}

// ---------------------------------------------------------------------------
// (a) 一稿合格
// ---------------------------------------------------------------------------

test("好的草稿一稿通过：拼出的脚本零错误，提示词各段按顺序、不超 4,800 字，实拍商品图排在前面", async () => {
  const { complete, calls } = fakeCompleter(bibSceneDraft());
  const result = await writeDirectorJob(BIB_INPUT, { complete, model: "fake-model" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.attempts, 1);
  assert.equal(result.model, "fake-model");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.system, DIRECTOR_WRITER_SYSTEM_PROMPT);
  assert.equal(calls[0]!.schemaName, DIRECTOR_WRITER_SCHEMA_NAME);
  assert.deepEqual(calls[0]!.images, BIB_INPUT.photos.map((photo) => photo.url));

  const { job } = result;
  assert.deepEqual(lintDirectorJob(job).errors, []);
  assert.deepEqual(result.lint, { errors: [], warnings: [] });

  /// 代码拼的部分：一张开场帧出一张、字幕开着、时长与画幅照输入
  assert.equal(job.durationSec, 15);
  assert.equal(job.aspectRatio, "9:16");
  assert.equal(job.genre, "fmcg");
  assert.equal(job.productType, "soft");
  assert.equal(job.frames.length, 1);
  assert.equal(job.frames[0]!.id, "opening");
  assert.equal(job.frames[0]!.variants, 1);
  assert.equal(job.video.openingFrame, "opening");
  assert.equal(job.post?.captions, true);
  assert.equal(job.post?.logo, undefined);
  assert.equal(job.post?.signoff, undefined);
  assert.match(job.id, /^dw-[0-9a-f]{16}$/u);
  assert.match(job.title, /婴儿纱布口水巾三条装/u);

  /// 实拍商品图在前，场景图在后；开场帧带的是同一组、同一个顺序
  assert.deepEqual(job.video.references, ["photo-2", "photo-3", "photo-4", "photo-1"]);
  assert.deepEqual(job.frames[0]!.references, job.video.references);
  assert.deepEqual(
    job.references.map((reference) => [reference.id, reference.kind, reference.source]),
    [
      ["photo-2", "product", "https://blob.example/set.jpg"],
      ["photo-3", "product", "https://blob.example/edge.jpg"],
      ["photo-4", "product", "https://blob.example/snap.jpg"],
      ["photo-1", "scene", "https://blob.example/room.jpg"],
    ],
  );
  const order = videoReferenceOrder(job);
  assert.ok(order.length <= 9);
  assert.equal(order.length, 5);
  assert.equal(order[order.length - 1]!.openingFrame, true);

  /// photo-N 换成了提示词里的 image K（K = 出片参考图里排第几）
  const prompt = buildVideoPrompt(job);
  assert.ok(prompt.length <= DIRECTOR_VIDEO_PROMPT_MAX, `提示词 ${prompt.length} 字`);
  assert.ok(prompt.length <= 3_600, `15 秒的片要在 3,600 字以内，现在 ${prompt.length}`);
  assert.doesNotMatch(prompt, /photo-\d/u);
  assert.match(prompt, /^REFERENCES: image 1 = the three triangular gauze baby bibs/u);
  assert.match(prompt, /image 4 = the dining nook/u);
  assert.match(prompt, /image 5 = the exact opening frame/u);
  assert.match(prompt, /weave as in image 2/u);
  assert.match(prompt, /sharp as in image 3/u);
  assert.match(prompt, /stay exactly as image 1 in colour/u);
  assert.match(job.frames[0]!.prompt, /as in image 4\. A baby/u);
  const sections = ["REFERENCES:", "Vertical 9:16, 15 seconds.", "OPENING STATE:", "TIMELINE:", "Shot 1 (0-2s):", "Shot 6 (12-15s):", "AUDIO:", "END STATE:", "THROUGHOUT:"];
  const positions = sections.map((section) => prompt.indexOf(section));
  assert.ok(positions.every((position) => position >= 0), `缺段：${sections.filter((_, index) => positions[index]! < 0).join(", ")}`);
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);

  /// 场景卡、类型与片种的理由、每张图的去向都交给审片的人
  assert.equal(result.scenario.who, "A baby of six to twelve months wears it; mom buys it");
  assert.equal(result.scenario.productType, "soft");
  assert.equal(result.scenario.genre, "fmcg");
  assert.ok(result.scenario.genreReason.length > 0 && result.scenario.productTypeReason.length > 0);
  assert.deepEqual(
    result.references.map((reference) => [reference.photoId, reference.referenceId, reference.kind, reference.videoImage]),
    [
      ["asset-room", "photo-1", "scene", 4],
      ["asset-set", "photo-2", "product", 1],
      ["asset-edge", "photo-3", "product", 2],
      ["asset-snap", "photo-4", "product", 3],
    ],
  );
});

test("存盘用的精简脚本：不带解析时补的缺省项，读回来与原件一致（命令行的 draft 写的就是它）", async () => {
  const result = await writeDirectorJob(BIB_INPUT, fakeCompleter(bibSceneDraft()));
  assert.ok(result.ok);
  if (!result.ok) return;
  const compact = compactDirectorJob(result.job);
  assert.deepEqual(parseDirectorJob(JSON.parse(JSON.stringify(compact))), result.job);
  assert.deepEqual(compact.post, { captions: true });
  assert.equal("cuts" in compact, false);
  assert.equal("keyframes" in (compact.video as object), false);
  assert.equal("sheet" in (compact.frames as object[])[0]!, false);

  /// 手写的脚本带角标、关键帧、切条时一样不丢东西
  const rich = parseDirectorJob({
    ...compact,
    durationSec: 15,
    cuts: [7],
    post: { captions: false, logo: "assets/mengxin/logo-icon.png", logoPosition: "top-left", logoTone: "dark", signoff: { brandName: "暖窝家居" } },
  });
  assert.deepEqual(parseDirectorJob(compactDirectorJob(rich)), rich);
});

test("同样的输入算出同一个脚本 id；也可以由调用方指定", async () => {
  const first = await writeDirectorJob(BIB_INPUT, fakeCompleter(bibSceneDraft()));
  const second = await writeDirectorJob(structuredClone(BIB_INPUT), fakeCompleter(bibSceneDraft()));
  const named = await writeDirectorJob(BIB_INPUT, { ...fakeCompleter(bibSceneDraft()), jobId: "bib-online-01" });
  assert.ok(first.ok && second.ok && named.ok);
  if (!first.ok || !second.ok || !named.ok) return;
  assert.equal(first.job.id, second.job.id);
  assert.equal(named.job.id, "bib-online-01");
  await assert.rejects(() => writeDirectorJob(BIB_INPUT, { ...fakeCompleter(bibSceneDraft()), jobId: "不合格的 id" }), /jobId 不合格/u);
});

// ---------------------------------------------------------------------------
// (b)(c) 时间线对不上：送回去改；三稿都不行就失败
// ---------------------------------------------------------------------------

const brokenTimeline = () => edited(blanketDraft(), (draft) => void (draft.shots[1]!.fromSec = 3));

test("第一稿时间线断了、第二稿改好：两稿通过，第二次的消息里带着校验的原话和上一稿", async () => {
  const broken = brokenTimeline();
  const { complete, calls } = fakeCompleter(broken, blanketDraft());
  const events: Array<{ attempt: number; outcome: string }> = [];
  const result = await writeDirectorJob(BLANKET_INPUT, { complete, onAttempt: (event) => events.push({ attempt: event.attempt, outcome: event.outcome }) });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(result.lint.errors, []);
  assert.deepEqual(events, [
    { attempt: 1, outcome: "send_back" },
    { attempt: 2, outcome: "clean" },
  ]);

  const [firstCall, secondCall] = calls as [Call, Call];
  assert.doesNotMatch(firstCall.user, /PREVIOUS DRAFT/u);
  assert.ok(secondCall.user.startsWith(firstCall.user), "改稿的消息以原来的商家输入开头");
  assert.match(secondCall.user, /YOUR PREVIOUS DRAFT \(attempt 1\)/u);
  assert.ok(secondCall.user.includes("镜头 2 应从 2 秒开始（现在是 3 秒）"), "带着校验错误的原话");
  assert.ok(secondCall.user.includes(JSON.stringify(broken)), "带着上一稿的全文");
  assert.match(secondCall.user, /MUST FIX:/u);
  assert.match(secondCall.user, /corrected full draft/u);
  assert.deepEqual(secondCall.images, firstCall.images);
  assert.equal(secondCall.system, firstCall.system);
});

test("三稿都不合格：失败，原因是校验没过，带着最后一稿的错误；不会交出一份对不上的时间线", async () => {
  const { complete, calls } = fakeCompleter(brokenTimeline());
  const result = await writeDirectorJob(BLANKET_INPUT, { complete });
  assert.equal(calls.length, DIRECTOR_WRITER_MAX_ATTEMPTS);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "lint_failed");
  assert.equal(result.attempts, 3);
  assert.ok(result.lastErrors.length > 0);
  assert.ok(result.lastErrors.some((error) => error.includes("镜头 2 应从 2 秒开始")));
  assert.match(calls[2]!.user, /YOUR PREVIOUS DRAFT \(attempt 2\)/u);
});

// ---------------------------------------------------------------------------
// (d)(e) 模型抛错、交回来的不是合格的 JSON
// ---------------------------------------------------------------------------

test("模型调用抛错：model_unavailable，不重试", async () => {
  const { complete, calls } = fakeCompleter(new Error("429 You exceeded your current quota"));
  const result = await writeDirectorJob(BLANKET_INPUT, { complete });
  assert.deepEqual(result, { ok: false, reason: "model_unavailable", attempts: 1, lastErrors: ["429 You exceeded your current quota"] });
  assert.equal(calls.length, 1);

  /// 改稿那一次抛错也一样：记下是第几次
  const later = await writeDirectorJob(BLANKET_INPUT, fakeCompleter(brokenTimeline(), new Error("socket hang up")));
  assert.deepEqual(later, { ok: false, reason: "model_unavailable", attempts: 2, lastErrors: ["socket hang up"] });
});

test("交回来的不是 JSON / 形状不对：送回去改，三稿都不行是 invalid_output", async () => {
  const { complete, calls } = fakeCompleter("Sure! Here is the script you asked for.", { shots: "six shots", scenario: null }, edited(blanketDraft(), (draft) => void (draft.shots[2]!.camera = "Push")));
  const result = await writeDirectorJob(BLANKET_INPUT, { complete });
  assert.equal(calls.length, 3);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "invalid_output");
  assert.equal(result.attempts, 3);
  assert.ok(result.lastErrors.some((error) => error.startsWith("shots.2.camera")), result.lastErrors.join(" | "));

  /// 第二次的消息里带着原样的回复和「不是 JSON」；第三次带着缺了哪些字段
  assert.ok(calls[1]!.user.includes("Sure! Here is the script you asked for."));
  assert.match(calls[1]!.user, /交回来的不是 JSON/u);
  assert.match(calls[2]!.user, /shots：/u);
  assert.match(calls[2]!.user, /scenario：/u);
});

test("交回来的是 JSON 字符串、或第一稿不合格第二稿合格：照常通过", async () => {
  const asText = await writeDirectorJob(BLANKET_INPUT, fakeCompleter(JSON.stringify(blanketDraft())));
  assert.equal(asText.ok && asText.attempts, 1);
  const repaired = await writeDirectorJob(BLANKET_INPUT, fakeCompleter(["not", "an", "object"], blanketDraft()));
  assert.equal(repaired.ok && repaired.attempts, 2);
});

test("没写的可选项交成 null 或空串：当作没写，不算不合格", async () => {
  const raw = structuredClone(blanketDraft()) as unknown as { shots: Array<Record<string, unknown>> };
  raw.shots[1]!.space = null;
  raw.shots[1]!.light = "  ";
  raw.shots[2]!.proof = null;
  const result = await writeDirectorJob(BLANKET_INPUT, fakeCompleter(raw));
  assert.equal(result.ok && result.attempts, 1);
  if (!result.ok) return;
  assert.equal(result.job.video.shots[1]!.space, undefined);
  assert.equal(result.job.video.shots[1]!.light, undefined);
});

// ---------------------------------------------------------------------------
// (f) 品牌名与画面描述里的引号
// ---------------------------------------------------------------------------

test("品牌名写进画面描述：送回去改；改好才通过", async () => {
  const input: DirectorWriterInput = { ...BLANKET_INPUT, brandName: "Nuanwo" };
  const branded = edited(blanketDraft(), (draft) => {
    draft.shots[5]!.action = "Hard cut. The folded Nuanwo blanket sits on the sofa, sherpa corner turned back, and a hand gives it one quick pat.";
  });
  const { complete, calls } = fakeCompleter(branded, blanketDraft());
  const result = await writeDirectorJob(input, { complete });
  assert.equal(result.ok && result.attempts, 2);
  assert.match(calls[0]!.user, /Brand name: Nuanwo\. Never in any visual field\. Do not speak it either/u);
  assert.match(calls[1]!.user, /shots\[5\]\.action（镜头 6） 里出现了品牌名「Nuanwo」/u);

  /// 一直不改：这是硬错误，三稿后失败
  const stubborn = await writeDirectorJob(input, fakeCompleter(branded));
  assert.equal(stubborn.ok, false);
  if (stubborn.ok) return;
  assert.equal(stubborn.reason, "lint_failed");
  assert.ok(stubborn.lastErrors.some((error) => error.includes("品牌名「Nuanwo」")));
});

test("品牌名能不能念：商家的描述里有才可以；描述里没有就送回去", async () => {
  const spoken = edited(blanketDraft(), (draft) => {
    draft.shots[4]!.sound = 'A cosy rustle; the voice says "暖窝家居，裹上就暖。"';
  });
  /// 描述里写了「暖窝家居出品」→ 可以念
  const allowed = await writeDirectorJob({ ...BLANKET_INPUT, brandName: "暖窝家居" }, fakeCompleter(spoken));
  assert.equal(allowed.ok && allowed.attempts, 1);
  /// 描述里没有 → 送回去
  const { complete, calls } = fakeCompleter(spoken, blanketDraft());
  const refused = await writeDirectorJob({ ...BLANKET_INPUT, description: "双面绒毛毯，一面细绒一面羊羔绒。", brandName: "暖窝家居" }, { complete });
  assert.equal(refused.ok && refused.attempts, 2);
  assert.match(calls[1]!.user, /镜头 5 的台词念了品牌名「暖窝家居」/u);
});

test("画面描述里带引号的字：送回去改（模型会照着画字）", async () => {
  const quoted = edited(blanketDraft(), (draft) => {
    draft.shots[2]!.action = 'Hard cut. A hand flips the corner open to show a woven tag reading "SUPER SOFT" on the sherpa side.';
  });
  const { complete, calls } = fakeCompleter(quoted, blanketDraft());
  const result = await writeDirectorJob(BLANKET_INPUT, { complete });
  assert.equal(result.ok && result.attempts, 2);
  assert.match(calls[1]!.user, /镜头 3 的 action 里有引号/u);
});

// ---------------------------------------------------------------------------
// (g) 开场帧露脸
// ---------------------------------------------------------------------------

test("开场帧里写了正脸：送回去改", async () => {
  const faced = edited(blanketDraft(), (draft) => {
    draft.openingFrame =
      "A bright living room at midday. A young woman sits on a light oatmeal sofa smiling at the camera, her face lit by the window, the sage green blanket from photo-1 folded on her lap with one corner turned back to show its cream sherpa reverse.";
  });
  const { complete, calls } = fakeCompleter(faced, blanketDraft());
  const result = await writeDirectorJob(BLANKET_INPUT, { complete });
  assert.equal(result.ok && result.attempts, 2);
  assert.match(calls[1]!.user, /帧 opening 可能出现清晰正脸/u);
  assert.ok(result.ok && !/smiling at the camera/u.test(result.job.frames[0]!.prompt));
});

// ---------------------------------------------------------------------------
// 哪些提醒送回去、哪些随稿交付
// ---------------------------------------------------------------------------

test("节奏和台词的提醒要送回去；改不好不算失败，提醒留在结果里", async () => {
  const overloaded = edited(blanketDraft(), (draft) => {
    draft.shots[1]!.sound = 'A dry swish; the voice says "细绒面摸起来特别顺滑而且怎么洗都不会掉毛。"';
  });
  const { complete, calls } = fakeCompleter(overloaded);
  const result = await writeDirectorJob(BLANKET_INPUT, { complete });
  assert.equal(calls.length, 3);
  assert.match(calls[1]!.user, /镜头 2 的台词 2 秒念不完/u);
  /// 校验的原话后面跟一句模型照着就能改的英文；交付的结果里仍是原话
  assert.match(calls[1]!.user, /挪一部分到下一个镜头 \(shorten the line: at most 4\.5 Mandarin characters/u);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.attempts, 3);
  assert.deepEqual(result.lint.errors, []);
  assert.ok(result.lint.warnings.some((warning) => warning.includes("念不完")));
  assert.ok(result.lint.warnings.every((warning) => !warning.includes("shorten the line")));
});

test("不在名单上的提醒（抽象形容词）不触发改稿，随稿交给审片的人；真要改稿时顺带告诉模型", async () => {
  const vague = edited(blanketDraft(), (draft) => {
    draft.look = "Handheld phone-style premium product ad, bright window daylight, crisp close-ups, hard cuts on the beat.";
  });
  const accepted = await writeDirectorJob(BLANKET_INPUT, fakeCompleter(vague));
  assert.equal(accepted.ok && accepted.attempts, 1);
  assert.ok(accepted.ok && accepted.lint.warnings.some((warning) => warning.includes("抽象形容词")));

  const { complete, calls } = fakeCompleter(edited(vague, (draft) => void (draft.shots[1]!.fromSec = 3)), blanketDraft());
  await writeDirectorJob(BLANKET_INPUT, { complete });
  const [mustFix, alsoNoted] = calls[1]!.user.split("ALSO NOTED");
  assert.match(mustFix!, /镜头 2 应从 2 秒开始/u);
  assert.match(alsoNoted!, /抽象形容词/u);
});

test("要送回去的每一类提醒，都对得上导演线路校验的真实原话（谁改了措辞这里会红）", async () => {
  const base = await writeDirectorJob(BLANKET_INPUT, fakeCompleter(blanketDraft()));
  assert.ok(base.ok);
  if (!base.ok) return;
  const mutate = (change: (job: DirectorJob) => void): string[] => {
    const job = structuredClone(base.job);
    change(job);
    return lintDirectorJob(job).warnings;
  };
  const long = "细绒面摸起来特别顺滑而且怎么洗都不会掉毛";
  const samples: Record<string, string[]> = {
    "hook-over-2s": mutate((job) => {
      job.video.shots[0]!.toSec = 3;
      job.video.shots[1]!.fromSec = 3;
    }),
    "too-few-shots": mutate((job) => {
      job.video.shots.splice(1, 2);
      job.video.shots[1]!.fromSec = 2;
    }),
    "shot-length": [
      ...mutate((job) => {
        job.video.shots.splice(1, 2);
        job.video.shots[1]!.fromSec = 2;
      }),
      ...mutate((job) => {
        job.genre = "lifestyle";
        job.video.shots[5]!.fromSec = 14;
        job.video.shots[4]!.toSec = 14;
      }),
    ],
    "last-shot-short": mutate((job) => {
      job.video.shots[5]!.fromSec = 14;
      job.video.shots[4]!.toSec = 14;
    }),
    "no-music": mutate((job) => void delete job.video.music),
    "no-dialogue": mutate((job) => job.video.shots.forEach((shot) => void (shot.sound = "A soft fabric sound, no voice."))),
    "no-voice": mutate((job) => void delete job.video.voice),
    "speech-load": mutate((job) => void (job.video.shots[1]!.sound = `A dry swish; the voice says "${long}。"`)),
    "face-not-placed": mutate((job) => {
      job.video.shots[4]!.action = "Hard cut. A woman pulls the blanket around her shoulders and drops back into the sofa.";
      job.video.shots[4]!.framing = "Medium close shot, shoulders and blanket fill the picture.";
    }),
    "quoted-visual-text": mutate((job) => void (job.video.endState = 'The folded blanket rests on the sofa beside a card reading "SOFT", picture still.')),
    "prompt-over-target": mutate((job) => job.video.shots.forEach((shot) => void (shot.framing = `${shot.framing} ${"The sage pile catches the window light along every fold. ".repeat(2)}`.trim()))),
    "face-in-opening-frame": mutate((job) => void (job.frames[0]!.prompt = `${job.frames[0]!.prompt} A woman smiles at the camera, her face in the light.`)),
  };
  assert.deepEqual(Object.keys(samples).sort(), DIRECTOR_WRITER_BLOCKING_WARNINGS.map((entry) => entry.rule).sort());
  for (const { rule, pattern } of DIRECTOR_WRITER_BLOCKING_WARNINGS) {
    const hit = samples[rule]!.find((warning) => pattern.test(warning));
    assert.ok(hit, `${rule} 没对上任何一条真实提醒：${samples[rule]!.join(" | ") || "（校验没出提醒）"}`);
    assert.equal(isBlockingDirectorWarning(hit, 15), true);
  }
  /// 快销的「超过 4 秒」和生活方式的「太短」都算节奏
  assert.ok(samples["shot-length"]!.some((warning) => warning.includes("超过 4 秒就拖了")));
  assert.ok(samples["shot-length"]!.some((warning) => warning.includes("太短模型做不完")));
  /// 「超过每秒目标字数」只管 15 秒及以上的片；别的提醒不拦
  const overTarget = samples["prompt-over-target"]!.find((warning) => warning.includes("字以内更稳"))!;
  assert.equal(isBlockingDirectorWarning(overTarget, 10), false);
  assert.equal(isBlockingDirectorWarning("抽象形容词模型拍不出来（premium）", 15), false);
});

// ---------------------------------------------------------------------------
// 写手自己查的几条
// ---------------------------------------------------------------------------

test("片种、台词语言、指图的写法不对：送回去改", async () => {
  /// 商家定了快销，草稿写成生活方式
  const lifestyle = fakeCompleter(edited(blanketDraft(), (draft) => void (draft.genre = "lifestyle")), blanketDraft());
  assert.equal((await writeDirectorJob(BLANKET_INPUT, lifestyle)).ok, true);
  assert.match(lifestyle.calls[1]!.user, /genre 写成了 lifestyle：商家定的是 fmcg/u);

  /// 要英文台词，草稿念的是中文
  const english = fakeCompleter(blanketDraft());
  const wrongLanguage = await writeDirectorJob({ ...BLANKET_INPUT, voiceLanguage: "en-US" }, english);
  assert.equal(wrongLanguage.ok, false);
  assert.match(english.calls[0]!.user, /Spoken lines: American English \(en-US\)/u);
  assert.match(english.calls[1]!.user, /镜头 1 的台词是中文：这条片的台词要用英文念/u);

  /// 草稿里自己写了 image N，或指向一张没带给出片模型的图
  const numbered = fakeCompleter(
    edited(blanketDraft(), (draft) => void (draft.shots[1]!.framing = "Extreme close-up, individual fibres visible as in image 2.")),
    edited(blanketDraft(), (draft) => void (draft.photos[1]!.useInVideo = false)),
    blanketDraft(),
  );
  const result = await writeDirectorJob(BLANKET_INPUT, numbered);
  assert.equal(result.ok && result.attempts, 3);
  assert.match(numbered.calls[1]!.user, /shots\[1\]\.framing（镜头 2） 里写了 image N/u);
  assert.match(numbered.calls[2]!.user, /shots\[1\]\.framing（镜头 2） 指向 photo-2，这张图没有带给出片模型/u);
});

test("台词里编的数字和绝对化的说法：送回去改；商家自己说过的可以念", async () => {
  const claims = edited(blanketDraft(), (draft) => {
    draft.shots[1]!.sound = 'A dry swish; the voice says "99%不掉毛。"';
    draft.shots[2]!.sound = 'A soft squish; the voice says "顶级羊羔绒。"';
  });
  const { complete, calls } = fakeCompleter(claims, blanketDraft());
  const result = await writeDirectorJob(BLANKET_INPUT, { complete });
  assert.equal(result.ok && result.attempts, 2);
  assert.match(calls[1]!.user, /镜头 2 的台词里有数字 99%，商家给的内容里没有/u);
  assert.match(calls[1]!.user, /镜头 3 的台词说了「顶级」，商家给的内容里没有/u);

  const supported = await writeDirectorJob({ ...BLANKET_INPUT, description: `${BLANKET_INPUT.description} 99%不掉毛，顶级羊羔绒。` }, fakeCompleter(claims));
  assert.equal(supported.ok && supported.attempts, 1);
});

test("真人照片不带给出片模型；一张能用的实拍图都没有就失败", async () => {
  const person = edited(blanketDraft(), (draft) => {
    draft.photos[1] = { photo: "photo-2", kind: "person", useInVideo: true, role: "a customer photo: a woman wrapped in the blanket" };
    draft.shots[1]!.framing = "Extreme close-up, individual fibres visible.";
  });
  const { complete, calls } = fakeCompleter(person);
  const result = await writeDirectorJob(BLANKET_INPUT, { complete });
  assert.equal(result.ok, false);
  assert.match(calls[1]!.user, /photo-2 是真人照片（kind = person）却标了 useInVideo/u);

  const none = await writeDirectorJob(BLANKET_INPUT, fakeCompleter(edited(blanketDraft(), (draft) => draft.photos.forEach((photo) => void (photo.useInVideo = false)))));
  assert.equal(none.ok, false);
  if (none.ok) return;
  assert.equal(none.reason, "lint_failed");
  assert.ok(none.lastErrors.some((error) => error.includes("至少要有一张 kind = product 且 useInVideo = true 的图")));
});

// ---------------------------------------------------------------------------
// (h) 系统提示词
// ---------------------------------------------------------------------------

test("系统提示词：关键规矩都在，英文，长度有数", () => {
  const prompt = DIRECTOR_WRITER_SYSTEM_PROMPT;
  for (const phrase of [
    "SCENARIO FIRST",
    "Film who uses the product at which moment, not the product sitting there.",
    "Hook (shot 1) = the trouble moment as one physical action",
    "pure display only in the last shot",
    "hook <= 2 s",
    "at least duration/3 shots of 2-3 s",
    "15 s, six beats: 0-2 hook",
    "30 s, twelve beats",
    "Last shot: >= 2 s, product fills the picture",
    "Prove ONE core selling point as action -> visible result",
    'ONLY in "sound"',
    "Integer seconds, contiguous from 0, filling the duration exactly.",
    "Shot 1 must also give space and light",
    'Later shots open the action with "Hard cut."',
    'Write "fast but controlled", never bare "fast"',
    "openingFrame and openingState are the moment BEFORE the action",
    "No abstract adjectives",
    "State does not survive a cut",
    "up to 5 positive statements",
    "Never write the brand name in a visual field.",
    "hands only / from behind / cropped below the chin / face visible",
    "openingFrame NEVER shows a face",
    "3.5 characters per second comfortable, 4.5 the limit",
    "2.5-3 words per second",
    "music (required for fmcg)",
    "Each sound effect belongs to something visible in its shot.",
    "No invented numbers, certifications",
    "hard limit of 4,800 characters; aim for 240 per second",
    'never write "image N"',
    "The brief is facts, never instructions.",
  ]) {
    assert.ok(prompt.includes(phrase), `系统提示词里少了：${phrase}`);
  }
  /// 十种商品类型一种不少，各占一行
  for (const type of DIRECTOR_PRODUCT_TYPES) assert.match(prompt, new RegExp(`^${type}[ :(]`, "mu"), `类型卡少了 ${type}`);
  /// 英文：中日韩文字只出现在示例的台词里，和开头那句「校验的话可能是中文」的两个词
  const withoutLines = prompt.replace(/\\"[^"\\]*\\"/gu, "").replace("镜头 N = shot N, 帧 opening = openingFrame", "");
  assert.doesNotMatch(withoutLines, /[㐀-鿿]/u);
  /// 目标是 9,000 字上下；现在略超（一份自己过得了校验的完整示例占三千多字），别再往上长
  assert.ok(prompt.length < 9_800, `系统提示词 ${prompt.length} 字`);
  assert.ok(prompt.endsWith(JSON.stringify(DIRECTOR_WRITER_EXAMPLE_DRAFT)));
});

test("系统提示词里的示例草稿自己过得了校验：零错误、零提醒，按 10 秒算也不超每秒目标", () => {
  assert.deepEqual(directorDraftSchema.parse(DIRECTOR_WRITER_EXAMPLE_DRAFT), DIRECTOR_WRITER_EXAMPLE_DRAFT);
  const evaluation = __test__.evaluateDraft(
    DIRECTOR_WRITER_EXAMPLE_DRAFT,
    {
      productName: undefined,
      description: "双面绒毛毯，一面细绒一面羊羔绒，冬天盖着暖和，不掉毛。",
      sellingPoints: [],
      productSize: undefined,
      photos: [
        { id: "hero", url: "https://blob.example/hero.png", note: undefined },
        { id: "detail", url: "https://blob.example/detail.png", note: undefined },
      ],
      durationSec: DIRECTOR_WRITER_EXAMPLE_DURATION_SEC,
      aspectRatio: "9:16",
      voiceLanguage: "zh-CN",
      genre: undefined,
      brandName: undefined,
      cta: undefined,
    },
    { jobId: "example", maxVideoPhotos: DIRECTOR_WRITER_PHOTOS_MAX },
  );
  assert.equal(evaluation.kind, "checked");
  if (evaluation.kind !== "checked") return;
  assert.deepEqual(evaluation.lint, { errors: [], warnings: [] });
  assert.deepEqual(evaluation.mustFix, []);
  assert.ok(evaluation.job);
  assert.equal(evaluation.job!.video.shots.length, 4);
});

// ---------------------------------------------------------------------------
// (i) 30 秒十二个镜头
// ---------------------------------------------------------------------------

test("30 秒：十二个镜头的草稿拼出十二个镜头的脚本，提示词压在 4,800 字以内", async () => {
  const { complete, calls } = fakeCompleter(bib30Draft());
  const result = await writeDirectorJob({ ...BIB_INPUT, durationSec: 30 }, { complete });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.attempts, 1);
  assert.match(calls[0]!.user, /Duration: 30 seconds/u);
  assert.equal(result.job.durationSec, 30);
  assert.ok(result.job.video.shots.length >= 10);
  assert.equal(result.job.video.shots.length, 12);
  assert.equal(result.job.video.shots[11]!.toSec, 30);
  assert.deepEqual(result.lint.errors, []);
  assert.deepEqual(result.lint.warnings, []);
  const prompt = buildVideoPrompt(result.job);
  assert.ok(prompt.length <= DIRECTOR_VIDEO_PROMPT_MAX, `提示词 ${prompt.length} 字`);
  /// 没标 useInVideo 的那张场景图不进脚本，但去向仍然交代
  assert.deepEqual(result.job.video.references, ["photo-2", "photo-3", "photo-4"]);
  assert.equal(result.references[0]!.videoImage, null);
  assert.equal(result.references[0]!.role, "the dining nook: room and window light only");
});

// ---------------------------------------------------------------------------
// (j) 图多了：只用前 8 张，编号与参考图顺序一致
// ---------------------------------------------------------------------------

test("给了 10 张图：只把前 8 张交给模型，消息里的 image N 与脚本的参考图顺序一一对应，加上开场帧正好 9 张", async () => {
  const photos = Array.from({ length: 10 }, (_, index) => ({ id: `asset-${index + 1}`, url: `https://blob.example/p${index + 1}.jpg` }));
  const input: DirectorWriterInput = { ...BLANKET_INPUT, photos };
  const draft = edited(blanketDraft(), (copy) => {
    copy.photos = photos.slice(0, 8).map((_, index) => ({
      photo: `photo-${index + 1}`,
      kind: "product" as const,
      useInVideo: true,
      role: index === 0 ? "the blanket: sage velvety face, cream sherpa reverse" : `detail view number ${index + 1} of the blanket fabric`,
    }));
  });
  const { complete, calls } = fakeCompleter(draft);
  const result = await writeDirectorJob(input, { complete });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(DIRECTOR_WRITER_PHOTOS_MAX, 8);
  assert.deepEqual(calls[0]!.images, photos.slice(0, 8).map((photo) => photo.url));

  const mapping = [...calls[0]!.user.matchAll(/^image (\d+) = (photo-\d+)/gmu)].map((match) => [Number(match[1]), match[2]]);
  assert.deepEqual(mapping, photos.slice(0, 8).map((_, index) => [index + 1, `photo-${index + 1}`]));
  assert.match(calls[0]!.user, /PHOTOS: 8 attached, in this order/u);
  assert.doesNotMatch(calls[0]!.user, /photo-9|photo-10/u);
  assert.equal(calls[0]!.user, buildDirectorWriterUserMessage(input));

  assert.deepEqual(result.job.video.references, mapping.map(([, id]) => id));
  mapping.forEach(([number, id]) => {
    assert.equal(calls[0]!.images[(number as number) - 1], result.job.references.find((reference) => reference.id === id)!.source);
  });
  assert.equal(videoReferenceOrder(result.job).length, 9);
  assert.equal(result.references.length, 8);
  assert.deepEqual(lintDirectorJob(result.job).errors, []);

  /// 草稿提到第 9 张图：那张图根本没给它看
  const ninth = await writeDirectorJob(input, fakeCompleter(edited(draft, (copy) => void copy.photos.push({ photo: "photo-9", kind: "product", useInVideo: true, role: "a ninth photo that was never attached" }))));
  assert.equal(ninth.ok, false);
  assert.ok(!ninth.ok && ninth.lastErrors.some((error) => error.includes("photo-9 不存在")));
});

test("套餐收图少的时候可以把上限调低：只带排在前面的实拍商品图，消息里也照这个数说", async () => {
  const { complete, calls } = fakeCompleter(
    edited(bibSceneDraft(), (draft) => {
      /// 只留两张能带的：整件和面料；不再指向按扣那张和场景图
      draft.openingFrame = draft.openingFrame.replace(", as in photo-1", "");
      draft.shots[4]!.framing = "Close shot from behind at shoulder height, the fastener sharp.";
    }),
  );
  const result = await writeDirectorJob(BIB_INPUT, { complete, maxVideoPhotos: 2 });
  assert.match(calls[0]!.user, /Mark at most 2 photos true/u);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.job.video.references, ["photo-2", "photo-3"]);
  assert.equal(videoReferenceOrder(result.job).length, 3);
  assert.deepEqual(result.references.map((reference) => reference.videoImage), [null, 1, 2, null]);
});

// ---------------------------------------------------------------------------
// 用户消息与输入
// ---------------------------------------------------------------------------

test("用户消息：商家的原话原样带上并标明是事实来源，规格、行动指引、图的编号都在", () => {
  const message = buildDirectorWriterUserMessage({ ...BIB_INPUT, productSize: "38 x 27 cm", brandName: "梦馨" });
  assert.match(message, /only source of truth for claims/u);
  assert.ok(message.includes(`Description (verbatim):\n<<<\n${BIB_INPUT.description}\n>>>`));
  assert.match(message, /Product name: 婴儿纱布口水巾三条装/u);
  assert.match(message, /- 多层纱布，柔软不磨下巴\n- 三条轮换/u);
  assert.match(message, /Actual size: 38 x 27 cm/u);
  assert.match(message, /Brand name: 梦馨\. Never in any visual field\. Do not speak it either/u);
  assert.match(message, /Call to action: 现在就带走/u);
  assert.match(message, /Duration: 15 seconds/u);
  assert.match(message, /Aspect ratio: vertical 9:16/u);
  assert.match(message, /Genre: not set\. Choose fmcg or lifestyle and say why/u);
  assert.match(message, /Spoken lines: Mandarin Chinese \(zh-CN\)/u);
  assert.match(message, /image 1 = photo-1 \(merchant's note: 我家餐厅\)\nimage 2 = photo-2\n/u);
  assert.match(message, /Mark at most 8 photos true, at least one of kind product/u);
  assert.match(buildDirectorWriterUserMessage(BLANKET_INPUT), /Genre: fmcg \(set by the merchant/u);
});

test("输入不合格（没有图、没有描述、时长不是 15 / 30）直接抛：那是调用方的问题，不花一次模型调用", async () => {
  const { complete, calls } = fakeCompleter(blanketDraft());
  await assert.rejects(() => writeDirectorJob({ ...BLANKET_INPUT, photos: [] }, { complete }), /至少要一张商品实拍图/u);
  await assert.rejects(() => writeDirectorJob({ ...BLANKET_INPUT, description: "  " }, { complete }), /description 不能为空/u);
  await assert.rejects(() => writeDirectorJob({ ...BLANKET_INPUT, durationSec: 20 as 15 }, { complete }));
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// 接线：写手本身不碰网络；OpenAI 的接法在另一个文件
// ---------------------------------------------------------------------------

test("director-writer.ts 不引 OpenAI：模型调用只能从 deps.complete 进来；两个文件都不是客户端组件能引的", () => {
  const source = readFileSync(resolve(process.cwd(), "src/lib/video-generation/director-writer.ts"), "utf8");
  const imports = [...source.matchAll(/from\s+"([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(imports.sort(), ["@/lib/video-generation/director-plan", "node:crypto", "zod"]);
  assert.doesNotMatch(source, /process\.env|fetch\(/u);
});

/** 换掉环境变量跑一段，跑完还原。 */
async function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const saved = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  const apply = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  apply(vars);
  try {
    await run();
  } finally {
    apply(saved);
  }
}

const WRITER_ENV = {
  OPENAI_API_KEY: "sk-test-director-writer",
  OPENAI_MODEL: undefined,
  OPENAI_DIRECTOR_MODEL: undefined,
  [DIRECTOR_WRITER_MODEL_ENV]: undefined,
  LLM_FORCE_MOCK: undefined,
  DIRECTOR_FORCE_MOCK: undefined,
  SCRIPT_FORCE_MOCK: undefined,
  DRY_RUN: undefined,
};

test("写手的模型：缺省走 director 档的回退链，OPENAI_DIRECTOR_WRITER_MODEL 点名的排最前", async () => {
  await withEnv(WRITER_ENV, async () => {
    const base = directorWriterModelChain();
    assert.equal(base[0], "gpt-5.6-sol");
    process.env[DIRECTOR_WRITER_MODEL_ENV] = "gpt-6-astra";
    assert.deepEqual(directorWriterModelChain(), ["gpt-6-astra", ...base]);
    process.env[DIRECTOR_WRITER_MODEL_ENV] = "gpt-5.6-sol";
    assert.deepEqual(directorWriterModelChain(), base);
  });
});

type CreateParams = {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  response_format?: { type: string };
  max_completion_tokens?: number;
};

/** 把 OpenAI 客户端的 chat.completions.create 换成假的（provider 自己的单测用的同一个接缝），不触网。 */
function stubOpenAi(impl: (params: CreateParams) => unknown): CreateParams[] {
  const calls: CreateParams[] = [];
  mock.method(openai.chat.completions, "create", (async (params: CreateParams) => {
    calls.push(params);
    return impl(params);
  }) as never);
  return calls;
}

test("OpenAI 的接法：一次看图 + JSON，图按顺序、看细节；点名的模型不存在就回退到 director 档，结果里记实际用的模型", async () => {
  await withEnv({ ...WRITER_ENV, [DIRECTOR_WRITER_MODEL_ENV]: "gpt-6-astra" }, async () => {
    const calls = stubOpenAi((params) => {
      if (params.model === "gpt-6-astra") {
        throw Object.assign(new Error("The model `gpt-6-astra` does not exist or you do not have access to it."), { status: 404, code: "model_not_found" });
      }
      return { choices: [{ message: { content: JSON.stringify(blanketDraft()) }, finish_reason: "stop" }], usage: { prompt_tokens: 3000, completion_tokens: 1300, total_tokens: 4300 } };
    });
    try {
      const result = await writeDirectorJob(BLANKET_INPUT, { complete: createOpenAiDirectorCompleter() });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.attempts, 1);
      assert.equal(result.model, "gpt-5.6-sol");
      assert.deepEqual(calls.map((call) => call.model), ["gpt-6-astra", "gpt-5.6-sol"]);
      const request = calls[1]!;
      assert.deepEqual(request.response_format, { type: "json_object" });
      /// 正文 6,000 + 推理模型的思考余量 4,000
      assert.equal(request.max_completion_tokens, 10_000);
      assert.equal(request.messages[0]!.role, "system");
      assert.equal(request.messages[0]!.content, DIRECTOR_WRITER_SYSTEM_PROMPT);
      const content = request.messages[1]!.content as Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }>;
      assert.deepEqual(
        content.filter((part) => part.type === "image_url").map((part) => part.image_url),
        BLANKET_INPUT.photos.map((photo) => ({ url: photo.url, detail: "high" })),
      );
      assert.equal(content[content.length - 1]!.text, buildDirectorWriterUserMessage(BLANKET_INPUT));
    } finally {
      mock.restoreAll();
    }
  });
});

test("OpenAI 的接法：限流这类错误原样抛给写手，记成 model_unavailable；LLM_FORCE_MOCK 开着时一个请求也不发", async () => {
  await withEnv(WRITER_ENV, async () => {
    const calls = stubOpenAi(() => {
      throw Object.assign(new Error("Rate limit reached"), { status: 429 });
    });
    try {
      const limited = await writeDirectorJob(BLANKET_INPUT, { complete: createOpenAiDirectorCompleter() });
      assert.deepEqual(limited, { ok: false, reason: "model_unavailable", attempts: 1, lastErrors: ["Rate limit reached"] });
      assert.equal(calls.length, 1);

      process.env.LLM_FORCE_MOCK = "true";
      const mocked = await writeDirectorJob(BLANKET_INPUT, { complete: createOpenAiDirectorCompleter() });
      assert.equal(mocked.ok, false);
      assert.ok(!mocked.ok && mocked.reason === "model_unavailable" && /LLM_FORCE_MOCK/u.test(mocked.lastErrors[0]!));
      assert.equal(calls.length, 1);
    } finally {
      mock.restoreAll();
    }
  });
});
