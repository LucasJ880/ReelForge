"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { feedbackNextSteps, type FeedbackNextStep } from "@/lib/library/feedback-next-steps";
import {
  VIDEO_FEEDBACK_NOTE_MAX,
  VIDEO_FEEDBACK_REASONS,
  type VideoFeedbackRating,
  type VideoFeedbackReason,
  type VideoFeedbackView,
} from "@/lib/contracts/video-feedback";
import { cn } from "@/lib/utils";

export type VideoFeedbackCopy = {
  title: string;
  hint: string;
  up: string;
  down: string;
  reasonsLabel: string;
  reasons: Record<VideoFeedbackReason, string>;
  noteLabel: string;
  notePlaceholder: string;
  submit: string;
  submitting: string;
  savedUp: string;
  savedDown: string;
  failed: string;
  /** 不满意记下之后，按原因给出的下一步 */
  nextTitle: string;
  nextSteps: Record<FeedbackNextStep, string>;
};

/** 这条成片上现在能做的动作；值是去处（页内锚点或创作页地址），null = 这条做不了。 */
export type VideoFeedbackNextTargets = Record<FeedbackNextStep, string | null>;

/**
 * 成片评价（2026-11-10）：满意 / 不满意，不满意时选原因、可补一句。
 * 满意一点就记；不满意先选原因再提交（原因才是有用的那部分）。记过的评价回来还在，可以改。
 * 不满意记下之后按原因把下一步指给商家（feedbackNextSteps）：字幕问题 → 只重新合成；
 * 商品 / 动作问题 → 重做这一段；没按描述拍 → 带着素材再做一条。先便宜的、后贵的。
 */
export function VideoFeedbackPanel({
  briefId,
  initial,
  copy,
  nextTargets,
}: {
  briefId: string;
  initial: VideoFeedbackView | null;
  copy: VideoFeedbackCopy;
  nextTargets?: VideoFeedbackNextTargets;
}) {
  const [saved, setSaved] = useState<VideoFeedbackView | null>(initial);
  const [choice, setChoice] = useState<VideoFeedbackRating | null>(initial?.rating ?? null);
  const [reasons, setReasons] = useState<VideoFeedbackReason[]>(initial?.reasons ?? []);
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function save(rating: VideoFeedbackRating) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/briefs/${encodeURIComponent(briefId)}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rating === "up" ? { rating } : { rating, reasons, note: note.trim() || undefined }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok: true; feedback: VideoFeedbackView }
        | { ok: false; error?: string }
        | null;
      if (!response.ok || !payload?.ok) {
        setMessage({ tone: "error", text: copy.failed });
        return;
      }
      setSaved(payload.feedback);
      setChoice(payload.feedback.rating);
      setMessage({ tone: "ok", text: payload.feedback.rating === "up" ? copy.savedUp : copy.savedDown });
    } catch {
      setMessage({ tone: "error", text: copy.failed });
    } finally {
      setBusy(false);
    }
  }

  function toggleReason(reason: VideoFeedbackReason) {
    setReasons((current) => (current.includes(reason) ? current.filter((item) => item !== reason) : [...current, reason]));
  }

  const downDirty =
    choice === "down" &&
    (saved?.rating !== "down" ||
      (saved.note ?? "") !== note.trim() ||
      saved.reasons.length !== reasons.length ||
      saved.reasons.some((reason) => !reasons.includes(reason)));

  const nextSteps =
    nextTargets && saved?.rating === "down" && !downDirty
      ? feedbackNextSteps(saved.reasons, {
          restitch: Boolean(nextTargets.restitch),
          redo_segment: Boolean(nextTargets.redo_segment),
          make_another: Boolean(nextTargets.make_another),
        })
      : [];

  return (
    <section
      aria-label={copy.title}
      data-testid="video-feedback"
      data-rating={saved?.rating ?? "none"}
      className="flex min-w-0 flex-col gap-3 border-t border-border pt-4"
    >
      <div>
        <p className="text-body font-semibold text-foreground">{copy.title}</p>
        <p className="mt-1 text-meta text-muted-foreground">{copy.hint}</p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={copy.title}>
        <Button
          type="button"
          size="sm"
          variant={choice === "up" ? "secondary" : "outline"}
          aria-pressed={choice === "up"}
          disabled={busy}
          onClick={() => {
            setChoice("up");
            if (saved?.rating !== "up") void save("up");
          }}
          className={cn(choice === "up" && "border-success text-success")}
        >
          {busy && choice === "up" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <ThumbsUp aria-hidden />}
          {copy.up}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={choice === "down" ? "secondary" : "outline"}
          aria-pressed={choice === "down"}
          disabled={busy}
          onClick={() => {
            setChoice("down");
            setMessage(null);
          }}
          className={cn(choice === "down" && "border-danger text-danger")}
        >
          <ThumbsDown aria-hidden />
          {copy.down}
        </Button>
      </div>
      {choice === "down" ? (
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-meta text-muted-foreground">{copy.reasonsLabel}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {VIDEO_FEEDBACK_REASONS.map((reason) => {
                const selected = reasons.includes(reason);
                return (
                  <Button
                    key={reason}
                    type="button"
                    size="sm"
                    variant={selected ? "secondary" : "outline"}
                    aria-pressed={selected}
                    disabled={busy}
                    onClick={() => toggleReason(reason)}
                    className={cn(selected && "border-border-bright")}
                  >
                    {copy.reasons[reason]}
                  </Button>
                );
              })}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1.5 text-meta text-muted-foreground">
            <span>{copy.noteLabel}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={VIDEO_FEEDBACK_NOTE_MAX}
              rows={2}
              placeholder={copy.notePlaceholder}
              disabled={busy}
              className="w-full rounded-(--radius-sm) border border-border bg-secondary p-2.5 text-body text-foreground placeholder:text-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </label>
          {downDirty ? (
            <Button type="button" size="sm" className="self-start" disabled={busy || reasons.length === 0} onClick={() => void save("down")}>
              {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              {busy ? copy.submitting : copy.submit}
            </Button>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role="status" className={cn("text-pretty text-meta", message.tone === "error" ? "text-danger" : "text-muted-foreground")}>
          {message.text}
        </p>
      ) : null}
      {/* 记下不满意之后（没有待提交的改动时）：按原因给下一步，一点就到 */}
      {nextSteps.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="feedback-next-steps">
          <p className="text-meta text-muted-foreground">{copy.nextTitle}</p>
          <div className="flex flex-wrap gap-2">
            {nextSteps.map((step) => {
              const target = (nextTargets as VideoFeedbackNextTargets)[step] as string;
              const content = (
                <>
                  {copy.nextSteps[step]}
                  <ArrowRight aria-hidden />
                </>
              );
              return (
                <Button
                  key={step}
                  size="sm"
                  variant="outline"
                  data-next-step={step}
                  render={target.startsWith("#") ? <a href={target} /> : <Link href={target} />}
                >
                  {content}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
