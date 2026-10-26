import assert from "node:assert/strict";
import test from "node:test";
import { detectScriptLanguage } from "../src/lib/video-generation/detect-script-language";

test("P04-B：假名 → 界面 locale；无假名含汉字 → zh-CN；无汉字含拉丁字母 → en-US；其余 → 界面 locale", () => {
  assert.equal(detectScriptLanguage("一拧即开，随时补水。", "en-US"), "zh-CN");
  assert.equal(detectScriptLanguage("Twist once, sip anywhere.", "zh-CN"), "en-US", "中文界面写英文稿 → 英文");
  assert.equal(detectScriptLanguage("Twist once, sip anywhere.", "en-US"), "en-US");
  /// 中英混排：有汉字就按中文念（字幕按 CJK 规则断句）
  assert.equal(detectScriptLanguage("Aivora 宠物项圈，随时看见它。", "en-US"), "zh-CN");
  /// 真实日文稿几乎都带汉字：先判假名，两种界面都交回界面 locale，不当成中文、不造 ja-JP
  assert.equal(detectScriptLanguage("東京タワーの夜景", "zh-CN"), "zh-CN");
  assert.equal(detectScriptLanguage("東京タワーの夜景", "en-US"), "en-US");
  assert.equal(detectScriptLanguage("こんにちは", "en-US"), "en-US");
  assert.equal(detectScriptLanguage("こんにちは", "zh-CN"), "zh-CN");
  /// 谚文：同样没有对应 locale，交回界面
  assert.equal(detectScriptLanguage("안녕하세요", "zh-CN"), "zh-CN");
  /// 空稿 / 纯标点数字：没有语言证据，交回界面 locale
  assert.equal(detectScriptLanguage("", "en-US"), "en-US");
  assert.equal(detectScriptLanguage("2026 · 9:16", "zh-CN"), "zh-CN");
  /// 带重音的拉丁字母也算拉丁
  assert.equal(detectScriptLanguage("Café à Montréal", "zh-CN"), "en-US");
});
