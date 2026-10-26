"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestPulseRefresh } from "@/lib/exchange/pulse";
import type { UnifiedLibrarySegment } from "@/lib/contracts/unified-library";

/**
 * 成品库详情 · P05-C 重做成片里的某一段。
 *
 * 提交到 render-retry 的 { redoSegment } 分支：扣 1 段；旧成片在新段拼进去之前一直 READY；
 * 提交失败 / 生成失败 / 取消都退回这 1 段。失败时给三条路：再试这次重做（失败的候选行，
 * 已退回的会重新扣）、换个说明重做、联系客服——不只给「重试」。
 * 说明的长度上限由服务端页面以 prop 传入（本文件不得引服务端模块的值）。
 */
export function SegmentRedoPanel({
  briefId,
  segments,
  redoInFlight,
  noteMax,
  contactEmail,
  copy,
}: {
  briefId: string;
  segments: UnifiedLibrarySegment[];
  redoInFlight: boolean;
  noteMax: number;
  contactEmail: string;
  copy: {
    title: string;
    hint: string;
    segmentLabel: string;
    pick: string;
    noteLabel: string;
    notePlaceholder: string;
    submit: string;
    submitting: string;
    started: string;
    back: string;
    running: string;
    adopting: string;
    failed: string;
    cancelled: string;
    retry: string;
    retrying: string;
    rewrite: string;
    contact: string;
    inFlightHint: string;
    invalidState: string;
    rateLimited: string;
    quotaExceeded: string;
    demoBlocked: string;
    submitFailed: string;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"submit" | "retry" | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "fault"; text: string } | null>(null);

  if (segments.length === 0) return null;

  async function post(body: unknown, kind: "submit" | "retry") {
    if (busy) return;
    setBusy(kind);
    setFeedback(null);
    try {
      const response = await fetch(`/api/briefs/${briefId}/render-retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { code?: string; error?: string } | null;
        setFeedback({ tone: "fault", text: errorText(payload) });
        return;
      }
      setFeedback({ tone: "ok", text: copy.started });
      setSelected(null);
      setNote("");
      requestPulseRefresh();
      startTransition(() => router.refresh());
    } catch {
      setFeedback({ tone: "fault", text: copy.submitFailed });
    } finally {
      setBusy(null);
    }
  }

  function errorText(payload: { code?: string; error?: string } | null): string {
    switch (payload?.code) {
      case "RATE_LIMITED":
        return copy.rateLimited;
      case "QUOTA_EXCEEDED":
        return copy.quotaExceeded;
      case "DEMO_BLOCKED":
        return copy.demoBlocked;
      case "INVALID_STATE":
        return payload.error || copy.invalidState;
      case "VALIDATION_FAILED":
        return payload.error || copy.submitFailed;
      default:
        return copy.submitFailed;
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected == null) return;
    const trimmed = note.trim();
    void post(
      { redoSegment: { segmentIndex: selected, ...(trimmed ? { promptOverride: trimmed } : {}) } },
      "submit",
    );
  }

  const disabled = busy !== null || pending;

  return (
    <section
      data-testid="segment-redo-panel"
      aria-label={copy.title}
      className="flex min-w-0 flex-col gap-3 border-t border-border pt-4"
    >
      <div>
        <p className="flex items-center gap-2 text-body font-semibold text-foreground">
          <RotateCcw className="size-4 text-muted-foreground" aria-hidden />
          {copy.title}
        </p>
        <p className="mt-1 text-meta text-muted-foreground">{copy.hint}</p>
        {redoInFlight ? <p className="mt-1 text-meta text-muted-foreground">{copy.inFlightHint}</p> : null}
      </div>

      <ul className="flex flex-col gap-2">
        {segments.map((segment) => (
          <li key={segment.segmentIndex} className="x-well flex flex-col gap-2 rounded-(--radius-md) px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-body text-foreground">
                {copy.segmentLabel.replace("{n}", String(segment.segmentIndex + 1))}
                {segment.durationSec ? (
                  <span className="ml-2 font-mono text-meta tabular-nums text-muted-foreground">
                    {segment.durationSec}s
                  </span>
                ) : null}
              </span>
              {segment.redo === "running" || segment.redo === "adopting" ? (
                <span className="flex items-center gap-1.5 text-meta text-muted-foreground" role="status">
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                  {segment.redo === "running" ? copy.running : copy.adopting}
                </span>
              ) : segment.canRedo && selected !== segment.segmentIndex ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    setSelected(segment.segmentIndex);
                    setFeedback(null);
                  }}
                >
                  {segment.redo === "failed" ? copy.rewrite : copy.pick}
                </Button>
              ) : null}
            </div>

            {segment.redo === "failed" ? (
              <div className="flex flex-col gap-2">
                <p className="text-meta text-danger">{segment.redoError ?? copy.failed}</p>
                {segment.redoError ? <p className="text-meta text-muted-foreground">{copy.failed}</p> : null}
                <div className="flex flex-wrap items-center gap-2">
                  {segment.redoJobId && !redoInFlight ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() => void post({ jobId: segment.redoJobId }, "retry")}
                    >
                      {busy === "retry" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                      {busy === "retry" ? copy.retrying : copy.retry}
                    </Button>
                  ) : null}
                  <a
                    className="text-meta text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    href={`mailto:${contactEmail}?subject=${encodeURIComponent(`${copy.title} ${briefId}`)}`}
                  >
                    {copy.contact}
                  </a>
                </div>
              </div>
            ) : segment.redo === "cancelled" ? (
              <p className="text-meta text-muted-foreground">{copy.cancelled}</p>
            ) : null}

            {selected === segment.segmentIndex ? (
              <form onSubmit={submit} className="flex flex-col gap-2">
                <label className="text-meta font-medium text-muted-foreground">
                  {copy.noteLabel}
                  <textarea
                    value={note}
                    maxLength={noteMax}
                    rows={3}
                    disabled={disabled}
                    placeholder={copy.notePlaceholder}
                    className="mt-2 w-full rounded-(--radius-md) x-well border-input px-3 py-2 text-body text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <span className="mt-1 block text-right font-mono tabular-nums">
                    {note.length}/{noteMax}
                  </span>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" size="sm" disabled={disabled}>
                    {busy === "submit" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                    {busy === "submit" ? copy.submitting : copy.submit}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => {
                      setSelected(null);
                      setNote("");
                    }}
                  >
                    {copy.back}
                  </Button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ul>

      {feedback ? (
        <p role="status" className={feedback.tone === "fault" ? "text-meta text-danger" : "text-meta text-muted-foreground"}>
          {feedback.text}
        </p>
      ) : null}
    </section>
  );
}
