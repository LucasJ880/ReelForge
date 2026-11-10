/**
 * 口播稿长度的同一把尺（2026-11-10）。
 *
 * AI 起稿（voiceover-writer）、本地模板稿（audio-caption-controls）和创作页口播稿下面的字数提示都从这里取数，
 * 不再各写一份「4 字 / 秒」。原来界面只显示「34 / 2000」——2000 是接口的长度上限，对商家没有意义：
 * 15 秒的片写 200 字照样能提交，成片里说不完才发现。
 *
 * 两档：
 *  - 建议（budget）：中文约 4 字 / 秒、英文约 2.2 词 / 秒，说得从容；AI 起稿按这一档封顶。
 *  - 上限（ceiling）：中文约 5 字 / 秒（每 10 个字约 2 秒）、英文约 2.8 词 / 秒，再多就说不完。
 *
 * 纯函数、零依赖：'use client' 组件可以直接引用。
 */
import { detectScriptLanguage } from "./detect-script-language";

const ZH_CHARS_PER_SEC = 4;
const ZH_MAX_CHARS_PER_SEC = 5;
const EN_WORDS_PER_SEC = 2.2;
const EN_MAX_WORDS_PER_SEC = 2.8;

/** 建议长度：说得从容的字数 / 词数。 */
export function voiceoverBudget(durationSec: number, english: boolean): number {
  return english ? Math.max(12, Math.floor(durationSec * EN_WORDS_PER_SEC)) : durationSec * ZH_CHARS_PER_SEC;
}

/** 上限：超过这个数，这条片的时长里说不完。 */
export function voiceoverCeiling(durationSec: number, english: boolean): number {
  return english
    ? Math.max(voiceoverBudget(durationSec, true), Math.floor(durationSec * EN_MAX_WORDS_PER_SEC))
    : durationSec * ZH_MAX_CHARS_PER_SEC;
}

/** 说出口的长度：中文数字（不算空白与标点），英文数词。 */
export function measureSpokenLength(script: string, english: boolean): number {
  if (english) return script.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  return Array.from(script.replace(/[\s\p{P}\p{S}]+/gu, "")).length;
}

export type VoiceoverFit = "empty" | "ok" | "tight" | "over";

export interface VoiceoverLength {
  english: boolean;
  /** 字数（中文）或词数（英文） */
  count: number;
  budget: number;
  ceiling: number;
  /** 按从容语速说完大约要几秒 */
  estimatedSec: number;
  fit: VoiceoverFit;
}

export function assessVoiceoverLength(
  script: string,
  durationSec: number,
  fallbackLocale: string,
): VoiceoverLength {
  const english = detectScriptLanguage(script, fallbackLocale).toLowerCase().startsWith("en");
  const count = measureSpokenLength(script, english);
  const budget = voiceoverBudget(durationSec, english);
  const ceiling = voiceoverCeiling(durationSec, english);
  const estimatedSec = Math.round(count / (english ? EN_WORDS_PER_SEC : ZH_CHARS_PER_SEC));
  const fit: VoiceoverFit = count === 0 ? "empty" : count > ceiling ? "over" : count > budget ? "tight" : "ok";
  return { english, count, budget, ceiling, estimatedSec, fit };
}

/** 口播稿下面那一行字。界面语言决定说明文字，稿子语言决定数「字」还是数「词」。 */
export function voiceoverLengthHint(length: VoiceoverLength, durationSec: number, uiEnglish: boolean): string {
  const { count, budget, estimatedSec, fit } = length;
  if (uiEnglish) {
    const unit = length.english ? "words" : "characters";
    if (fit === "empty") return `Aim for up to ${budget} ${unit} for a ${durationSec}s video.`;
    const head = `${count} ${unit} · about ${estimatedSec}s to say`;
    if (fit === "over") return `${head} — too long for a ${durationSec}s video. Trim to about ${budget} ${unit}.`;
    if (fit === "tight") return `${head} — a little long for ${durationSec}s, so it will sound rushed.`;
    return `${head} (aim for up to ${budget} in a ${durationSec}s video)`;
  }
  const unit = length.english ? "词" : "字";
  if (fit === "empty") return `${durationSec} 秒的片建议 ${budget} ${unit}以内。`;
  const head = `${count} ${unit} · 说完约 ${estimatedSec} 秒`;
  if (fit === "over") return `${head}，${durationSec} 秒的片说不完，建议删到 ${budget} ${unit}以内。`;
  if (fit === "tight") return `${head}，比 ${durationSec} 秒略长，语速会偏快。`;
  return `${head}（${durationSec} 秒的片建议 ${budget} ${unit}以内）`;
}
