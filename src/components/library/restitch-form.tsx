"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Captions, Loader2, Music2, Stamp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CAPTION_STYLE_OPTIONS,
  captionStyleSelectValue,
} from "@/components/video-generation/audio-caption-controls";
import { requestPulseRefresh } from "@/lib/exchange/pulse";
import { SIGNOFF_BRAND_MAX, SIGNOFF_CTA_MAX } from "@/lib/video-generation/brand-signoff";
import type {
  BgmTrackId,
  CaptionPosition,
  CaptionSettings,
  CaptionStyle,
} from "@/types/video-generation";

/**
 * 成品库详情 · P05-B 只重拼：READY 成片换字幕样式 / 位置 / BGM。
 *
 * 复用 AudioCaptionControls 的字幕样式 / 位置 / BGM 子集（同一份选项与样式类），不放口播：
 * 改口播稿要重新生成，不是重拼。提交到 render-retry 的 { restitch } 分支，零生成计费；
 * 服务端限流 action "restitch"；合成没成会自动回滚到旧成片。
 */
export interface RestitchDefaults {
  captions: CaptionSettings;
  bgm: { trackId: BgmTrackId; volume: number };
  /** 这条成片现在的片尾落款；没设过 = null */
  signoff?: { enabled: boolean; brandName: string; cta?: string | null; logo?: boolean } | null;
}

export type SignoffCopy = {
  title: string;
  hint: string;
  brandLabel: string;
  brandPlaceholder: string;
  ctaLabel: string;
  ctaPlaceholder: string;
  brandRequired: string;
  /** 「在品牌名上方带上 Logo」；{name} = 品牌包的名字 */
  logoToggle: string;
  logoHint: string;
};

const SELECT_CLASS =
  "mt-2 h-(--control-height) w-full rounded-(--radius-md) x-well border-input px-3 text-body text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50";

export function RestitchForm({
  briefId,
  english,
  defaults,
  branded = false,
  signoffSuggestion = null,
  signoffCopy,
  copy,
}: {
  briefId: string;
  english: boolean;
  defaults: RestitchDefaults;
  /** 已有品牌封装成片：提示换完要重新封装（服务端会清空旧封装） */
  branded?: boolean;
  /** 第一次勾选落款时预填的品牌名 / 行动指引：商家自己工作区的默认品牌包（不取全局包）；商家可以改 */
  signoffSuggestion?: { brandName: string; cta: string | null; packageName?: string; logoUrl?: string | null } | null;
  signoffCopy: SignoffCopy;
  copy: {
    title: string;
    hint: string;
    submit: string;
    submitting: string;
    started: string;
    invalidState: string;
    rateLimited: string;
    failed: string;
    repackageHint: string;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "fault"; text: string } | null>(null);
  const [captionsEnabled, setCaptionsEnabled] = useState(defaults.captions.enabled);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(defaults.captions.style);
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>(defaults.captions.position);
  const [bgmTrackId, setBgmTrackId] = useState<BgmTrackId>(defaults.bgm.trackId);
  const [bgmVolume, setBgmVolume] = useState(defaults.bgm.volume);
  /// 片尾落款：默认不带；勾上才出现两个输入框，预填这条成片上次用的，其次是自己的默认品牌包
  const savedSignoff = defaults.signoff ?? null;
  const [signoffEnabled, setSignoffEnabled] = useState(Boolean(savedSignoff?.enabled));
  const [signoffBrand, setSignoffBrand] = useState(savedSignoff?.brandName || signoffSuggestion?.brandName || "");
  const [signoffCta, setSignoffCta] = useState(savedSignoff?.cta ?? signoffSuggestion?.cta ?? "");
  /// Logo：只有自己的品牌包里有 Logo 才给这个选项；用哪张图由服务端按账号取，这里只传一个开关
  const logoAvailable = Boolean(signoffSuggestion?.logoUrl);
  const [signoffLogo, setSignoffLogo] = useState(Boolean(savedSignoff?.logo) && logoAvailable);
  const signoffEffect = (enabled: boolean, brand: string, cta: string | null | undefined, logo: boolean) =>
    enabled && brand.trim() ? `${brand.trim()}\n${cta?.trim() ?? ""}\n${logo ? "logo" : ""}` : "off";
  const signoffChanged =
    signoffEffect(signoffEnabled, signoffBrand, signoffCta, signoffLogo) !==
    signoffEffect(Boolean(savedSignoff?.enabled), savedSignoff?.brandName ?? "", savedSignoff?.cta, Boolean(savedSignoff?.logo));
  const signoffInvalid = signoffEnabled && !signoffBrand.trim();

  const unchanged =
    captionsEnabled === defaults.captions.enabled &&
    captionStyle === defaults.captions.style &&
    captionPosition === defaults.captions.position &&
    bgmTrackId === defaults.bgm.trackId &&
    bgmVolume === defaults.bgm.volume &&
    !signoffChanged;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unchanged || submitting || signoffInvalid) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/briefs/${briefId}/render-retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          restitch: {
            captions: {
              ...defaults.captions,
              enabled: captionsEnabled,
              style: captionStyle,
              position: captionPosition,
            },
            bgm: { trackId: bgmTrackId, volume: bgmTrackId === "none" ? 0 : bgmVolume },
            /// 落款有变化才带上（没动过的老成片不平白多一个键）
            ...(signoffChanged
              ? {
                  signoff: {
                    enabled: signoffEnabled,
                    brandName: signoffBrand.trim(),
                    cta: signoffCta.trim() || null,
                    ...(signoffLogo && logoAvailable ? { logo: true } : {}),
                  },
                }
              : {}),
          },
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { code?: string; error?: string } | null;
        const text =
          body?.code === "RATE_LIMITED"
            ? copy.rateLimited
            : body?.code === "INVALID_STATE"
              ? copy.invalidState
              : body?.code === "VALIDATION_FAILED" && body.error
                ? body.error
                : copy.failed;
        setFeedback({ tone: "fault", text });
        return;
      }
      setFeedback({ tone: "ok", text: copy.started });
      requestPulseRefresh();
      startTransition(() => router.refresh());
    } catch {
      setFeedback({ tone: "fault", text: copy.failed });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      data-testid="restitch-form"
      aria-label={copy.title}
      className="flex min-w-0 flex-col gap-3 border-t border-border pt-4"
    >
      <div>
        <p className="flex items-center gap-2 text-body font-semibold text-foreground">
          <Captions className="size-4 text-muted-foreground" aria-hidden />
          {copy.title}
        </p>
        <p className="mt-1 text-meta text-muted-foreground">{copy.hint}</p>
        {branded ? <p className="mt-1 text-meta text-muted-foreground">{copy.repackageHint}</p> : null}
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-4 text-body text-foreground">
        {english ? "Captions" : "字幕"}
        <input
          type="checkbox"
          checked={captionsEnabled}
          disabled={submitting}
          className="size-4 accent-primary"
          onChange={(event) => setCaptionsEnabled(event.target.checked)}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-meta font-medium text-muted-foreground">
          {english ? "Style" : "字幕样式"}
          <select
            value={captionStyleSelectValue(captionStyle)}
            disabled={submitting || !captionsEnabled}
            className={SELECT_CLASS}
            onChange={(event) => setCaptionStyle(event.target.value as CaptionStyle)}
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
            value={captionPosition}
            disabled={submitting || !captionsEnabled}
            className={SELECT_CLASS}
            onChange={(event) => setCaptionPosition(event.target.value as CaptionPosition)}
          >
            <option value="bottom">{english ? "Bottom" : "底部"}</option>
            <option value="center">{english ? "Center" : "居中"}</option>
            <option value="top">{english ? "Top" : "顶部"}</option>
          </select>
        </label>
      </div>

      <label className="block text-meta font-medium text-muted-foreground">
        <span className="flex items-center gap-2">
          <Music2 className="size-4" aria-hidden />
          {english ? "Background music" : "背景音乐"}
        </span>
        <select
          value={bgmTrackId}
          disabled={submitting}
          className={SELECT_CLASS}
          onChange={(event) => setBgmTrackId(event.target.value as BgmTrackId)}
        >
          <option value="none">{english ? "No music" : "不添加音乐"}</option>
          <option value="wholesome">Wholesome — Kevin MacLeod</option>
        </select>
      </label>
      <label className="block text-meta font-medium text-muted-foreground">
        <span className="flex justify-between">
          <span>{english ? "Music volume" : "音乐音量"}</span>
          <span className="font-mono tabular-nums">{Math.round(bgmVolume * 100)}%</span>
        </span>
        <input
          type="range"
          min="0"
          max="0.35"
          step="0.01"
          value={bgmVolume}
          disabled={submitting || bgmTrackId === "none"}
          className="mt-2 w-full accent-primary disabled:opacity-50"
          onChange={(event) => setBgmVolume(Number(event.target.value))}
        />
      </label>

      {/* 片尾落款：最后两秒在画面上压品牌名 + 行动指引；每条片子单独勾，默认不带 */}
      <div className="flex min-w-0 flex-col gap-3 border-t border-border pt-3" data-testid="restitch-signoff">
        <label className="flex cursor-pointer items-center justify-between gap-4 text-body text-foreground">
          <span className="flex items-center gap-2">
            <Stamp className="size-4 text-muted-foreground" aria-hidden />
            {signoffCopy.title}
          </span>
          <input
            type="checkbox"
            checked={signoffEnabled}
            disabled={submitting}
            className="size-4 accent-primary"
            onChange={(event) => setSignoffEnabled(event.target.checked)}
          />
        </label>
        <p className="text-meta text-muted-foreground">{signoffCopy.hint}</p>
        {signoffEnabled ? (
          <>
            <label className="block text-meta font-medium text-muted-foreground">
              {signoffCopy.brandLabel}
              <input
                type="text"
                value={signoffBrand}
                maxLength={SIGNOFF_BRAND_MAX}
                disabled={submitting}
                placeholder={signoffCopy.brandPlaceholder}
                aria-invalid={signoffInvalid}
                className={SELECT_CLASS}
                onChange={(event) => setSignoffBrand(event.target.value)}
              />
            </label>
            <label className="block text-meta font-medium text-muted-foreground">
              {signoffCopy.ctaLabel}
              <input
                type="text"
                value={signoffCta}
                maxLength={SIGNOFF_CTA_MAX}
                disabled={submitting}
                placeholder={signoffCopy.ctaPlaceholder}
                className={SELECT_CLASS}
                onChange={(event) => setSignoffCta(event.target.value)}
              />
            </label>
            {logoAvailable ? (
              <label className="flex cursor-pointer items-start justify-between gap-4 text-meta text-muted-foreground" data-testid="restitch-signoff-logo">
                <span className="flex min-w-0 items-center gap-3">
                  {/* 预览用的就是合成时会取的那张：商家自己默认品牌包的 Logo */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={signoffSuggestion?.logoUrl ?? ""} alt="" className="h-8 w-auto max-w-24 shrink-0 rounded-(--radius-sm) bg-(--brand-tile) object-contain p-1" />
                  <span className="min-w-0">
                    <span className="block text-body text-foreground">
                      {signoffCopy.logoToggle.replace("{name}", signoffSuggestion?.packageName ?? "")}
                    </span>
                    <span className="block">{signoffCopy.logoHint}</span>
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={signoffLogo}
                  disabled={submitting}
                  className="mt-1 size-4 shrink-0 accent-primary"
                  onChange={(event) => setSignoffLogo(event.target.checked)}
                />
              </label>
            ) : null}
            {signoffInvalid ? <p role="alert" className="text-meta text-danger">{signoffCopy.brandRequired}</p> : null}
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="outline" size="sm" disabled={unchanged || submitting || pending || signoffInvalid}>
          {submitting ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
          {submitting ? copy.submitting : copy.submit}
        </Button>
        {feedback ? (
          <span
            role="status"
            className={feedback.tone === "fault" ? "text-meta text-danger" : "text-meta text-muted-foreground"}
          >
            {feedback.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
