import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { HOOK_ANGLES, applyHookAngle, detectHookAngle, stripHookAngle } from "@/lib/create/hook-angles";
import { SOAK_HOOK_ANGLES } from "../scripts/lib/soak-run";

/**
 * 换个开头（2026-11-10）：在商家描述末尾补一句「开头怎么拍」。守住：只动自己加的那一句、
 * 换角度不叠加、再点一次能还原、真机验证过的两句与压测用的一字不差。
 */
const STORY = "橄榄色蜡帆布卷口背包，黑色卡扣、皮质包边。拍一个人在山路上停下来，从包里拿出外套穿上。";

test("加一个开头方向：补在描述最后、另起一行；能认出来", () => {
  const next = applyHookAngle(STORY, "pain", "zh");
  assert.equal(next, `${STORY}\n${HOOK_ANGLES[0].zh.direction}`);
  assert.equal(detectHookAngle(next), "pain");
  assert.equal(detectHookAngle(STORY), null);
});

test("换角度不叠加：先去掉原来的再加新的；再点一次（null）还原成商家自己写的", () => {
  const pain = applyHookAngle(STORY, "pain", "zh");
  const result = applyHookAngle(pain, "result", "zh");
  assert.equal(detectHookAngle(result), "result");
  assert.ok(!result.includes(HOOK_ANGLES[0].zh.direction));
  assert.equal(applyHookAngle(result, null, "zh"), STORY);
  assert.equal(stripHookAngle(result), STORY);
  /// 中文界面加的，切到英文界面再换也能去干净
  const english = applyHookAngle(pain, "detail", "en");
  assert.equal(english, `${STORY}\n${HOOK_ANGLES[2].en.direction}`);
});

test("描述为空不加；加了会超过字数上限就原样返回", () => {
  assert.equal(applyHookAngle("", "pain", "zh"), "");
  assert.equal(applyHookAngle("   ", "result", "zh"), "");
  const long = "字".repeat(3990);
  assert.equal(applyHookAngle(long, "pain", "zh"), long);
});

test("商家自己写的内容一个字不动（包括中间的换行）", () => {
  const story = "第一段：商品是什么。\n\n第二段：想怎么拍。";
  const withAngle = applyHookAngle(story, "contrast", "zh");
  assert.ok(withAngle.startsWith(story));
  assert.equal(stripHookAngle(withAngle), story);
});

test("痛点开场 / 结果前置两句与真机压测用的一字不差（那 16 条成片就是带着它们出的）", () => {
  for (const soak of SOAK_HOOK_ANGLES) {
    const angle = HOOK_ANGLES.find((item) => item.id === soak.id);
    assert.ok(angle, `${soak.id} 在产品里也有`);
    assert.equal(angle.zh.direction, soak.direction);
    assert.equal(angle.zh.label, soak.label);
  }
});

test("创作页：描述写了才出现「换个开头」；点了改描述并让旧方案作废；故事板出来后不再出现", async () => {
  const studio = await readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /stripHookAngle\(rawPrompt\)\.length >= 8 \? \(/);
  assert.match(studio, /data-testid="hook-angles"/);
  assert.match(
    studio,
    /setRawPrompt\(applyHookAngle\(rawPrompt, active \? null : angle\.id, english \? "en" : "zh"\)\);\s*invalidatePlan\(\);/,
  );
  const hookRow = studio.indexOf('data-testid="hook-angles"');
  const guard = studio.lastIndexOf("{!storyboard ? (", hookRow);
  assert.ok(guard > 0 && hookRow - guard < 1200, "「换个开头」在「还没有故事板」的分支里");
});

test("压测脚本出的片带「开头钩子（痛点开场）：」引子：也认得出、去掉时不留半截；引子后面跟着商家自己的字就不动", () => {
  const soak = `${STORY}\n开头钩子（痛点开场）：${HOOK_ANGLES[0].zh.direction}`;
  assert.equal(detectHookAngle(soak), "pain");
  assert.equal(stripHookAngle(soak), STORY);
  assert.equal(applyHookAngle(soak, "result", "zh"), `${STORY}\n${HOOK_ANGLES[1].zh.direction}`);
  const own = `${STORY}\n开头钩子（我自己想的）：先拍下雨。`;
  assert.equal(stripHookAngle(own), own);
});
