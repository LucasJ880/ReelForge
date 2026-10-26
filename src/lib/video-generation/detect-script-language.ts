/**
 * 口播稿语言检测（P04-B，2026-10-26）。
 *
 * 字幕 / 口播的 language 原来取界面 locale：英文界面写中文稿，Seedance 收到
 * `exact wording, en-US` 却念中文、字幕按拉丁断句规则切中文。这里只看稿子本身：
 * 含汉字 → zh-CN；否则沿用界面 locale（英文稿在中文界面照旧 zh-CN 以外的 locale 走界面）。
 * 纯函数、零依赖，'use client' 组件可直接引用。
 */
const HAN_CHARACTER = /\p{Script=Han}/u;

export function detectScriptLanguage(script: string, fallbackLocale: string): string {
  if (HAN_CHARACTER.test(script)) return "zh-CN";
  return fallbackLocale;
}
