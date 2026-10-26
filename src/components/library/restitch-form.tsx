"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Captions, Loader2, Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CAPTION_STYLE_OPTIONS,
  captionStyleSelectValue,
} from "@/components/video-generation/audio-caption-controls";
import { requestPulseRefresh } from "@/lib/exchange/pulse";
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
}

const SELECT_CLASS =
  "mt-2 h-(--control-height) w-full rounded-(--radius-md) x-well border-input px-3 text-body text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50";

export function RestitchForm({
  briefId,
  english,
  defaults,
  branded = false,
  copy,
}: {
  briefId: string;
  english: boolean;
  defaults: RestitchDefaults;
  /** 已有品牌封装成片：提示换完要重新封装（服务端会清空旧封装） */
  branded?: boolean;
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

  const unchanged =
    captionsEnabled === defaults.captions.enabled &&
    captionStyle === defaults.captions.style &&
    captionPosition === defaults.captions.position &&
    bgmTrackId === defaults.bgm.trackId &&
    bgmVolume === defaults.bgm.volume;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unchanged || submitting) return;
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

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="outline" size="sm" disabled={unchanged || submitting || pending}>
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
