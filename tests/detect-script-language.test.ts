import assert from "node:assert/strict";
import test from "node:test";
import { detectScriptLanguage } from "../src/lib/video-generation/detect-script-language";

test("P04-B：口播稿含汉字 → zh-CN；否则沿用界面 locale", () => {
  assert.equal(detectScriptLanguage("一拧即开，随时补水。", "en-US"), "zh-CN");
  assert.equal(detectScriptLanguage("Twist once, sip anywhere.", "en-US"), "en-US");
  assert.equal(detectScriptLanguage("Twist once, sip anywhere.", "zh-CN"), "zh-CN");
  /// 混排：有汉字就按中文念（字幕按 CJK 规则断句）
  assert.equal(detectScriptLanguage("Aivora 宠物项圈，随时看见它。", "en-US"), "zh-CN");
  /// 空稿 / 纯标点数字：没有语言证据，交回界面 locale
  assert.equal(detectScriptLanguage("", "en-US"), "en-US");
  assert.equal(detectScriptLanguage("2026 · 9:16", "fr-FR"), "fr-FR");
  /// 假名 / 谚文不是汉字，不误判成中文
  assert.equal(detectScriptLanguage("こんにちは", "en-US"), "en-US");
  assert.equal(detectScriptLanguage("안녕하세요", "en-US"), "en-US");
});
