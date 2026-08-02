"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Clapperboard, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/i18n/useTranslation";

/**
 * b-roll 实拍图库线路 · 创作页入口（自包含，不接故事板状态机）。
 *
 * 口播稿 → 图库实拍成片：不消耗视频生成积分（成本≈TTS 数美分 + 免费图库）。
 * 讲流程 / 种草可用；展示产品细节请走上方主线（b-roll 做不了产品一致性）。
 */

/// 与 audio-caption-controls 的 VOICE_OPTIONS 同一套 id（openai-tts 做映射）
const VOICES = [
  { id: "warm-confident", zh: "温暖自信", en: "Warm and confident" },
  { id: "natural-friendly", zh: "自然亲切", en: "Natural and friendly" },
  { id: "energetic-creator", zh: "活力创作者", en: "Energetic creator" },
] as const;

const COPY = {
  "zh-CN": {
    title: "实拍图库线路",
    hint: "口播稿直接出片：真实图库素材 + AI 配音 + 字幕，不消耗生成积分。适合讲流程与种草；展示产品细节请用上方主线。",
    scriptLabel: "口播稿",
    scriptPlaceholder:
      "例：很多人担心自己量不准窗户尺寸。其实你根本不用量。我们免费上门量尺，十分钟搞定……（至少 20 字）",
    voiceLabel: "声音风格",
    aspectLabel: "画幅",
    bgmLabel: "背景音乐",
    captionsLabel: "字幕",
    on: "开",
    off: "关",
    submit: "生成实拍成片",
    submitting: "拆段选片配音中…",
    submittedTitle: "已进生产线",
    submittedBody: "拆段、选片与配音已完成，正在合成。可在成品库跟踪进度。",
    viewLibrary: "去成品库",
    cancel: "取消这条",
    cancelling: "取消中…",
    cancelled: "已取消。素材与口播音频已保留，可修改后重新提交。",
    dismiss: "知道了",
    unavailable: "实拍图库线路尚未配置（缺图库 key 或 TTS 权限）。",
    errorFallback: "提交失败，请稍后重试。",
  },
  "en-US": {
    title: "Stock footage route",
    hint: "Script to video with real stock footage, AI voiceover and captions — no generation credits. Great for process and lifestyle stories; use the main flow above for product-accurate shots.",
    scriptLabel: "Voiceover script",
    scriptPlaceholder:
      "e.g. Most people worry about measuring windows wrong. You don't have to. We measure for free… (at least 20 characters)",
    voiceLabel: "Voice",
    aspectLabel: "Aspect",
    bgmLabel: "Music bed",
    captionsLabel: "Captions",
    on: "On",
    off: "Off",
    submit: "Generate stock video",
    submitting: "Planning, picking, voicing…",
    submittedTitle: "In production",
    submittedBody:
      "Segments, footage and voiceover are ready; stitching now. Track it in the library.",
    viewLibrary: "Open library",
    cancel: "Cancel this one",
    cancelling: "Cancelling…",
    cancelled: "Cancelled. Inputs are kept — edit and resubmit anytime.",
    dismiss: "Got it",
    unavailable: "Stock route is not fully configured (stock keys or TTS access missing).",
    errorFallback: "Submission failed. Please retry.",
  },
} as const;

const STORAGE_KEY = "aivora-broll-last-submission";

type Submission = { briefId: string; orderId: string; title: string };

export function BrollQuickCard({ available }: { available: boolean }) {
  const router = useRouter();
  const { locale } = useTranslation();
  const copy = COPY[locale === "en-US" ? "en-US" : "zh-CN"];
  const english = locale === "en-US";

  const [script, setScript] = useState("");
  const [voiceId, setVoiceId] = useState<string>(VOICES[0].id);
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9">("9:16");
  const [bgmOn, setBgmOn] = useState(true);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [busy, setBusy] = useState<"submit" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setSubmission(JSON.parse(raw) as Submission);
    } catch {
      /// localStorage 不可用（隐私模式等）时静默降级：只影响取消入口的持久性
    }
  }, []);

  function persistSubmission(value: Submission | null) {
    setSubmission(value);
    try {
      if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /// 同上
    }
  }

  async function handleSubmit() {
    setError(null);
    setCancelled(false);
    setBusy("submit");
    try {
      const response = await fetch("/api/broll/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          script,
          aspectRatio,
          voiceId,
          bgmTrackId: bgmOn ? "wholesome" : "none",
          captionsEnabled: captionsOn,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok: true; briefId: string; orderId: string }
        | { ok: false; error?: string }
        | null;
      if (!payload?.ok) {
        setError(payload && "error" in payload && payload.error ? payload.error : copy.errorFallback);
        return;
      }
      persistSubmission({
        briefId: payload.briefId,
        orderId: payload.orderId,
        title: script.slice(0, 40),
      });
      setScript("");
      router.refresh();
    } catch {
      setError(copy.errorFallback);
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel() {
    if (!submission) return;
    setBusy("cancel");
    setError(null);
    try {
      const response = await fetch("/api/broll/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ briefId: submission.briefId }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok: boolean; error?: string }
        | null;
      /// ALREADY_FINISHED（409）也视为「不用取消了」，一并清掉提交态
      if (payload?.ok || response.status === 409) {
        persistSubmission(null);
        setCancelled(Boolean(payload?.ok));
        router.refresh();
      } else {
        setError(payload?.error ?? copy.errorFallback);
      }
    } catch {
      setError(copy.errorFallback);
    } finally {
      setBusy(null);
    }
  }

  if (!available) return null;

  return (
    <Card data-testid="broll-quick-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-semibold">
          <Clapperboard className="size-4 text-muted-foreground" aria-hidden />
          {copy.title}
        </CardTitle>
        <p className="text-meta text-muted-foreground">{copy.hint}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {submission ? (
          <div className="glass-well flex flex-wrap items-center gap-3 rounded-(--radius-md) px-4 py-3">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium">{copy.submittedTitle}</p>
              <p className="truncate text-meta text-muted-foreground">
                {submission.title}… · {copy.submittedBody}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button render={<Link href="/app/library" />} variant="outline" size="sm">
                {copy.viewLibrary}
                <ArrowRight aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy === "cancel"}
                onClick={() => void handleCancel()}
              >
                {busy === "cancel" ? (
                  <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <X aria-hidden />
                )}
                {busy === "cancel" ? copy.cancelling : copy.cancel}
              </Button>
            </div>
          </div>
        ) : null}
        {cancelled ? (
          <div className="flex items-center justify-between gap-3 rounded-(--radius-md) border border-border px-4 py-3 text-meta text-muted-foreground">
            <span>{copy.cancelled}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCancelled(false)}>
              {copy.dismiss}
            </Button>
          </div>
        ) : null}

        <label className="block">
          <span className="text-meta font-medium text-muted-foreground">{copy.scriptLabel}</span>
          <Textarea
            value={script}
            placeholder={copy.scriptPlaceholder}
            disabled={busy !== null}
            maxLength={2000}
            onChange={(event) => setScript(event.target.value)}
            className="mt-2 min-h-24"
          />
          <span className="mt-1 block text-right font-mono text-meta tabular-nums text-muted-foreground">
            {script.length} / 2000
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="text-meta font-medium text-muted-foreground">{copy.voiceLabel}</span>
            <select
              value={voiceId}
              disabled={busy !== null}
              onChange={(event) => setVoiceId(event.target.value)}
              className="studio-select mt-2"
            >
              {VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {english ? voice.en : voice.zh}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-meta font-medium text-muted-foreground">{copy.aspectLabel}</span>
            <select
              value={aspectRatio}
              disabled={busy !== null}
              onChange={(event) => setAspectRatio(event.target.value === "16:9" ? "16:9" : "9:16")}
              className="studio-select mt-2"
            >
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
            </select>
          </label>
          <label className="block">
            <span className="text-meta font-medium text-muted-foreground">{copy.bgmLabel}</span>
            <select
              value={bgmOn ? "on" : "off"}
              disabled={busy !== null}
              onChange={(event) => setBgmOn(event.target.value === "on")}
              className="studio-select mt-2"
            >
              <option value="on">{copy.on}</option>
              <option value="off">{copy.off}</option>
            </select>
          </label>
          <label className="block">
            <span className="text-meta font-medium text-muted-foreground">{copy.captionsLabel}</span>
            <select
              value={captionsOn ? "on" : "off"}
              disabled={busy !== null}
              onChange={(event) => setCaptionsOn(event.target.value === "on")}
              className="studio-select mt-2"
            >
              <option value="on">{copy.on}</option>
              <option value="off">{copy.off}</option>
            </select>
          </label>
        </div>

        {error ? <p className="text-meta text-danger">{error}</p> : null}

        <Button
          type="button"
          disabled={busy !== null || script.trim().length < 20}
          onClick={() => void handleSubmit()}
        >
          {busy === "submit" ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Clapperboard aria-hidden />
          )}
          {busy === "submit" ? copy.submitting : copy.submit}
        </Button>
      </CardContent>
    </Card>
  );
}
