/**
 * 1025 成片地板（A6 7.1–7.3）门禁：
 * - 框架版本 2：只许硬切，叠化 / 溶解 / 双重曝光 / 鬼影进负面词；全目录整体升版。
 * - 节拍 0-3 / 3-13 / 13-15s：收尾定格只剩 2 秒，钩子第一秒就是产品最强的一面，
 *   且模板库时间线（template-shot-timeline）仍能逐条解析。
 * - 有人 / 有宠物的配方写死单一主体；高级创作路径的 style scaffold 同口径。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMERCE_TEMPLATE_RECIPES,
  getCommerceTemplateRecipe,
} from "../src/lib/video-generation/commerce-template-catalog";
import {
  COMMERCE_FRAME_REVISION,
  COMMERCE_TEMPLATE_SEEDS,
} from "../src/lib/video-generation/generic-commerce-template";
import { renderBatchTemplatePrompt } from "../src/lib/video-generation/batch-style-templates";
import { parseTemplateShots } from "../src/components/templates/template-shot-timeline";
import { TEMPLATE_LIBRARY_COPY } from "../src/components/templates/template-library-copy";
import {
  STYLE_TEMPLATES,
  getStyleTemplate,
} from "../src/lib/video-generation/style-templates";

const HOOK_FIRST_SECOND =
  "0-3s HOOK: the product's strongest visible state in the first second";
const TRANSITION_NEGATIVES = [
  "crossfade",
  "dissolve",
  "double exposure",
  "ghosting",
  "superimposed transition",
];

test("框架版本 2：全目录整体升版，配方自身 version 不动", () => {
  assert.equal(COMMERCE_FRAME_REVISION, 2);
  for (const seed of COMMERCE_TEMPLATE_SEEDS) {
    const recipe = getCommerceTemplateRecipe(seed.slug);
    assert.ok(recipe, seed.slug);
    assert.equal(seed.version, (recipe.version ?? 1) + 2, `${seed.slug} 未随框架版本 2 升版`);
  }
});

test("只许硬切：框架锁写明禁止叠化，负面词含全部转场伪影", () => {
  for (const seed of COMMERCE_TEMPLATE_SEEDS) {
    assert.match(
      seed.promptSkeleton,
      /Hard cuts only: .*No crossfades, dissolves, double exposure, ghosting, or superimposed transitions\./,
      `${seed.slug} 缺硬切锁`,
    );
    const negatives = seed.negativePrompt.split(",").map((term) => term.trim());
    for (const term of TRANSITION_NEGATIVES) {
      assert.ok(negatives.includes(term), `${seed.slug} 负面词缺 ${term}`);
    }
    assert.match(seed.promptSkeleton, /PACING: [^\n]*two-second final product hold, hard cuts only\./);
  }
});

test("节拍 0-3 / 3-13 / 13-15s：收尾定格 2 秒，时间线可解析且标签有中英文案", () => {
  const knownBeats = new Set([
    ...Object.keys(TEMPLATE_LIBRARY_COPY["zh-CN"].timeline.beats),
    ...Object.keys(TEMPLATE_LIBRARY_COPY["en-US"].timeline.beats),
  ]);
  for (const seed of COMMERCE_TEMPLATE_SEEDS) {
    const shots = parseTemplateShots(seed.promptSkeleton);
    assert.deepEqual(
      shots.map((shot) => [shot.start, shot.end]),
      [[0, 3], [3, 13], [13, seed.lockedParams.duration]],
      `${seed.slug} 节拍时间不对`,
    );
    const hold = shots.at(-1)!;
    assert.equal(hold.beat, "CTA HOLD", seed.slug);
    assert.equal(hold.end - hold.start, 2, `${seed.slug} 收尾定格不是 2 秒`);
    for (const shot of shots) {
      assert.ok(knownBeats.has(shot.beat), `${seed.slug} 节拍名 ${shot.beat} 没有界面文案`);
    }
    assert.doesNotMatch(
      seed.promptSkeleton,
      /10-15s|3-10s|unhurried final|unhurried spoken/,
      `${seed.slug} 残留旧节拍`,
    );
  }
});

test("钩子 beat 第一秒就是产品最强的一面", () => {
  for (const recipe of COMMERCE_TEMPLATE_RECIPES) {
    assert.ok(
      recipe.beats[0].startsWith(HOOK_FIRST_SECOND),
      `${recipe.slug} 钩子没从产品最强状态开场：${recipe.beats[0]}`,
    );
  }
  for (const seed of COMMERCE_TEMPLATE_SEEDS) {
    assert.match(seed.promptSkeleton, /The first second always shows the product's strongest visible state\./);
    assert.match(seed.promptSkeleton, /the final hold lasts two seconds, not longer\./);
  }
});

test("有人（含只出手）的配方锁单一人物、宠物配方锁单一动物，无人配方不挂锁", () => {
  for (const recipe of COMMERCE_TEMPLATE_RECIPES) {
    const seed = COMMERCE_TEMPLATE_SEEDS.find((item) => item.slug === recipe.slug)!;
    if (recipe.humanInteraction === "none") {
      assert.equal(recipe.subjectLock, undefined, `${recipe.slug} 无人配方不该挂主体锁`);
      assert.doesNotMatch(seed.promptSkeleton, /SUBJECT LOCK/);
      continue;
    }
    assert.ok(recipe.subjectLock, `${recipe.slug} 有人入镜却没有单一主体锁`);
    const lockLine = seed.promptSkeleton
      .split("\n")
      .find((line) => line.startsWith("SUBJECT LOCK:"));
    assert.ok(lockLine, `${recipe.slug} 骨架缺 SUBJECT LOCK`);
    /// 主体锁必须在 TIMED STORYBOARD 之前，不能打断时间线解析
    assert.ok(
      seed.promptSkeleton.indexOf(lockLine) < seed.promptSkeleton.indexOf("TIMED STORYBOARD:"),
    );
    if (recipe.subjectLock === "person") {
      assert.match(lockLine, /at most one person in the whole video, hands included/);
      for (const trait of ["Face", "age", "skin tone", "hair", "outfit", "sleeves", "accessories"]) {
        assert.ok(lockLine.includes(trait), `${recipe.slug} 人物锁缺 ${trait}`);
      }
      assert.match(seed.negativePrompt, /second person, different person, face change/);
    } else {
      assert.match(lockLine, /exactly one animal in the whole video/);
      for (const trait of ["Species", "breed", "coat color", "markings"]) {
        assert.ok(lockLine.includes(trait), `${recipe.slug} 宠物锁缺 ${trait}`);
      }
      assert.match(seed.negativePrompt, /second animal, different pet, breed change/);
    }
  }
  assert.equal(getCommerceTemplateRecipe("commerce-pet-companion")?.subjectLock, "pet");
  assert.equal(getCommerceTemplateRecipe("commerce-creator-reaction")?.subjectLock, "person");
  assert.equal(getCommerceTemplateRecipe("commerce-pov-immersive")?.subjectLock, "person");
});

test("最坏输入下合并负面词后的提示词仍给下游留 ≥200 字符余量（合作方 5000 硬上限）", () => {
  for (const seed of COMMERCE_TEMPLATE_SEEDS) {
    const prompt = renderBatchTemplatePrompt({
      promptSkeleton: seed.promptSkeleton,
      imageUrls: Array.from(
        { length: seed.imagesPerVideo.max },
        (_, index) => `https://cdn.test/${index}.jpg`,
      ),
      /// batch-request 的 productName 上限是 200 字符
      productName: "P".repeat(200),
    });
    const merged = `${prompt}\nNegative constraints: ${seed.negativePrompt}`;
    assert.ok(merged.length <= 4_800, `${seed.slug} 合并后 ${merged.length} 字符`);
  }
});

test("高级创作路径的 style scaffold：有人 / 宠物模板写死单一主体，转场只许硬切", () => {
  const talking = getStyleTemplate("tpl_ugc_talking")!;
  assert.match(talking.scaffold.characterHint ?? "", /exactly one relatable content creator/);
  assert.match(talking.scaffold.characterHint ?? "", /same face, age, skin tone, hairstyle, outfit and accessories/);
  /// commerce 的口播 / 真人模板在高级创作路径都落到这个 scaffold
  for (const slug of [
    "commerce-ugc-testimonial",
    "commerce-hard-sell-presenter",
    "commerce-founder-story",
    "commerce-creator-reaction",
  ]) {
    assert.equal(getStyleTemplate(slug)?.id, "tpl_ugc_talking", slug);
  }

  const pet = getStyleTemplate("commerce-pet-companion")!;
  assert.equal(pet.id, "tpl_pet_daily");
  assert.match(pet.scaffold.characterHint ?? "", /exactly one adorable pet/);
  assert.match(pet.scaffold.characterHint ?? "", /species, breed, size, coat color, markings and collar/);

  assert.match(getStyleTemplate("tpl_unboxing")?.scaffold.characterHint ?? "", /same single pair of hands/);
  assert.match(getStyleTemplate("tpl_before_after")?.scaffold.characterHint ?? "", /exactly one relatable everyday person/);

  for (const template of STYLE_TEMPLATES) {
    const scaffoldText = JSON.stringify(template.scaffold);
    assert.doesNotMatch(scaffoldText, /rewind transition|split-screen feel|split narrative/, template.id);
  }
});
