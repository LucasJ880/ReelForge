"use client";

import { Captions } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  assessVoiceoverLength,
  voiceoverLengthHint,
} from "@/lib/video-generation/voiceover-budget";
import type {
  BgmTrackId,
  CaptionPosition,
  CaptionStyle,
} from "@/types/video-generation";

/**
 * 创作页的声音与字幕设置（2026-11-17 起只有导演线路）：台词、配音、配乐都由 AI 导演写进镜头脚本、出片模型直接配，
 * 所以这里只留两样——一个可不填的输入框（商家想让 AI 照着念的稿子）和字幕设置。
 * 「原生口播」开关、声音风格、按模板起口播稿、曲库随老线路一起删了；voiceId / bgm 两个字段留在值里只为请求形状不变。
 */
export interface AudioCaptionControlValue {
  /// 商家自己写的口播稿；空 = 让 AI 按描述给每个镜头写一句
  voiceoverScript: string;
  captionsEnabled: boolean;
  captionStyle: CaptionStyle;
  captionPosition: CaptionPosition;
  exportSrt: boolean;
  bgmTrackId: BgmTrackId;
  bgmVolume: number;
}

interface AudioCaptionControlsProps {
  value: AudioCaptionControlValue;
  english: boolean;
  disabled?: boolean;
  /** 这条片的时长：口播稿下面按它提示「说不说得完」。不传就不提示。 */
  durationSec?: number;
  onChange: (next: AudioCaptionControlValue) => void;
  /**
   * P04-B · 这条成片能拿到逐词时间戳时为 true：字幕样式放出「跟读高亮 / 逐词强调」真分档。
   * 默认 false：只列两档。
   */
  wordTimestampsAvailable?: boolean;
}

/**
 * 字幕样式只列渲染层真实做得到的观感。
 *
 * 没有逐词时间戳（Phase 1 的常态）：renderAssCaptions 只分两档——plain = 常规字重细描边，
 * 其余 = 粗体加厚描边；word_by_word / karaoke 的逐词高亮渲染不出来，所以只列两档
 * （1025 A6 7.5），别给客户许诺做不到的效果。已保存 / 默认的 word_by_word、karaoke
 * 照常提交，界面上归到它们真实的那一档「醒目描边」，用户不改就不动原值。
 *
 * 有逐词时间戳（P04-B，由 wordTimestampsAvailable 打开）：渲染层真的会逐词染金
 * （karaoke 用 \kf 填充、word_by_word 每词一条 Dialogue），三档全列、不再折叠。
 */
export const CAPTION_STYLE_OPTIONS = [
  { value: "word_by_word", zh: "醒目描边", en: "Bold outline" },
  { value: "plain", zh: "简洁字幕", en: "Clean" },
] as const satisfies readonly { value: CaptionStyle; zh: string; en: string }[];

export const TIMED_CAPTION_STYLE_OPTIONS = [
  { value: "karaoke", zh: "跟读高亮", en: "Karaoke highlight" },
  { value: "word_by_word", zh: "逐词强调", en: "Word by word" },
  { value: "plain", zh: "简洁字幕", en: "Clean" },
] as const satisfies readonly { value: CaptionStyle; zh: string; en: string }[];

export function captionStyleOptions(
  wordTimestampsAvailable: boolean,
): readonly { value: CaptionStyle; zh: string; en: string }[] {
  return wordTimestampsAvailable ? TIMED_CAPTION_STYLE_OPTIONS : CAPTION_STYLE_OPTIONS;
}

export function captionStyleSelectValue(
  style: CaptionStyle,
  wordTimestampsAvailable = false,
): CaptionStyle {
  if (wordTimestampsAvailable) return style;
  return style === "plain" ? "plain" : "word_by_word";
}

export function AudioCaptionControls({
  value,
  english,
  disabled = false,
  durationSec,
  onChange,
  wordTimestampsAvailable = false,
}: AudioCaptionControlsProps) {
  const update = (patch: Partial<AudioCaptionControlValue>) => {
    onChange({ ...value, ...patch });
  };
  const scriptLength = durationSec && value.voiceoverScript.trim()
    ? assessVoiceoverLength(value.voiceoverScript, durationSec, english ? "en-US" : "zh-CN")
    : null;

  return (
    <div data-testid="audio-caption-controls" className="space-y-4">
      <section className="space-y-2" data-testid="director-script-input">
        <label className="block text-meta font-medium text-muted-foreground">
          {english ? "Your own voiceover script (optional)" : "想让 AI 照着念的口播稿（可不填）"}
          <textarea
            value={value.voiceoverScript}
            maxLength={2000}
            rows={3}
            disabled={disabled}
            placeholder={
              english
                ? "Leave it empty and the AI writes one line per shot from your description."
                : "不填的话，AI 会按你的描述给每个镜头写一句台词。"
            }
            className="mt-2 min-h-20 w-full resize-y rounded-(--radius-md) x-well border-input px-3 py-2 text-body leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(event) => update({ voiceoverScript: event.target.value })}
          />
          {/* 按时长提示说不说得完（同一把尺：voiceover-budget） */}
          {scriptLength ? (
            <span
              data-testid="voiceover-length-hint"
              data-fit={scriptLength.fit}
              aria-live="polite"
              className={cn(
                "mt-1 block text-pretty text-meta font-normal tabular-nums",
                scriptLength.fit === "over"
                  ? "text-danger"
                  : scriptLength.fit === "tight"
                    ? "text-gold"
                    : "text-tertiary",
              )}
            >
              {voiceoverLengthHint(scriptLength, durationSec ?? 0, english)}
            </span>
          ) : null}
        </label>
      </section>

      <details className="group border-t border-border pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-1 text-body font-semibold text-foreground">
          <span className="flex items-center gap-2">
            <Captions className="size-5 text-muted-foreground" aria-hidden />
            {english ? "Caption settings" : "字幕设置"}
          </span>
          <span className="text-meta font-normal text-muted-foreground group-open:hidden">
            {english ? "Show" : "展开"}
          </span>
          <span className="hidden text-meta font-normal text-muted-foreground group-open:inline">
            {english ? "Hide" : "收起"}
          </span>
        </summary>

        <section className="mt-3 max-w-xl space-y-3 border-t border-border pt-4">
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block text-body font-semibold text-foreground">
                {english ? "Burn captions into the video" : "把字幕烧进成片"}
              </span>
              <span className="block text-meta text-muted-foreground">
                {english ? "Each line appears while its shot is on screen." : "每句台词跟着它所在的镜头出现。"}
              </span>
            </span>
            <input
              type="checkbox"
              checked={value.captionsEnabled}
              disabled={disabled}
              className="size-4 accent-primary"
              onChange={(event) => update({ captionsEnabled: event.target.checked })}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-meta font-medium text-muted-foreground">
              {english ? "Style" : "字幕样式"}
              <select
                value={captionStyleSelectValue(value.captionStyle, wordTimestampsAvailable)}
                disabled={disabled || !value.captionsEnabled}
                className="mt-2 h-(--control-height) w-full rounded-(--radius-md) x-well border-input px-3 text-body text-foreground disabled:opacity-50"
                onChange={(event) => update({
                  captionStyle: event.target.value as CaptionStyle,
                })}
              >
                {captionStyleOptions(wordTimestampsAvailable).map((option) => (
                  <option key={option.value} value={option.value}>
                    {english ? option.en : option.zh}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-meta font-medium text-muted-foreground">
              {english ? "Position" : "字幕位置"}
              <select
                value={value.captionPosition}
                disabled={disabled || !value.captionsEnabled}
                className="mt-2 h-(--control-height) w-full rounded-(--radius-md) x-well border-input px-3 text-body text-foreground disabled:opacity-50"
                onChange={(event) => update({
                  captionPosition: event.target.value as CaptionPosition,
                })}
              >
                <option value="bottom">{english ? "Bottom" : "底部"}</option>
                <option value="center">{english ? "Center" : "居中"}</option>
                <option value="top">{english ? "Top" : "顶部"}</option>
              </select>
            </label>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-4 text-meta text-muted-foreground">
            {english ? "Include a downloadable SRT file" : "同时提供可下载的 SRT 文件"}
            <input
              type="checkbox"
              checked={value.exportSrt}
              disabled={disabled || !value.captionsEnabled}
              className="size-4 accent-primary"
              onChange={(event) => update({ exportSrt: event.target.checked })}
            />
          </label>
        </section>
      </details>
    </div>
  );
}
