"use client";

import { AlertTriangle, CheckCircle2, Info, Sparkles } from "lucide-react";
import type {
  PlanPreview,
  QualityReview,
  VideoGenerationPlan,
} from "@/types/video-generation";

interface PlanPreviewCardProps {
  plan: VideoGenerationPlan;
}

export function PlanPreviewCard({ plan }: PlanPreviewCardProps) {
  const { planPreview, qualityReview } = plan;
  return (
    <div className="rounded-xl border border-white/10 bg-card p-6 space-y-5">
      <header>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          <span className="text-xs uppercase tracking-wider">Plan preview</span>
        </div>
        <p className="mt-3 text-base font-medium text-foreground">
          {planPreview.summary}
        </p>
      </header>

      <PlanBreakdown preview={planPreview} />

      <QualityBlock review={qualityReview} />

      <Segments plan={plan} />
    </div>
  );
}

function PlanBreakdown({ preview }: { preview: PlanPreview }) {
  const items: Array<{ label: string; value: string }> = [
    { label: "AI clips", value: String(preview.breakdown.aiClipCount) },
    { label: "Uploaded clips", value: String(preview.breakdown.uploadedClipCount) },
    { label: "End card", value: preview.breakdown.hasBrandEndCard ? "Yes" : "No" },
    { label: "Duration", value: `${preview.breakdown.finalDurationSec}s` },
    { label: "Aspect", value: preview.breakdown.aspectRatio },
  ];
  return (
    <ul className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
      {items.map((it) => (
        <li
          key={it.label}
          className="rounded-md border border-white/10 bg-background px-3 py-2"
        >
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {it.label}
          </div>
          <div className="mt-1 text-sm font-medium">{it.value}</div>
        </li>
      ))}
    </ul>
  );
}

function QualityBlock({ review }: { review: QualityReview }) {
  if (review.canDispatch && review.warnings.length === 0 && review.suggestions.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm">
        <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5" />
        <span className="text-emerald-200">
          Ready to generate. Quality score {review.score}/100.
        </span>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {review.blockers.length > 0 && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
          <div className="flex items-center gap-2 text-sm text-red-300">
            <AlertTriangle className="h-4 w-4" />
            <strong>Blockers — please fix before generating:</strong>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-red-200/90">
            {review.blockers.map((b, i) => (
              <li key={i}>· {b.message}</li>
            ))}
          </ul>
        </div>
      )}
      {review.warnings.length > 0 && (
        <div className="rounded-md border border-amber-400/20 bg-amber-400/5 p-3">
          <div className="flex items-center gap-2 text-sm text-amber-200">
            <Info className="h-4 w-4" />
            <strong>Warnings</strong>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-amber-100/80">
            {review.warnings.map((w, i) => (
              <li key={i}>· {w.message}</li>
            ))}
          </ul>
        </div>
      )}
      {review.suggestions.length > 0 && (
        <div className="rounded-md border border-white/10 bg-card/60 p-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4" />
            <strong>Suggestions</strong>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {review.suggestions.map((s, i) => (
              <li key={i}>· {s.message}</li>
            ))}
          </ul>
        </div>
      )}
      {review.canDispatch && review.warnings.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Score {review.score}/100. You can still proceed — warnings won't block generation.
        </p>
      )}
    </div>
  );
}

function Segments({ plan }: { plan: VideoGenerationPlan }) {
  return (
    <details className="rounded-md border border-white/10 bg-background/50">
      <summary className="cursor-pointer px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
        Segment breakdown ({plan.segments.length})
      </summary>
      <ul className="px-3 py-3 space-y-3 text-xs">
        {plan.segments.map((s) => (
          <li key={s.id} className="border-l-2 border-white/10 pl-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Segment {s.order} · {s.type}
              </span>
              <span className="text-[10px] text-muted-foreground/70">
                {s.durationSeconds}s · {s.role}
              </span>
            </div>
            <p className="mt-1 text-foreground/80">{s.purpose}</p>
            {s.prompt && (
              <p className="mt-1 text-muted-foreground italic">
                {s.prompt.slice(0, 240)}
                {s.prompt.length > 240 ? "…" : ""}
              </p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
