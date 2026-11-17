import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CAPTION_STYLE_OPTIONS,
  TIMED_CAPTION_STYLE_OPTIONS,
  captionStyleOptions,
  captionStyleSelectValue,
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

test("声音设置只剩一个可不填的输入框：台词由 AI 导演写，商家想自己定就写在这里", () => {
  assert.match(source, /data-testid="director-script-input"/);
  assert.match(source, /<textarea/);
  assert.match(source, /想让 AI 照着念的口播稿（可不填）/);
  /// 老线路的「原生口播」开关、声音风格、按模板 / AI 起口播稿、曲库都不在了
  assert.doesNotMatch(source, /VOICE_OPTIONS|<BgmPicker|generateVoiceoverScript|onRegenerate|RefreshCw|voiceoverToggleLocked/);
  assert.doesNotMatch(studio, /\/api\/video-generation\/voiceover-draft|generateVoiceoverScript|autoVoiceoverScript|PlanPreviewCard|\/api\/video-generation\/plan/);
  assert.match(studio, /audio:\s*\{\s*voiceover:/);
  assert.match(studio, /captions:/);
  /// 没写自己的稿子就不带「开着口播」：服务端按镜头脚本定口播与字幕
  assert.match(studio, /enabled: script\.length > 0,/);
});

test("BGM disclosure includes license attribution", () => {
  /// 1025 A6 7.6：署名行改由 bgm-attribution 单一来源提供（交付面复用同一行），
  /// 选了曲目就在选曲处给出要贴进帖子文案的完整署名。
  /// 2026-11-17：创作页不再摆曲库（配乐随片子出）；曲库只在成品详情「只重新合成」里给以前没有原生配乐的片用
  assert.match(source, /<details/);
  const restitch = readFileSync("src/components/library/restitch-form.tsx", "utf8");
  assert.match(restitch, /<BgmPicker/);
  assert.match(restitch, /data-testid="restitch-native-music"/);
  const catalog = readFileSync("src/lib/video-generation/bgm-catalog.ts", "utf8");
  assert.match(catalog, /Kevin MacLeod/);
  assert.match(catalog, /Wholesome/);
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
  assert.match(studio, /const script = voiceoverScript\.trim\(\);/);
  assert.match(studio, /voiceover:\s*\{[\s\S]*?language:\s*detectScriptLanguage\(script, locale\)/);
  assert.match(studio, /captions:\s*\{[\s\S]*?language:\s*detectScriptLanguage\(script, locale\)/);
});

