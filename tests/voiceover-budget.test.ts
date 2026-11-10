import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assessVoiceoverLength,
  measureSpokenLength,
  voiceoverBudget,
  voiceoverCeiling,
  voiceoverLengthHint,
} from "../src/lib/video-generation/voiceover-budget";

/**
 * 2026-11-10：口播稿下面原来只显示「34 / 2000」。2000 是接口上限，15 秒的片写 200 字照样能提交，
 * 成片里说不完才发现。这里守住「按时长提示说不说得完」，并且全站只有一把尺。
 */

test("建议与上限：中文 4 / 5 字每秒，英文 2.2 / 2.8 词每秒", () => {
  assert.equal(voiceoverBudget(15, false), 60);
  assert.equal(voiceoverCeiling(15, false), 75);
  assert.equal(voiceoverBudget(30, false), 120);
  assert.equal(voiceoverBudget(15, true), 33);
  assert.equal(voiceoverCeiling(15, true), 42);
  /// 很短的片英文建议至少 12 词，上限不低于建议
  assert.equal(voiceoverBudget(5, true), 12);
  assert.ok(voiceoverCeiling(5, true) >= voiceoverBudget(5, true));
});

test("说出口的长度：中文不数空白和标点，英文数词", () => {
  assert.equal(measureSpokenLength("早上赶地铁，也能喝到热的。", false), 11);
  assert.equal(measureSpokenLength("  早上 赶地铁！！  ", false), 5);
  assert.equal(measureSpokenLength("Hot coffee, all morning — really.", true), 5);
  assert.equal(measureSpokenLength("", false), 0);
});

test("三档判断：从容 / 偏快 / 说不完；语言看稿子本身", () => {
  const ok = assessVoiceoverLength("字".repeat(34), 15, "zh-CN");
  assert.deepEqual([ok.fit, ok.count, ok.budget, ok.ceiling, ok.english], ["ok", 34, 60, 75, false]);
  assert.equal(ok.estimatedSec, 9);
  assert.equal(assessVoiceoverLength("字".repeat(60), 15, "zh-CN").fit, "ok");
  assert.equal(assessVoiceoverLength("字".repeat(61), 15, "zh-CN").fit, "tight");
  assert.equal(assessVoiceoverLength("字".repeat(75), 15, "zh-CN").fit, "tight");
  assert.equal(assessVoiceoverLength("字".repeat(76), 15, "zh-CN").fit, "over");
  assert.equal(assessVoiceoverLength("  ", 15, "zh-CN").fit, "empty");
  /// 中文界面写英文稿：按词数
  const english = assessVoiceoverLength(Array.from({ length: 50 }, () => "word").join(" "), 15, "zh-CN");
  assert.deepEqual([english.english, english.count, english.fit], [true, 50, "over"]);
  /// 同一份 76 字的稿，换成 30 秒的片就从容了
  assert.equal(assessVoiceoverLength("字".repeat(76), 30, "zh-CN").fit, "ok");
});

test("提示文字：说清几个字、说完要几秒、这条片建议多少", () => {
  const hint = (script: string, duration = 15, uiEnglish = false) =>
    voiceoverLengthHint(assessVoiceoverLength(script, duration, uiEnglish ? "en-US" : "zh-CN"), duration, uiEnglish);
  assert.equal(hint(""), "15 秒的片建议 60 字以内。");
  assert.equal(hint("字".repeat(34)), "34 字 · 说完约 9 秒（15 秒的片建议 60 字以内）");
  assert.match(hint("字".repeat(70)), /^70 字 · 说完约 18 秒，比 15 秒略长，语速会偏快。$/);
  assert.match(hint("字".repeat(90)), /^90 字 · 说完约 23 秒，15 秒的片说不完，建议删到 60 字以内。$/);
  assert.match(hint("one two three", 15, true), /^3 words · about 1s to say \(aim for up to 33 in a 15s video\)$/);
  /// 提示里不出现接口上限
  for (const text of [hint(""), hint("字".repeat(34)), hint("字".repeat(90))]) assert.doesNotMatch(text, /2000/);
});

test("全站一把尺：AI 起稿、模板稿、界面提示都从 voiceover-budget 取数", () => {
  const writer = readFileSync("src/lib/video-generation/voiceover-writer.ts", "utf8");
  assert.match(writer, /import \{ voiceoverBudget \} from "\.\/voiceover-budget";/);
  assert.doesNotMatch(writer, /durationSec \* 4|durationSec \* 2\.2/);
  const controls = readFileSync("src/components/video-generation/audio-caption-controls.tsx", "utf8");
  assert.doesNotMatch(controls, /durationSec \* 4|durationSec \* 2\.2/);
  assert.doesNotMatch(controls, /\{value\.voiceoverScript\.length\} \/ 2000/, "不再给商家看接口上限");
  assert.match(controls, /data-testid="voiceover-length-hint"/);
  /// 纯函数模块：客户端组件直接引用，不能带服务端依赖
  const budget = readFileSync("src/lib/video-generation/voiceover-budget.ts", "utf8");
  assert.doesNotMatch(budget, /from "@\/lib\/(?:ai|db|services)/);
});

test("故事板出来之后：不改画面的设置照样能改，改了不丢故事板", () => {
  const studio = readFileSync("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /const finishingLocked = busy !== null;/);
  /// 口播稿 / 字幕 / 配乐：只在提交途中锁；口播开关（决定有没有人对镜头说话）跟着画面锁
  assert.match(studio, /disabled=\{finishingLocked\}\s+voiceoverToggleLocked=\{configurationLocked\}\s+durationSec=\{selectedDuration\}/);
  /// 有故事板时改这些设置只让方案预览失效，不调会清掉故事板的 invalidatePlan
  assert.match(studio, /if \(hasStoryboard\) invalidatePlanKeepingStoryboard\(\);\s+else invalidatePlan\(\);/);
  const soft = studio.slice(
    studio.indexOf("const invalidatePlanKeepingStoryboard = useCallback"),
    studio.indexOf("const hasStoryboard = storyboard !== null;"),
  );
  assert.ok(soft.length > 0);
  assert.doesNotMatch(soft, /setStoryboard\(null\)|storyboardAttemptRef\.current = null/);
  /// 片尾落款四个控件都跟着解锁
  const signoff = studio.slice(studio.indexOf('data-testid="streamlined-signoff"'), studio.indexOf("BRAND_END_CARD_ENTRY_ENABLED ? ("));
  assert.equal((signoff.match(/disabled=\{finishingLocked\}/g) ?? []).length, 4);
  assert.doesNotMatch(signoff, /disabled=\{locked\}/);
  /// 改画面的那几项仍然锁着
  assert.match(studio, /value=\{String\(selectedDuration\)\}\s+disabled=\{locked\}/);
  assert.match(studio, /value=\{referenceMode\}\s+disabled=\{locked\}/);
  assert.match(studio, /data-testid="finishing-editable-hint"/);
});
