import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CAPTION_STYLE_OPTIONS,
  captionStyleSelectValue,
  generateVoiceoverScript,
} from "../src/components/video-generation/audio-caption-controls";
import { BGM_ATTRIBUTIONS } from "../src/lib/video-generation/bgm-attribution";

const source = readFileSync(
  "src/components/video-generation/audio-caption-controls.tsx",
  "utf8",
);
const studio = readFileSync(
  "src/components/video-generation/streamlined-video-studio.tsx",
  "utf8",
);

test("voiceover starts with a generated, editable script", () => {
  assert.match(source, /生成口播稿/);
  assert.match(source, /<textarea/);
  assert.match(source, /voiceover/);
  assert.match(studio, /audio:\s*\{\s*voiceover:/);
  assert.match(studio, /captions:/);
});

test("BGM disclosure includes license attribution", () => {
  /// 1025 A6 7.6：署名行改由 bgm-attribution 单一来源提供（交付面复用同一行），
  /// 选了曲目就在选曲处给出要贴进帖子文案的完整署名。
  assert.match(source, /bgmAttributionForTrack\(value\.bgmTrackId\)/);
  assert.match(source, /CC BY 4\.0/);
  assert.match(source, /Kevin MacLeod/);
  assert.match(source, /Wholesome/);
  assert.match(source, /<details/);
  const attribution = BGM_ATTRIBUTIONS.wholesome ?? "";
  assert.match(attribution, /Wholesome/);
  assert.match(attribution, /Kevin MacLeod/);
  assert.match(attribution, /CC BY 4\.0/);
});

test("字幕样式只列渲染层做得到的两档，逐词强调 / 跟读高亮先隐藏", () => {
  assert.doesNotMatch(source, /逐词强调|跟读高亮|Word by word|Karaoke/);
  assert.deepEqual(
    CAPTION_STYLE_OPTIONS.map((option) => option.value),
    ["word_by_word", "plain"],
  );
  /// 已保存 / 默认的旧值不改写，只在界面上归到它们真实的观感
  assert.equal(captionStyleSelectValue("word_by_word"), "word_by_word");
  assert.equal(captionStyleSelectValue("karaoke"), "word_by_word");
  assert.equal(captionStyleSelectValue("plain"), "plain");
  assert.match(source, /value=\{captionStyleSelectValue\(value\.captionStyle\)\}/);
});

test("automatic scripts are deterministic, localized, and duration-bounded", () => {
  const input = {
    prompt:
      "展示一款轻巧保温杯如何解决通勤途中漏水的问题，并清楚演示单手开盖。",
    cta: "立即了解",
    durationSec: 15 as const,
    language: "zh-CN",
    templateId: "commerce-demo-first-reveal",
  };
  const first = generateVoiceoverScript(input);
  const second = generateVoiceoverScript(input);
  assert.equal(first, second);
  assert.match(first, /保温杯/);
  assert.match(first, /立即了解/);
  assert.ok(Array.from(first).length <= 15 * 4);

  const english = generateVoiceoverScript({
    prompt: "Show how a compact travel bottle prevents leaks on a morning commute.",
    cta: "Learn more",
    durationSec: 15,
    language: "en-US",
    templateId: "commerce-ugc-testimonial",
  });
  assert.match(english, /travel bottle/i);
  assert.match(english, /Learn more/);
  assert.ok(english.split(/\s+/u).length <= 34);
});
