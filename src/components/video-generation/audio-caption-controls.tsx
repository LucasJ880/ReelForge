"use client";

import { AudioLines, Captions, Music2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  BgmTrackId,
  CaptionPosition,
  CaptionStyle,
} from "@/types/video-generation";

export interface AudioCaptionControlValue {
  voiceoverEnabled: boolean;
  voiceId: string;
  voiceoverScript: string;
  captionsEnabled: boolean;
  captionStyle: CaptionStyle;
  captionPosition: CaptionPosition;
  exportSrt: boolean;
  bgmTrackId: BgmTrackId;
  bgmVolume: number;
}

export interface VoiceoverScriptInput {
  prompt: string;
  cta: string | null;
  durationSec: 15 | 30 | 60;
  language: string;
  templateId: string | null;
}

interface AudioCaptionControlsProps {
  value: AudioCaptionControlValue;
  english: boolean;
  disabled?: boolean;
  onChange: (next: AudioCaptionControlValue) => void;
  onRegenerate: () => void;
}

const VOICE_OPTIONS = [
  {
    id: "warm-confident",
    zh: "温暖自信",
    en: "Warm and confident",
  },
  {
    id: "natural-friendly",
    zh: "自然亲切",
    en: "Natural and friendly",
  },
  {
    id: "energetic-creator",
    zh: "活力创作者",
    en: "Energetic creator",
  },
  {
    id: "calm-premium",
    zh: "沉稳高级",
    en: "Calm and premium",
  },
] as const;

function compactText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function withoutEndingPunctuation(value: string): string {
  return value.replace(/[。！？!?.,，；;:\s]+$/gu, "");
}

function sentence(value: string, english: boolean): string {
  const clean = withoutEndingPunctuation(compactText(value));
  if (!clean) return "";
  return `${clean}${english ? "." : "。"}`;
}

function chineseHook(templateId: string | null): string {
  if (templateId === "commerce-ugc-testimonial") return "我实际体验了一段时间";
  if (templateId === "commerce-demo-first-reveal") return "先看实际效果";
  if (templateId === "commerce-problem-solution") {
    return "这个日常问题终于有了简单答案";
  }
  return "先看它如何改变日常体验";
}

function englishHook(templateId: string | null): string {
  if (templateId === "commerce-ugc-testimonial") return "I put this to the test";
  if (templateId === "commerce-demo-first-reveal") return "Start with the real result";
  if (templateId === "commerce-problem-solution") {
    return "This everyday problem finally has a simple answer";
  }
  return "See how it changes the everyday experience";
}

function joinWithinChineseLimit(
  hook: string,
  prompt: string,
  cta: string,
  maxCharacters: number,
): string {
  const ctaSentence = sentence(cta, false);
  const hookSentence = sentence(hook, false);
  const availableForPrompt = Math.max(
    0,
    maxCharacters
      - Array.from(hookSentence).length
      - Array.from(ctaSentence).length,
  );
  const clippedPrompt = Array.from(withoutEndingPunctuation(prompt))
    .slice(0, Math.max(0, availableForPrompt - 1))
    .join("");
  const result = `${hookSentence}${sentence(clippedPrompt, false)}${ctaSentence}`;
  return Array.from(result).slice(0, maxCharacters).join("");
}

function joinWithinEnglishLimit(
  hook: string,
  prompt: string,
  cta: string,
  maxWords: number,
): string {
  const hookWords = withoutEndingPunctuation(hook).split(/\s+/u).filter(Boolean);
  const promptWords = withoutEndingPunctuation(prompt).split(/\s+/u).filter(Boolean);
  const ctaWords = withoutEndingPunctuation(cta).split(/\s+/u).filter(Boolean);
  const promptBudget = Math.max(0, maxWords - hookWords.length - ctaWords.length);
  return [
    sentence(hookWords.join(" "), true),
    sentence(promptWords.slice(0, promptBudget).join(" "), true),
    sentence(ctaWords.join(" "), true),
  ].filter(Boolean).join(" ");
}

/**
 * Produces a short, deterministic first draft. It intentionally stays local:
 * the final wording remains editable and Seedance speaks this exact script.
 */
export function generateVoiceoverScript(input: VoiceoverScriptInput): string {
  const english = input.language.toLowerCase().startsWith("en");
  const prompt = compactText(input.prompt)
    || (english
      ? "This product makes the everyday routine simpler"
      : "这款产品让日常使用更简单");
  const cta = compactText(input.cta ?? "")
    || (english ? "See it in action" : "现在看看实际效果");

  if (english) {
    return joinWithinEnglishLimit(
      englishHook(input.templateId),
      prompt,
      cta,
      Math.max(12, Math.floor(input.durationSec * 2.2)),
    );
  }

  return joinWithinChineseLimit(
    chineseHook(input.templateId),
    prompt,
    cta,
    input.durationSec * 4,
  );
}

export function AudioCaptionControls({
  value,
  english,
  disabled = false,
  onChange,
  onRegenerate,
}: AudioCaptionControlsProps) {
  const update = (patch: Partial<AudioCaptionControlValue>) => {
    onChange({ ...value, ...patch });
  };

  return (
    <Card data-testid="audio-caption-controls">
      <CardHeader className="grid grid-cols-[auto_1fr] items-center gap-x-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-primary font-mono text-meta font-semibold text-primary-foreground">
          6
        </span>
        <div>
          <CardTitle>
            {english ? "Voice, captions, and music" : "口播、字幕与配乐"}
          </CardTitle>
          <p className="mt-1 text-meta text-muted-foreground">
            {english
              ? "Seedance creates native speech from your final script. Captions are timed deterministically after the video is rendered."
              : "Seedance 按最终脚本生成原生口播；成片后再按实际时长确定性生成字幕。"}
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <section className="rounded-(--radius-md) border border-border bg-secondary p-4">
          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span className="flex min-w-0 gap-3">
              <AudioLines className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <span>
                <span className="block text-body font-semibold text-foreground">
                  {english ? "Seedance native voiceover" : "Seedance 原生口播"}
                </span>
                <span className="mt-0.5 block text-meta text-muted-foreground">
                  {english
                    ? "Spoken directly by the generated video—no legacy TTS."
                    : "由生成视频直接说出，不使用旧 TTS 接口。"}
                </span>
              </span>
            </span>
            <input
              type="checkbox"
              checked={value.voiceoverEnabled}
              disabled={disabled}
              className="mt-1 size-4 accent-primary"
              onChange={(event) => update({ voiceoverEnabled: event.target.checked })}
            />
          </label>

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem]">
            <label className="text-meta font-medium text-muted-foreground">
              {english ? "Final spoken script" : "最终口播稿"}
              <textarea
                value={value.voiceoverScript}
                maxLength={2000}
                rows={5}
                disabled={disabled || !value.voiceoverEnabled}
                className="mt-2 min-h-32 w-full resize-y rounded-(--radius-md) border border-input bg-card px-3 py-2 text-body leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
                onChange={(event) => update({ voiceoverScript: event.target.value })}
              />
              <span className="mt-1 block text-right font-mono text-meta tabular-nums">
                {value.voiceoverScript.length} / 2000
              </span>
            </label>

            <div className="space-y-3">
              <label className="block text-meta font-medium text-muted-foreground">
                {english ? "Voice direction" : "声音风格"}
                <select
                  value={value.voiceId}
                  disabled={disabled || !value.voiceoverEnabled}
                  className="mt-2 h-(--control-height) w-full rounded-(--radius-md) border border-input bg-card px-3 text-body text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
                  onChange={(event) => update({ voiceId: event.target.value })}
                >
                  {VOICE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {english ? option.en : option.zh}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={disabled}
                onClick={onRegenerate}
              >
                <RefreshCw aria-hidden />
                {english ? "Generate voiceover script" : "生成口播稿"}
              </Button>
            </div>
          </div>
        </section>

        <details className="group rounded-(--radius-md) border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-body font-semibold text-foreground">
            <span className="flex items-center gap-2">
              <Captions className="size-5 text-primary" aria-hidden />
              {english ? "Caption and BGM controls" : "字幕与 BGM 高级设置"}
            </span>
            <span className="text-meta font-normal text-muted-foreground group-open:hidden">
              {english ? "Show" : "展开"}
            </span>
            <span className="hidden text-meta font-normal text-muted-foreground group-open:inline">
              {english ? "Hide" : "收起"}
            </span>
          </summary>

          <div className="grid gap-5 border-t border-border px-4 py-4 lg:grid-cols-2">
            <section className="space-y-3">
              <label className="flex cursor-pointer items-center justify-between gap-4">
                <span>
                  <span className="block text-body font-semibold text-foreground">
                    {english ? "Deterministic captions" : "确定性字幕"}
                  </span>
                  <span className="block text-meta text-muted-foreground">
                    {english
                      ? "Built from the final script and actual video duration."
                      : "基于最终口播稿与成片实际时长生成。"}
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
                    value={value.captionStyle}
                    disabled={disabled || !value.captionsEnabled}
                    className="mt-2 h-(--control-height) w-full rounded-(--radius-md) border border-input bg-card px-3 text-body text-foreground disabled:opacity-50"
                    onChange={(event) => update({
                      captionStyle: event.target.value as CaptionStyle,
                    })}
                  >
                    <option value="word_by_word">
                      {english ? "Word by word" : "逐词强调"}
                    </option>
                    <option value="karaoke">
                      {english ? "Karaoke" : "跟读高亮"}
                    </option>
                    <option value="plain">
                      {english ? "Clean" : "简洁字幕"}
                    </option>
                  </select>
                </label>
                <label className="text-meta font-medium text-muted-foreground">
                  {english ? "Position" : "字幕位置"}
                  <select
                    value={value.captionPosition}
                    disabled={disabled || !value.captionsEnabled}
                    className="mt-2 h-(--control-height) w-full rounded-(--radius-md) border border-input bg-card px-3 text-body text-foreground disabled:opacity-50"
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

            <section className="space-y-3">
              <div className="flex items-start gap-2">
                <Music2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="text-body font-semibold text-foreground">
                    {english ? "Licensed background music" : "授权背景音乐"}
                  </p>
                  <p className="text-meta text-muted-foreground">
                    {english
                      ? "Off by default so native speech stays clear."
                      : "默认关闭，确保原生口播清晰。"}
                  </p>
                </div>
              </div>

              <label className="block text-meta font-medium text-muted-foreground">
                {english ? "Track" : "曲目"}
                <select
                  value={value.bgmTrackId}
                  disabled={disabled}
                  className="mt-2 h-(--control-height) w-full rounded-(--radius-md) border border-input bg-card px-3 text-body text-foreground disabled:opacity-50"
                  onChange={(event) => update({
                    bgmTrackId: event.target.value as BgmTrackId,
                  })}
                >
                  <option value="none">{english ? "No music" : "不添加音乐"}</option>
                  <option value="wholesome">Wholesome — Kevin MacLeod</option>
                </select>
              </label>

              <label className="block text-meta font-medium text-muted-foreground">
                <span className="flex justify-between">
                  <span>{english ? "Music volume" : "音乐音量"}</span>
                  <span className="font-mono tabular-nums">
                    {Math.round(value.bgmVolume * 100)}%
                  </span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="0.35"
                  step="0.01"
                  value={value.bgmVolume}
                  disabled={disabled || value.bgmTrackId === "none"}
                  className="mt-2 w-full accent-primary disabled:opacity-50"
                  onChange={(event) => update({
                    bgmVolume: Number(event.target.value),
                  })}
                />
              </label>

              <p className="rounded-(--radius-sm) bg-secondary px-3 py-2 text-meta text-muted-foreground">
                Wholesome by Kevin MacLeod · CC BY 4.0
              </p>
            </section>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
