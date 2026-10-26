"use client";

import { AudioLines, Captions, Music2, RefreshCw } from "lucide-react";
import { TickGlyph, tickToneClass } from "@/components/exchange/status-tick";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { bgmAttributionForTrack } from "@/lib/video-generation/bgm-attribution";
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
  /**
   * C4 · AI 写作暂停时为 true：按钮写明「按模板」，并提示这份稿是模板起的、要按产品改一改。
   * （起稿本身一直是本地确定性模板，见 generateVoiceoverScript——这里不许暗示 AI 在写。）
   */
  draftFromTemplate?: boolean;
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

/**
 * 字幕样式只列渲染层真实做得到的观感。audio-post-production 的 renderAssCaptions
 * 只分两档：plain = 常规字重细描边，其余 = 粗体加厚描边；word_by_word / karaoke
 * 应有的逐词时间轴高亮没有实现，原来那两个选项先隐藏（1025 A6 7.5），别再给客户
 * 许诺做不到的效果。
 * 类型与服务端 schema 仍保留三值：已保存 / 默认的 word_by_word、karaoke 照常提交，
 * 界面上归到它们真实的那一档「醒目描边」，用户不改就不动原值。
 */
export const CAPTION_STYLE_OPTIONS = [
  { value: "word_by_word", zh: "醒目描边", en: "Bold outline" },
  { value: "plain", zh: "简洁字幕", en: "Clean" },
] as const satisfies readonly { value: CaptionStyle; zh: string; en: string }[];

export function captionStyleSelectValue(
  style: CaptionStyle,
): (typeof CAPTION_STYLE_OPTIONS)[number]["value"] {
  return style === "plain" ? "plain" : "word_by_word";
}

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

/*
 * 视频提示词是写给镜头的（时长、画幅、特写、布光），口播稿是说给观众的。原来整段塞进口播，
 * 成片会念出「15 秒 9:16 真实 UGC 演示」、还在半句处截断（1025 真机验收）。这里按分句取用：
 * 丢掉规格与镜头调度分句，只在句读处截断。
 */
const SPEC_CLAUSE_ZH = /\d+\s*(?:秒|s\b|sec)|\d+\s*[:：]\s*\d+|竖屏|横屏|方形|画幅|UGC|分镜|4K|高清/iu;
const CAMERA_CLAUSE_ZH =
  /^(?:镜头|特写|近景|远景|全景|中景|运镜|慢动作|俯拍|仰拍|航拍|推近|拉远|转场|布光|画面|背景|光线|色调|调色|配乐|背景音乐|BGM|字幕|口播)/iu;
const LIGHTING_CLAUSE_ZH = /^[^，。]{0,6}(?:光|光线|色调)$/u;
const SPEC_CLAUSE_EN =
  /\b\d+\s*(?:s|sec|secs|seconds)\b|\b\d+\s*:\s*\d+\b|\b(?:ugc|vertical|horizontal|square|aspect|close-?up|wide shot|camera|lighting|lit|slow[- ]motion|aerial|pov|b-?roll|4k|storyboard|captions?|voice-?over)\b/iu;

function narrationClauses(prompt: string, english: boolean): string[] {
  const clauses = compactText(prompt)
    /// 画幅（9:16）先整体拿掉：否则按冒号分句会把它切成「15 秒 9」和「16」，后者漏进口播
    .replace(/\d+\s*[:：]\s*\d+/gu, " ")
    .split(english ? /[.!?;:\n]+|,\s+/u : /[。！？!?；;，,：:\n]+/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause && !/^[\d\s.]+$/u.test(clause));
  if (english) return clauses.filter((clause) => !SPEC_CLAUSE_EN.test(clause));
  return clauses
    .filter((clause) => !SPEC_CLAUSE_ZH.test(clause) && !CAMERA_CLAUSE_ZH.test(clause) && !LIGHTING_CLAUSE_ZH.test(clause))
    .map((clause) => clause.replace(/^(?:产品|商品)(?:是|为)/u, "").trim())
    .filter(Boolean);
}

/** 按分句装进预算；一句都放不下时才截断第一句（不留半句话在中间）。 */
function fitClauses(clauses: string[], budget: number, measure: (text: string) => number, joiner: string): string {
  const kept: string[] = [];
  for (const clause of clauses) {
    const next = [...kept, clause].join(joiner);
    if (measure(next) > budget) break;
    kept.push(clause);
  }
  if (kept.length > 0 || clauses.length === 0) return kept.join(joiner);
  return Array.from(clauses[0]).slice(0, Math.max(0, budget)).join("");
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
  const body = fitClauses(
    narrationClauses(prompt, false),
    Math.max(0, availableForPrompt - 1),
    (text) => Array.from(text).length,
    "，",
  );
  const result = `${hookSentence}${sentence(body, false)}${ctaSentence}`;
  return Array.from(result).slice(0, maxCharacters).join("");
}

function joinWithinEnglishLimit(
  hook: string,
  prompt: string,
  cta: string,
  maxWords: number,
): string {
  const hookWords = withoutEndingPunctuation(hook).split(/\s+/u).filter(Boolean);
  const ctaWords = withoutEndingPunctuation(cta).split(/\s+/u).filter(Boolean);
  const promptBudget = Math.max(0, maxWords - hookWords.length - ctaWords.length);
  const body = fitClauses(
    narrationClauses(prompt, true),
    promptBudget,
    (text) => text.split(/\s+/u).filter(Boolean).length,
    ", ",
  );
  const bodyWords = body.split(/\s+/u).filter(Boolean).slice(0, promptBudget);
  return [
    sentence(hookWords.join(" "), true),
    sentence(bodyWords.join(" "), true),
    sentence(ctaWords.join(" "), true),
  ].filter(Boolean).join(" ");
}

/**
 * Produces a short, deterministic first draft. It intentionally stays local:
 * the final wording remains editable and the video model speaks this exact script.
 */
export function generateVoiceoverScript(input: VoiceoverScriptInput): string {
  const english = input.language.toLowerCase().startsWith("en");
  const fallbackPrompt = english
    ? "This product makes the everyday routine simpler"
    : "这款产品让日常使用更简单";
  // 提示词只剩规格与镜头调度（没有可说给观众的内容）时，用默认句，不念规格。
  const prompt = narrationClauses(input.prompt, english).length > 0 ? compactText(input.prompt) : fallbackPrompt;
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
  draftFromTemplate = false,
}: AudioCaptionControlsProps) {
  const update = (patch: Partial<AudioCaptionControlValue>) => {
    onChange({ ...value, ...patch });
  };
  const bgmAttribution = bgmAttributionForTrack(value.bgmTrackId);

  return (
    // 下单票第 06 行：编号与标题由所在行承担，这里只放控件（不再自带卡片外壳）。
    <div data-testid="audio-caption-controls" className="space-y-4">
        <section className="space-y-3">
          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span className="flex min-w-0 gap-3">
              <AudioLines className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                <span className="block text-body font-semibold text-foreground">
                  {english ? "Native voiceover" : "原生口播"}
                </span>
                <span className="mt-0.5 block text-meta text-muted-foreground">
                  {/* A6：视频模型按口播稿尽力说出，不保证口型同步，也不保证逐字（以成片为准） */}
                  {english
                    ? "The video model voices your script as best it can — lip-sync and exact wording aren't guaranteed; check the finished video."
                    : "由视频模型按口播稿尽力直接说出；不保证口型同步、也不保证逐字，以成片为准。"}
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
                className="mt-2 min-h-32 w-full resize-y rounded-(--radius-md) x-well border-input px-3 py-2 text-body leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
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
                  className="mt-2 h-(--control-height) w-full rounded-(--radius-md) x-well border-input px-3 text-body text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
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
                data-draft-source={draftFromTemplate ? "template" : undefined}
              >
                <RefreshCw aria-hidden />
                {draftFromTemplate
                  ? english ? "Draft script from template" : "按模板生成口播稿"
                  : english ? "Generate voiceover script" : "生成口播稿"}
              </Button>
            </div>
          </div>
          {draftFromTemplate ? (
            <p data-testid="voiceover-template-notice" className="flex items-start gap-2 text-meta text-muted-foreground">
              <TickGlyph tone="fault" className={cn("mt-[0.3em]", tickToneClass("fault"))} />
              <span className="text-pretty">
                {english
                  ? "AI writing is paused: this draft comes from a template, so tailor it to your product before generating."
                  : "AI 写作暂停：这份口播稿按模板起稿，请按你的产品改一改再生成。"}
              </span>
            </p>
          ) : null}
        </section>

        <details className="group border-t border-border pt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-1 text-body font-semibold text-foreground">
            <span className="flex items-center gap-2">
              <Captions className="size-5 text-muted-foreground" aria-hidden />
              {english ? "Caption and BGM controls" : "字幕与 BGM 高级设置"}
            </span>
            <span className="text-meta font-normal text-muted-foreground group-open:hidden">
              {english ? "Show" : "展开"}
            </span>
            <span className="hidden text-meta font-normal text-muted-foreground group-open:inline">
              {english ? "Hide" : "收起"}
            </span>
          </summary>

          <div className="mt-3 grid gap-5 border-t border-border pt-4 lg:grid-cols-2">
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
                    value={captionStyleSelectValue(value.captionStyle)}
                    disabled={disabled || !value.captionsEnabled}
                    className="mt-2 h-(--control-height) w-full rounded-(--radius-md) x-well border-input px-3 text-body text-foreground disabled:opacity-50"
                    onChange={(event) => update({
                      captionStyle: event.target.value as CaptionStyle,
                    })}
                  >
                    {CAPTION_STYLE_OPTIONS.map((option) => (
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

            <section className="space-y-3">
              <div className="flex items-start gap-2">
                <Music2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
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
                  className="mt-2 h-(--control-height) w-full rounded-(--radius-md) x-well border-input px-3 text-body text-foreground disabled:opacity-50"
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

              {bgmAttribution ? (
                // CC BY 4.0：客户发布时要带署名，选曲时就把要贴的那一行给到；交付面用同一个 bgm-attribution
                <p className="border-l-2 border-border pl-3 text-meta text-muted-foreground">
                  {english
                    ? "CC BY 4.0 music: credit it in your post caption when you publish."
                    : "CC BY 4.0 授权配乐：发布时请把下面这行署名放进帖子文案。"}
                  <span className="mt-1 block break-words text-foreground">
                    {bgmAttribution}
                  </span>
                </p>
              ) : null}
            </section>
          </div>
        </details>
    </div>
  );
}
