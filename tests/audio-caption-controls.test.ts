import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CAPTION_STYLE_OPTIONS,
  TIMED_CAPTION_STYLE_OPTIONS,
  captionStyleOptions,
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

test("字幕样式分档由 wordTimestampsAvailable 控制：默认仍只列两档，有逐词时间戳才放出跟读高亮 / 逐词强调", () => {
  /// 默认（Phase 1 没有 TTS 时间戳来源）：与 1025 A6 7.5 完全一致——两档、旧值折叠到「醒目描边」
  assert.deepEqual(
    captionStyleOptions(false).map((option) => option.value),
    ["word_by_word", "plain"],
  );
  assert.deepEqual(
    CAPTION_STYLE_OPTIONS.map((option) => option.value),
    ["word_by_word", "plain"],
  );
  assert.equal(captionStyleSelectValue("word_by_word"), "word_by_word");
  assert.equal(captionStyleSelectValue("karaoke"), "word_by_word");
  assert.equal(captionStyleSelectValue("plain"), "plain");
  assert.ok(
    CAPTION_STYLE_OPTIONS.every((option) => !/逐词强调|跟读高亮|Word by word|Karaoke/.test(`${option.zh} ${option.en}`)),
    "默认档不许诺逐词高亮",
  );

  /// 有逐词时间戳：三档真分档，保存的值原样显示
  assert.deepEqual(
    captionStyleOptions(true).map((option) => option.value),
    ["karaoke", "word_by_word", "plain"],
  );
  assert.deepEqual(captionStyleOptions(true), TIMED_CAPTION_STYLE_OPTIONS);
  assert.equal(captionStyleSelectValue("karaoke", true), "karaoke");
  assert.equal(captionStyleSelectValue("word_by_word", true), "word_by_word");
  assert.equal(captionStyleSelectValue("plain", true), "plain");

  /// 组件：prop 默认 false，select 的值与选项都走同一个 prop
  assert.match(source, /wordTimestampsAvailable\?: boolean/);
  assert.match(source, /wordTimestampsAvailable = false/);
  assert.match(
    source,
    /value=\{captionStyleSelectValue\(value\.captionStyle, wordTimestampsAvailable\)\}/,
  );
  assert.match(source, /captionStyleOptions\(wordTimestampsAvailable\)\.map/);
  /// 真站调用处还没有传 prop（没有时间戳来源）：界面行为与现在一致
  assert.doesNotMatch(studio, /wordTimestampsAvailable/);
});

test("P04-B：口播 / 字幕语言按口播稿检测，不再拿界面 locale 代替", () => {
  assert.match(studio, /import \{ detectScriptLanguage \} from "@\/lib\/video-generation\/detect-script-language";/);
  /// 2026-10-29：出故事板前 AI 刚写好的稿会作为 voiceoverScriptOverride 传进来（state 还没刷新），语言看的是同一份稿
  assert.match(studio, /const script = voiceoverScriptOverride \?\? voiceoverScript;/);
  assert.match(studio, /voiceover:\s*\{[\s\S]*?language:\s*detectScriptLanguage\(script, locale\)/);
  assert.match(studio, /captions:\s*\{[\s\S]*?language:\s*detectScriptLanguage\(script, locale\)/);
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

test("1025：口播初稿不念规格与镜头调度，只在句读处截断", () => {
  const zh = generateVoiceoverScript({
    prompt:
      "15 秒 9:16 真实 UGC 演示：一只金毛在公园奔跑，主人在手机上实时看到项圈摄像头拍下的第一视角画面。产品是米白色 Aivora 宠物项圈摄像头，镜头特写展示扣带和镜头模组，最后主人微笑点开回放。温暖自然光。",
    durationSec: 15,
    language: "zh-CN",
    templateId: null,
    cta: null,
  });
  assert.doesNotMatch(zh, /15 秒|9:16|UGC|特写|自然光/);
  assert.match(zh, /一只金毛在公园奔跑/);
  // 每个分句要么完整出现、要么不出现：不在半句处截断
  assert.doesNotMatch(zh, /主人在手机上实时。/);
  assert.ok(Array.from(zh).length <= 15 * 4);

  const specOnly = generateVoiceoverScript({ prompt: "30 秒 16:9 横屏，特写，暖光", durationSec: 30, language: "zh-CN", templateId: null, cta: null });
  assert.match(specOnly, /这款产品让日常使用更简单/);

  const en = generateVoiceoverScript({
    prompt: "15s vertical UGC demo. A golden retriever runs through the park, the owner watches the collar camera live on her phone. Close-up of the buckle. Warm natural lighting.",
    durationSec: 15,
    language: "en-US",
    templateId: null,
    cta: null,
  });
  assert.doesNotMatch(en, /15s|vertical|UGC|Close-up|lighting/i);
  assert.match(en, /golden retriever/);
});

test("1025：「15 秒 9:16：」开头的提示词不会把画幅切出一个「16」进口播", () => {
  const zh = generateVoiceoverScript({
    prompt: "15 秒 9:16：橘猫趴在米白色智能宠物垫上打盹，阳光照在客厅木地板上。",
    durationSec: 15,
    language: "zh-CN",
    templateId: null,
    cta: null,
  });
  assert.doesNotMatch(zh, /16|9/);
  assert.match(zh, /橘猫趴在米白色智能宠物垫上打盹/);
});
