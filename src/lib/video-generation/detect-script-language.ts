/**
 * 口播稿语言检测（P04-B，2026-10-26）。
 *
 * 字幕 / 口播的 language 原来取界面 locale：英文界面写中文稿，Seedance 收到
 * `exact wording, en-US` 却念中文、字幕按拉丁断句规则切中文。这里只看稿子本身：
 *   - 含假名 → 沿用界面 locale（真实日文稿几乎都带汉字，先判假名才不会把它当中文；
 *     LOCALES 只有 zh-CN / en-US，不造 ja-JP）
 *   - 无假名、含汉字 → zh-CN
 *   - 无汉字、含拉丁字母 → en-US
 *   - 都没有（空稿、纯数字标点、谚文）→ 沿用界面 locale
 * 纯函数、零依赖，'use client' 组件可直接引用。
 */
const KANA_CHARACTER = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN_CHARACTER = /\p{Script=Han}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;

export function detectScriptLanguage(script: string, fallbackLocale: string): string {
  if (KANA_CHARACTER.test(script)) return fallbackLocale;
  if (HAN_CHARACTER.test(script)) return "zh-CN";
  if (LATIN_LETTER.test(script)) return "en-US";
  return fallbackLocale;
}
