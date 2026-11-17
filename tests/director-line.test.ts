/**
 * 线上创作台的导演线路（2026-11-17，线上对齐第 2 步）：建故事板时由导演写手写镜头脚本、只出一张开场帧，
 * 出片时整条一次生成，提示词和参考图顺序与 `npm run director` 一模一样。
 * 这里守：什么时候走这条线路、脚本怎么存怎么读、参考图顺序、方案只有一个 AI 段、字幕时间、写不成怎么退回。
 */
process.env.LLM_FORCE_MOCK = "true";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DIRECTOR_LINE_MAX_PHOTOS,
  DIRECTOR_SCRIPT_KIND,
  directorCaptionScript,
  directorOpeningFrame,
  directorScriptSpeechWords,
  directorScriptView,
  directorVideoPrompt,
  directorVideoReferenceUrls,
  directorVoiceLanguage,
  isStoredDirectorScript,
  packDirectorScript,
  readStoredDirectorScript,
  writeDirectorScriptForStoryboard,
} from "../src/lib/video-generation/director-line";
import {
  DIRECTOR_LINE_BLOCKER_MESSAGE,
  DIRECTOR_LINE_TEMPLATE_ID,
  DIRECTOR_FEATURED_STYLE_IDS,
  DIRECTOR_STYLES,
  DIRECTOR_STYLE_GROUPS,
  directorLineApplies,
  directorLineBlocker,
  directorStyle,
} from "../src/lib/video-generation/director-line-policy";
import { DIRECTOR_STYLE_BRIEFS, directorStyleBrief } from "../src/lib/video-generation/director-style-briefs";
import { buildVideoPrompt, cornerLogoFilter, parseDirectorJob } from "../src/lib/video-generation/director-plan";
import { buildPlan } from "../src/lib/video-generation/generation-supervisor";
import { mapPlanToDirectorPlan } from "../src/lib/video-generation/plan-to-director";
import { parseDirectorPlan } from "../src/lib/schemas/director-plan";
import { readStoredVisualReference } from "../src/lib/video-generation/visual-reference-analysis";
import { planningDegradationNotice } from "../src/lib/video-generation/planning-degradation-notice";
import { PLANNING_FALLBACK_BY_STAGE } from "../src/lib/video-generation/planning-degradation";
import { selectAuditedImage2Plan, parseShuyuCatalog } from "../src/lib/providers/shuyu-catalog";
import type { UnifiedVideoGenerationRequest } from "../src/types/video-generation";
import type { TestContext } from "node:test";
import { db } from "../src/lib/db";
import {
  __test__ as storyboardTest,
  StoryboardRequestError,
  createStoryboardRun,
  expectedStoryboardFrameCount,
} from "../src/lib/video-generation/storyboard-service";
import { DIRECTOR_OPENING_FRAME_BEAT, storyboardBeatLabel } from "../src/lib/video-generation/storyboard-beats";

const PHOTO_A = "https://blob.example.com/owner/bib-set.jpg";
const PHOTO_B = "https://blob.example.com/owner/bib-edge.jpg";
const OPENING_FRAME = "https://blob.example.com/owner/storyboard/opening.png";

function job(durationSec: 15 | 30 = 15) {
  const shots =
    durationSec === 15
      ? [
          { fromSec: 0, toSec: 2, line: "喂一口，漏半口？" },
          { fromSec: 2, toSec: 5, line: "有它接着，衣服不脏。" },
          { fromSec: 5, toSec: 8, line: "多层纱布，软到不磨下巴。" },
          { fromSec: 8, toSec: 10, line: null },
          { fromSec: 10, toSec: 12, line: "轻轻一按就戴好。" },
          { fromSec: 12, toSec: 15, line: "三条装，现在就带走！" },
        ]
      : Array.from({ length: 12 }, (_, index) => ({
          fromSec: index < 6 ? index * 2 : 12 + (index - 6) * 3,
          toSec: index < 6 ? index * 2 + 2 : 15 + (index - 6) * 3,
          line: index === 3 ? null : `第${index + 1}句台词。`,
        }));
  return parseDirectorJob({
    id: "sb-test-bib",
    title: "婴儿口水巾 · 快销版",
    genre: "fmcg",
    productType: "soft",
    aspectRatio: "9:16",
    durationSec,
    references: [
      { id: "photo-1", source: PHOTO_A, kind: "product", role: "the three triangular gauze baby bibs; ignore the background" },
      { id: "photo-2", source: PHOTO_B, kind: "product", role: "fabric close-up: gauze weave and stitched edge" },
    ],
    frames: [
      {
        id: "opening",
        references: ["photo-1", "photo-2"],
        variants: 1,
        prompt:
          "A bright home dining nook at midday. A baby in a high chair, cropped below the nose, wears the mustard gauze bib from image 1 while an adult hand holds a spoon of puree at the lips.",
      },
    ],
    video: {
      openingFrame: "opening",
      references: ["photo-1", "photo-2"],
      logline: "A baby spills lunch and the gauze bib catches it, then hands show its layers and fastener.",
      look: "Handheld phone-style e-commerce ad, bright daylight, close shots, hard cuts on the beat.",
      openingState: "The baby sits in the high chair in a clean mustard bib and a hand holds a spoon at the lips.",
      voice: "a bright warm young mother's voice speaking Mandarin, upbeat and close-mic",
      music: "light bouncy pop beat around 115 bpm with ukulele and claps",
      shots: shots.map((shot, index) => ({
        fromSec: shot.fromSec,
        toSec: shot.toSec,
        action: `${index === 0 ? "" : "Hard cut. "}Hands only: a hand shows step ${index + 1} of the bib on the high chair tray.`,
        ...(index === 0 ? { space: "High chair, white tray, window on the left.", light: "Bright soft window daylight." } : {}),
        framing: "Close shot from the front at chest height.",
        camera: "Locked off.",
        sound: shot.line ? `A soft rustle; the voice says "${shot.line}"` : "A soft fabric rustle.",
      })),
      endState: "The three bibs rest fanned on the table in bright daylight, picture still.",
      throughout: ["the bibs stay exactly as image 1 in colour, weave and fasteners"],
    },
  });
}

function stored(durationSec: 15 | 30 = 15) {
  return packDirectorScript({
    job: job(durationSec),
    scenario: {
      who: "六个月到一岁的宝宝用，妈妈买",
      where: "家里的餐椅上",
      moment: "喂辅食，喂一口漏半口",
      trouble: "米糊掉到衣服上",
      after: "米糊落在口水巾上",
      emotion: "宝宝笑，妈妈省心",
      productType: "soft",
      productTypeReason: "a gauze bib is a soft good",
      genre: "fmcg",
      genreReason: "the merchant wants to sell",
    },
    model: "gpt-5.6-sol",
    attempts: 2,
    warnings: ["镜头 4 没有台词"],
  });
}

// ---------------------------------------------------------------------------
// 什么时候走导演线路
// ---------------------------------------------------------------------------

test("导演线路做得了的：有实拍图的 15 / 30 秒片，风格是自动匹配或风格卡里的一种", () => {
  const base = { durationSec: 15, productImageCount: 2, styleTemplateId: null };
  assert.equal(directorLineBlocker(base), null);
  assert.equal(directorLineApplies(base), true);
  assert.equal(directorLineApplies({ ...base, durationSec: 30 }), true);
  assert.equal(directorLineApplies({ ...base, styleTemplateId: "" }), true);
  for (const style of DIRECTOR_STYLES) {
    assert.equal(directorLineBlocker({ ...base, styleTemplateId: style.id }), null, style.id);
  }
});

test("做不了的当场说清原因（没有退路）：没有实拍图、别的时长、带主播参考图、下线的老模板", () => {
  const base = { durationSec: 15, productImageCount: 2, styleTemplateId: null };
  assert.equal(directorLineBlocker({ ...base, productImageCount: 0 }), "no_product_photo");
  assert.equal(directorLineBlocker({ ...base, durationSec: 60 }), "duration");
  assert.equal(directorLineBlocker({ ...base, durationSec: 10 }), "duration");
  assert.equal(directorLineBlocker({ ...base, personImageCount: 1 }), "person_reference");
  assert.equal(directorLineBlocker({ ...base, styleTemplateId: "commerce-food-sizzle" }), "template");
  /// 没图排在最前：商家先看到「请上传商品图」，不是一句时长不对
  assert.equal(directorLineBlocker({ durationSec: 60, productImageCount: 0 }), "no_product_photo");
  for (const message of Object.values(DIRECTOR_LINE_BLOCKER_MESSAGE)) {
    assert.match(message, /[\u4e00-\u9fff]/u);
    assert.doesNotMatch(message, /DIRECTOR|blocker|undefined/u);
  }
});

test("风格卡：二十来种分五组，id 不重复，都有中英文名和一句话说明；拍法要求是英文、不写商品事实、够写手用", () => {
  assert.ok(DIRECTOR_STYLES.length >= 20 && DIRECTOR_STYLES.length <= 24, `现在 ${DIRECTOR_STYLES.length} 种`);
  assert.equal(new Set(DIRECTOR_STYLES.map((style) => style.id)).size, DIRECTOR_STYLES.length);
  assert.equal(new Set(DIRECTOR_STYLES.map((style) => style.zh)).size, DIRECTOR_STYLES.length, "中文名不重复");
  assert.equal(DIRECTOR_STYLES[0]!.id, DIRECTOR_LINE_TEMPLATE_ID);
  const groupIds = DIRECTOR_STYLE_GROUPS.map((group) => group.id);
  assert.deepEqual(groupIds, ["sell", "seed", "texture", "story", "place"]);
  for (const group of DIRECTOR_STYLE_GROUPS) {
    assert.ok(DIRECTOR_STYLES.some((style) => style.group === group.id), `${group.zh} 组不能是空的`);
  }
  for (const style of DIRECTOR_STYLES) {
    assert.match(style.id, /^tpl_[a-z_]+$/u);
    assert.ok(style.zh.length >= 2 && style.zh.length <= 6, `${style.id} 中文名要短：下拉里放得下`);
    assert.ok(style.en.length > 0 && style.hintZh.length > 0 && style.hintEn.length > 0);
    assert.ok(style.hintZh.length <= 40, `${style.id} 的一句话说明要短：手机上显示成一两行`);
    assert.doesNotMatch(directorStyleBrief(style.id)!, /[\u4e00-\u9fff]/u, `${style.id} 的拍法要求全程英文`);
    assert.ok(directorStyleBrief(style.id)!.length >= 200 && directorStyleBrief(style.id)!.length <= 900, `${style.id} brief 长度 ${directorStyleBrief(style.id)!.length}`);
    assert.ok(["fmcg", "lifestyle"].includes(style.genre));
    assert.ok(groupIds.includes(style.group), style.id);
    /// 和导演规则对着干的写法不许进风格：对着镜头说话、让模型画字
    assert.doesNotMatch(directorStyleBrief(style.id)!, /talks? to (the )?camera,|speaks? to (the )?camera|on-screen text|caption (says|reads)|price tag/iu, style.id);
    assert.equal(directorStyle(style.id), style);
  }
  assert.equal(directorStyle(null), null);
  assert.equal(directorStyle("auto"), null);
  /// 客户点名要的那种：情绪种草要有正脸表情镜头
  assert.match(directorStyleBrief("tpl_emotion_story")!, /face visible/u);
  /// 质感特写不露脸、是慢节奏片种
  assert.equal(directorStyle("tpl_texture_closeup")!.genre, "lifestyle");
  /// 促销：价格只在口播里说、只说商家给的事实
  assert.match(directorStyleBrief("tpl_offer_promo")!, /only in spoken lines and only with facts given in the description/u);
  /// 新人向导先摆出来的几种都在表里
  assert.equal(DIRECTOR_FEATURED_STYLE_IDS.length, 6);
  for (const id of DIRECTOR_FEATURED_STYLE_IDS) assert.ok(directorStyle(id), id);
  /// 拍法要求只在服务端：两边 id 一一对应；会进浏览器的 policy 文件和创作页里都没有这些要求
  assert.deepEqual(Object.keys(DIRECTOR_STYLE_BRIEFS).sort(), DIRECTOR_STYLES.map((style) => style.id).sort());
  assert.equal(directorStyleBrief(null), null);
  const policySource = readFileSync("src/lib/video-generation/director-line-policy.ts", "utf8");
  assert.doesNotMatch(policySource, /brief:\s*\n?\s*"/);
  assert.doesNotMatch(readFileSync("src/components/video-generation/streamlined-video-studio.tsx", "utf8"), /director-style-briefs/);
});

// ---------------------------------------------------------------------------
// 脚本怎么存、怎么读
// ---------------------------------------------------------------------------

test("脚本存进故事板那一列再读回来是同一份；旧的视觉盘点和脚本互不误读", () => {
  const record = stored();
  assert.equal(record.kind, DIRECTOR_SCRIPT_KIND);
  assert.equal(isStoredDirectorScript(record), true);
  /// 过一遍 JSON（入库出库）
  const read = readStoredDirectorScript(JSON.parse(JSON.stringify(record)));
  assert.ok(read);
  assert.deepEqual(read.job, job());
  assert.equal(read.model, "gpt-5.6-sol");
  assert.equal(read.attempts, 2);
  assert.equal(read.scenario?.where, "家里的餐椅上");
  /// 同一列里以前放的是视觉盘点：按盘点读脚本 → null；按脚本读盘点 → null
  assert.equal(readStoredVisualReference(record), null);
  const inventory = { photoCount: 2, productDescription: "a gauze bib", isRealLocation: false };
  assert.equal(isStoredDirectorScript(inventory), false);
  assert.equal(readStoredDirectorScript(inventory), null);
  for (const junk of [null, undefined, "x", [], { kind: DIRECTOR_SCRIPT_KIND, version: 2, job: {} }, { kind: DIRECTOR_SCRIPT_KIND, version: 1, job: { id: "broken" } }]) {
    assert.equal(readStoredDirectorScript(junk), null);
  }
});

test("开场帧：提示词是导演拼的那一份，入参是实拍图、顺序就是提示词里的 image N", () => {
  const opening = directorOpeningFrame(job());
  assert.deepEqual(opening.inputImageUrls, [PHOTO_A, PHOTO_B]);
  assert.match(opening.prompt, /^A bright home dining nook/);
  assert.match(opening.prompt, /REFERENCE ROLES: image 1 = the three triangular gauze baby bibs/);
  assert.match(opening.prompt, /image 2 = fabric close-up/);
  assert.ok(DIRECTOR_LINE_MAX_PHOTOS <= 6, "Shuyu 出图一次最多带 6 张参考图");
});

test("出片参考图：实拍图在前、确认过的开场帧最后，和提示词的 REFERENCES 一一对应", () => {
  const script = job();
  const urls = directorVideoReferenceUrls(script, OPENING_FRAME);
  assert.deepEqual(urls, [PHOTO_A, PHOTO_B, OPENING_FRAME]);
  const prompt = directorVideoPrompt(script);
  assert.equal(prompt, buildVideoPrompt(script));
  assert.match(prompt, /^REFERENCES: image 1 = the three triangular gauze baby bibs/);
  assert.match(prompt, /image 3 = the exact opening frame/);
  /// 参考图不是公开 https 地址（本地路径）就出不了片 → null
  const local = parseDirectorJob({ ...JSON.parse(JSON.stringify(script)), references: script.references.map((reference) => ({ ...reference, source: "photos/a.jpg" })) });
  assert.equal(directorVideoReferenceUrls(local, OPENING_FRAME), null);
});

test("面板看到的摘要：每个镜头的时间、台词（没有就是 null），动作去掉 Hard cut 前缀", () => {
  const view = directorScriptView(readStoredDirectorScript(stored())!);
  assert.equal(view.genre, "fmcg");
  assert.equal(view.shots.length, 6);
  assert.deepEqual(view.shots.map((shot) => shot.line), ["喂一口，漏半口？", "有它接着，衣服不脏。", "多层纱布，软到不磨下巴。", null, "轻轻一按就戴好。", "三条装，现在就带走！"]);
  assert.ok(view.shots.every((shot) => !shot.action.startsWith("Hard cut.")));
  assert.equal(view.scenario?.moment, "喂辅食，喂一口漏半口");
});

test("字幕：口播稿是脚本里的台词连起来；没有语音识别时每句台词落在它自己的镜头里", () => {
  const script = job();
  assert.equal(directorCaptionScript(script), "喂一口，漏半口？ 有它接着，衣服不脏。 多层纱布，软到不磨下巴。 轻轻一按就戴好。 三条装，现在就带走！");
  const words = directorScriptSpeechWords(script);
  assert.ok(words.length > 20);
  /// 第一句在 0–2 秒里，最后一句在 12–15 秒里；镜头 4（8–10 秒）没有台词，那两秒里没有字
  assert.ok(words[0]!.startMs >= 0 && words[0]!.endMs <= 2_000);
  assert.ok(words.at(-1)!.startMs >= 12_000 && words.at(-1)!.endMs <= 15_000);
  assert.ok(!words.some((word) => word.startMs >= 8_000 && word.startMs < 10_000));
  assert.equal(directorVoiceLanguage("婴儿纱布口水巾，三条一包"), "zh-CN");
  assert.equal(directorVoiceLanguage("Gauze baby bibs, pack of three"), "en-US");
});

test("给商家看的每镜一句话随脚本存、随摘要出；旧脚本没有就是 null（界面退回英文原文）", () => {
  const script = job();
  const notes = ["米糊漏到衣服上", "手拿起口水巾", null, "圆扣固定在颈后", "顺手擦嘴", "三条装定格"];
  const record = packDirectorScript({ job: script, scenario: null, model: "m", attempts: 1, warnings: [], shotNotes: notes });
  const read = readStoredDirectorScript(JSON.parse(JSON.stringify(record)));
  assert.deepEqual(read?.shotNotes, notes);
  assert.deepEqual(directorScriptView(read!).shots.map((shot) => shot.note), notes);
  /// 旧脚本（没有 shotNotes）、条数对不上、空串：一律 null
  const old = readStoredDirectorScript(JSON.parse(JSON.stringify(stored())));
  assert.deepEqual(old?.shotNotes, [null, null, null, null, null, null]);
  const short = readStoredDirectorScript({ ...JSON.parse(JSON.stringify(record)), shotNotes: ["只有一条", "  "] });
  assert.deepEqual(short?.shotNotes, ["只有一条", null, null, null, null, null]);
  /// 面板：有说明显示说明，没有才显示英文原文
  const panel = readFileSync("src/components/video-generation/storyboard-workflow-panel.tsx", "utf8");
  assert.match(panel, /\{shot\.note \?\? shot\.action\}/);
});

test("导演线路的配乐随片子出：曲库不再混进去，创作页也不摆曲库、声音风格和「生成口播稿」", async () => {
  const script = job();
  const plan = await buildPlan(
    { ...request(15), audio: { voiceover: { enabled: false, voiceId: "warm-confident", language: "zh-CN", script: "" }, bgm: { trackId: "upbeat-pop", volume: 0.3 } } },
    { director: { job: script } },
  );
  assert.deepEqual(plan.postProduction?.audio.bgm, { trackId: "none", volume: 0 });
  assert.equal(plan.postProduction?.audio.voiceover.enabled, true);
  const controls = readFileSync("src/components/video-generation/audio-caption-controls.tsx", "utf8");
  assert.match(controls, /data-testid="director-script-input"/);
  assert.doesNotMatch(controls, /BgmPicker|Music2|VOICE_OPTIONS|生成口播稿/, "创作页不摆曲库、声音风格和「生成口播稿」");
  const studio = readFileSync("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  /// 只有商家自己写的口播稿才交给 AI 照着排；没写就是空，AI 按商品自己写台词
  assert.match(studio, /const narration = voiceoverScript\.trim\(\);/);
  assert.match(studio, /voiceoverScript: initialVoiceoverScript\.trim\(\),/);
  assert.match(studio, /index === 2 \? copy\.directorStepScript : index === 3 \? copy\.directorStepApprove : step/);
});

// ---------------------------------------------------------------------------
// 方案与派发
// ---------------------------------------------------------------------------

function request(duration: 15 | 30): UnifiedVideoGenerationRequest {
  return {
    userType: "platform",
    rawPrompt: "婴儿纱布口水巾，三条一包，多层纯棉纱布柔软吸水，尖角上有白色圆扣固定。",
    attachments: [],
    selectedDuration: duration,
    selectedAspectRatio: "9:16",
    selectedBrandEndingMode: "none",
    cta: null,
    platform: null,
    brandKit: null,
    language: "zh-CN",
    captions: { enabled: true, style: "plain", language: "zh-CN", position: "bottom", exportSrt: false },
    cornerLogo: true,
  };
}

for (const duration of [15, 30] as const) {
  test(`带着镜头脚本出方案（${duration} 秒）：整条片一个 AI 段，提示词就是脚本拼出来的，口播稿取脚本里的台词`, async () => {
    const script = job(duration);
    const plan = await buildPlan(request(duration), { director: { job: script } });
    const ai = plan.segments.filter((segment) => segment.type === "ai_generated_clip");
    assert.equal(ai.length, 1, "不按 15 秒切段");
    assert.equal(ai[0]!.durationSeconds, duration);
    assert.equal(ai[0]!.prompt, buildVideoPrompt(script));
    assert.equal(ai[0]!.negativePrompt, "");
    assert.equal(plan.postProduction?.audio.voiceover.enabled, true);
    assert.equal(plan.postProduction?.audio.voiceover.script, directorCaptionScript(script));
    assert.equal(plan.postProduction?.captions.enabled, true);
    assert.equal(plan.postProduction?.cornerLogo, true);
    assert.deepEqual(plan.planningDegradations, [], "不调模型，也就没有降级");

    const directorPlan = { ...mapPlanToDirectorPlan({ plan, language: "zh-CN" }), directorLine: packDirectorScript({ job: script, scenario: null, model: "m", attempts: 1, warnings: [] }) };
    assert.equal(directorPlan.segmentPlan.length, 1);
    assert.equal(directorPlan.segmentPlan[0]!.durationSec, duration);
    assert.equal(directorPlan.segmentPlan[0]!.seedancePrompt, buildVideoPrompt(script));
    assert.ok(directorPlan.segmentPlan[0]!.seedancePrompt.length <= 5_000, "Shuyu 提示词上限 5000");
    /// 入库再读回来，脚本还在（重试 / 合成都从这里读）
    const reread = parseDirectorPlan(JSON.parse(JSON.stringify(directorPlan)));
    assert.deepEqual(readStoredDirectorScript(reread.directorLine)?.job, script);
  });
}

test("接线：故事板、派发、合成三处都读脚本", () => {
  const storyboard = readFileSync("src/lib/video-generation/storyboard-service.ts", "utf8");
  assert.match(storyboard, /directorLineBlocker\(\{/);
  assert.match(storyboard, /visualReference: written\.stored/);
  /// 写不成就明说、可以再点一次：不退回老的分帧故事板
  assert.match(storyboard, /"DIRECTOR_SCRIPT_FAILED",\s*503/);
  assert.doesNotMatch(storyboard, /designStoryboardShotCards|renderStoryInEnglish/);
  assert.match(storyboard, /export function expectedStoryboardFrameCount/);
  assert.doesNotMatch(storyboard, /refs\.length !== storyboardFrameCountForDuration/, "判出齐要用 expectedStoryboardFrameCount");
  const dispatch = readFileSync("src/app/api/video-generation/dispatch/route.ts", "utf8");
  assert.match(dispatch, /director: \{ job: directorScript\.job \}/);
  /// 没有镜头脚本的故事板（下线前的老版本）不再出片
  assert.match(dispatch, /if \(!directorScript\) \{\s*return dispatchErrorResponse\(422/);
  assert.match(dispatch, /directorLine: packDirectorScript\(directorScript\)/);
  const videoService = readFileSync("src/lib/services/video-service.ts", "utf8");
  assert.match(videoService, /directorVideoReferenceUrls\(directorLine\.job, openingFrameUrl\)/);
  const composer = readFileSync("src/lib/services/stitch-composer.ts", "utf8");
  assert.match(composer, /directorScriptSpeechWords\(directorLine\.job\)/);
  assert.match(composer, /const tailTrimSec = directorLine \? 0 : aiTailTrimSec/);
  assert.match(composer, /resolveCornerLogoUrl/);
});

// ---------------------------------------------------------------------------
// 写手：线上的时间预算与退路
// ---------------------------------------------------------------------------

const WRITE_INPUT = {
  description: "婴儿纱布口水巾，三条一包。",
  durationSec: 15,
  aspectRatio: "9:16" as const,
  photos: [{ id: "asset-1", url: PHOTO_A }],
  jobId: "sb-test",
};

test("写手调用抛错 / 交回来的不是脚本 → ok: false 带原因，绝不抛（调用方据此告诉商家再点一次）", async () => {
  const failing = await writeDirectorScriptForStoryboard(WRITE_INPUT, {
    complete: async () => {
      throw new Error("model gpt-5.6-sol is overloaded");
    },
  });
  assert.equal(failing.ok, false);
  if (!failing.ok) assert.match(failing.cause, /model_unavailable.*overloaded/);

  let calls = 0;
  const garbage = await writeDirectorScriptForStoryboard(WRITE_INPUT, {
    complete: async () => {
      calls += 1;
      return { not: "a draft" };
    },
  });
  assert.equal(garbage.ok, false);
  assert.equal(calls, 3, "不合格的稿子最多改两次");
  if (!garbage.ok) assert.match(garbage.cause, /invalid_output after 3 draft/);
});

test("时间预算：剩下的时间不够再写一稿就收手；预算用完不再调模型", async () => {
  let clock = 0;
  let calls = 0;
  const result = await writeDirectorScriptForStoryboard(WRITE_INPUT, {
    now: () => clock,
    budgetMs: 200_000,
    complete: async () => {
      calls += 1;
      clock += 150_000;
      return { not: "a draft" };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 1, "第一稿用掉 150 秒，剩 50 秒不够再写一稿");

  /// 没有图：输入不合格，同样只是 ok: false
  const noPhotos = await writeDirectorScriptForStoryboard({ ...WRITE_INPUT, photos: [] }, { complete: async () => ({}) });
  assert.equal(noPhotos.ok, false);
});

test("写手没写成记一条降级，商家看到的是一句人话", () => {
  assert.equal(PLANNING_FALLBACK_BY_STAGE.director_script, "shot_card_storyboard");
  assert.match(planningDegradationNotice("director_script", "zh"), /没能写出完整的镜头脚本/);
  assert.match(planningDegradationNotice("director_script", "en"), /shot script/);
});

// ---------------------------------------------------------------------------
// Shuyu 出图的质量档、角标滤镜
// ---------------------------------------------------------------------------

test("Shuyu 的 GPT Image 2：缺省取同分辨率最便宜的一档，点名 high 就取高质量档；目录里没有 high 照缺省", () => {
  const plan = (id: string, name: string, resolution: string, points: number) => ({
    plan_id: id,
    kind: "image",
    model: "studio-image",
    unit: "generation",
    resolution,
    sale_points: points,
    display_name: name,
    capabilities: { aspect_ratios: ["9:16", "16:9", "1:1"], input_images_max: 9, resolutions: [resolution] },
    status: "available",
  });
  const catalog = parseShuyuCatalog({
    data: [
      plan("image-plan-02", "SY GPT Image 2 · Medium · 2K · 方案 2", "2K", 40),
      plan("image-plan-08", "SY GPT Image 2 · Low · 2K · 方案 8", "2K", 32),
      plan("image-plan-17", "SY GPT Image 2 · High · 2K · 方案 17", "2K", 48),
      plan("image-plan-18", "SY GPT Image 2 · High · 4K · 方案 18", "4K", 72),
      plan("image-plan-20", "SY GPT Image 2.5 Flare · High · 2K · 方案 20", "2K", 56),
    ],
  });
  assert.deepEqual(catalog.imagePlans.map((entry) => entry.quality), ["medium", "low", "high", "high"], "2.5 系不混进 Image 2");
  assert.equal(selectAuditedImage2Plan(catalog, "2K").planId, "image-plan-08");
  assert.equal(selectAuditedImage2Plan(catalog, "2K", { quality: "high" }).planId, "image-plan-17");
  const noHigh = { imagePlans: catalog.imagePlans.filter((entry) => entry.quality !== "high") };
  assert.equal(selectAuditedImage2Plan(noHigh, "2K", { quality: "high" }).planId, "image-plan-08");
});

test("右上角 Logo 的滤镜：白底线稿按深浅取形状，透明底 PNG 按它自己的透明度取形状", () => {
  const geometry = { logoWidth: 132, logoHeight: 132, x: 900, y: 120 };
  const luma = cornerLogoFilter({ geometry, tone: "light" });
  assert.match(luma, /format=gray,negate/);
  assert.equal(cornerLogoFilter({ geometry, tone: "light", mask: "luma" }), luma);
  const alpha = cornerLogoFilter({ geometry, tone: "light", mask: "alpha" });
  assert.match(alpha, /format=rgba,alphaextract/);
  assert.doesNotMatch(alpha, /negate/);
  /// 两种都落在同一个位置、同一个颜色
  for (const filter of [luma, alpha]) {
    assert.match(filter, /color=c=0xFFFFFF/);
    assert.match(filter, /overlay=x=884:y=104/);
  }
});

// ---------------------------------------------------------------------------
// 建故事板：导演线路只建一帧，脚本随 run 存；写不成退回老的故事板并记降级
// ---------------------------------------------------------------------------

function patch(t: TestContext, model: Record<string, unknown>, patches: Record<string, unknown>) {
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = model[key];
    model[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) model[key] = originals[key];
  });
}

/** 建 run 时截住写库的 data（抛哨兵错误，不往下提交帧）。 */
function captureRunCreate(t: TestContext): Array<Record<string, unknown>> {
  const created: Array<Record<string, unknown>> = [];
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findUnique: async () => null,
    create: async (args: { data: Record<string, unknown> }) => {
      created.push(args.data);
      throw new Error("stop after create");
    },
  });
  patch(t, db.mediaAsset as unknown as Record<string, unknown>, {
    findMany: async () => [
      { id: "asset-1", url: PHOTO_A, mimeType: "image/jpeg", userId: "owner-1" },
      { id: "asset-2", url: PHOTO_B, mimeType: "image/jpeg", userId: "owner-1" },
    ],
  });
  return created;
}

const RUN_INPUT = {
  userId: "owner-1",
  prompt: "婴儿纱布口水巾，三条一包，多层纯棉纱布柔软吸水。",
  durationSec: 30,
  aspectRatio: "9:16" as const,
  sourceAssetIds: ["asset-1", "asset-2"],
};

test("建故事板（导演线路）：只建一张开场帧，帧带着自己的入参，脚本存在 run 上；写手拿到的是商家原话和实拍图", async (t) => {
  const saved = process.env.DIRECTOR_LINE;
  delete process.env.DIRECTOR_LINE;
  t.after(() => {
    if (saved === undefined) delete process.env.DIRECTOR_LINE;
    else process.env.DIRECTOR_LINE = saved;
    storyboardTest.__setRuntimeDependenciesForTests(null);
  });
  const record = stored(30);
  const seen: Array<Record<string, unknown>> = [];
  storyboardTest.__setRuntimeDependenciesForTests({
    writeDirectorScript: async (input) => {
      seen.push(input as unknown as Record<string, unknown>);
      return { ok: true, script: readStoredDirectorScript(record)!, stored: record };
    },
  });
  const created = captureRunCreate(t);
  await assert.rejects(createStoryboardRun({ ...RUN_INPUT, idempotencyKey: "director-run", styleTemplateId: DIRECTOR_LINE_TEMPLATE_ID }), /stop after create/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.description, RUN_INPUT.prompt);
  assert.deepEqual(seen[0]!.photos, [{ id: "asset-1", url: PHOTO_A }, { id: "asset-2", url: PHOTO_B }]);
  assert.equal(seen[0]!.styleTemplateId, DIRECTOR_LINE_TEMPLATE_ID);
  assert.match(String(seen[0]!.jobId), /^sb-[a-z0-9]{8,24}$/);

  assert.equal(created.length, 1);
  assert.deepEqual(created[0]!.visualReference, record);
  assert.deepEqual(created[0]!.planningDegradations, []);
  const frames = (created[0]!.frames as { create: Array<Record<string, unknown>> }).create;
  assert.equal(frames.length, 1, "只出一张开场帧");
  assert.equal(frames[0]!.beat, DIRECTOR_OPENING_FRAME_BEAT);
  assert.equal(frames[0]!.prompt, directorOpeningFrame(job(30)).prompt);
  assert.deepEqual(frames[0]!.inputImageUrls, [PHOTO_A, PHOTO_B]);
  assert.equal(storyboardBeatLabel(DIRECTOR_OPENING_FRAME_BEAT, false), "开场画面 · 主动作发生之前的那一刻");
  /// 出齐 = 1 帧；老的故事板仍按时长 4 / 5 帧
  assert.equal(expectedStoryboardFrameCount({ durationSec: 30, visualReference: record }), 1);
  assert.equal(expectedStoryboardFrameCount({ durationSec: 30, visualReference: null }), 5);
  assert.equal(expectedStoryboardFrameCount({ durationSec: 15 }), 4);
});

test("建故事板：写手没写成 → 明说、不建 run、不退回老的分帧故事板；下线的老模板根本不叫写手", async (t) => {
  t.after(() => storyboardTest.__setRuntimeDependenciesForTests(null));
  let writerCalls = 0;
  storyboardTest.__setRuntimeDependenciesForTests({
    writeDirectorScript: async () => {
      writerCalls += 1;
      return { ok: false, cause: "director writer model_unavailable after 1 draft(s): overloaded" };
    },
  });
  const created = captureRunCreate(t);
  await assert.rejects(
    createStoryboardRun({ ...RUN_INPUT, idempotencyKey: "director-fallback" }),
    (error: unknown) =>
      error instanceof StoryboardRequestError
      && error.code === "DIRECTOR_SCRIPT_FAILED"
      && error.status === 503
      && /再点一次/.test(error.message)
      && !/overloaded|model_unavailable/.test(error.message),
  );
  assert.equal(writerCalls, 1);
  assert.equal(created.length, 0, "没写成就不建 run：不出帧、不花点数");

  await assert.rejects(
    createStoryboardRun({ ...RUN_INPUT, idempotencyKey: "other-template", styleTemplateId: "commerce-food-sizzle" }),
    (error: unknown) => error instanceof StoryboardRequestError && error.code === "VALIDATION_FAILED" && /模板已经下线/.test(error.message),
  );
  assert.equal(writerCalls, 1, "下线的老模板当场拒绝，不叫写手");
});

test("脚本里一句台词都没有（静物、沉浸声音这类风格）：音轨仍是模型原生的——曲库不混进去、标上 nativeMusic，口播关着", async () => {
  const silent = job();
  for (const shot of silent.video.shots) shot.sound = shot.sound.replace(/[“"][^”"]*[”"]/gu, "").replace(/the voice says\s*/giu, "ambient room tone ");
  assert.equal(directorCaptionScript(silent), "", "夹具里的台词要真的去干净");
  const plan = await buildPlan(
    { ...request(15), audio: { voiceover: { enabled: false, voiceId: "warm-confident", language: "zh-CN", script: "" }, bgm: { trackId: "upbeat-pop", volume: 0.3 } } },
    { director: { job: silent } },
  );
  assert.deepEqual(plan.postProduction?.audio.bgm, { trackId: "none", volume: 0 });
  assert.equal(plan.postProduction?.audio.nativeMusic, true);
  assert.equal(plan.postProduction?.audio.voiceover.enabled, false);
});
