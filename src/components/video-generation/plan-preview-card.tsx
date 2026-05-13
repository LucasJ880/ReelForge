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

/**
 * Plan preview card —— 给 B 端 / C 端用户看「我们准备拿什么交付」。
 * 文案约束（Phase 2.5 / Phase 3 demo 安全）：
 *   - 不出现 director / segment / prompt / provider / seedance 等内部术语
 *   - 用 "scene" / "plan" / "format" / "length" 这些用户能直接理解的词
 *   - 不展示原始 prompt 字符串（可能包含英文导演术语）
 */
export function PlanPreviewCard({ plan }: PlanPreviewCardProps) {
  const { planPreview, qualityReview } = plan;
  return (
    <div className="rounded-xl border border-white/10 bg-card p-6 space-y-5">
      <header>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          <span className="text-xs uppercase tracking-wider">
            Generation plan
          </span>
        </div>
        <p className="mt-3 text-base font-medium text-foreground">
          {planPreview.summary}
        </p>
      </header>

      <PlanBreakdown preview={planPreview} />

      <QualityBlock review={qualityReview} />

      <SceneList plan={plan} />

      <NextStepHint canDispatch={qualityReview.canDispatch} />
    </div>
  );
}

function PlanBreakdown({ preview }: { preview: PlanPreview }) {
  const items: Array<{ label: string; value: string }> = [
    { label: "AI scenes", value: String(preview.breakdown.aiClipCount) },
    { label: "Your clips", value: String(preview.breakdown.uploadedClipCount) },
    {
      label: "End card",
      value: preview.breakdown.hasBrandEndCard ? "Included" : "None",
    },
    { label: "Length", value: `${preview.breakdown.finalDurationSec}s` },
    { label: "Format", value: orientationLabel(preview.breakdown.aspectRatio) },
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

function orientationLabel(ratio: string): string {
  if (ratio === "9:16") return "9:16 vertical";
  if (ratio === "16:9") return "16:9 horizontal";
  if (ratio === "1:1") return "1:1 square";
  return ratio;
}

function QualityBlock({ review }: { review: QualityReview }) {
  if (
    review.canDispatch &&
    review.warnings.length === 0 &&
    review.suggestions.length === 0
  ) {
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
            <strong>Please fix before generating:</strong>
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
            <strong>Heads up</strong>
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
          Score {review.score}/100. You can still continue &mdash; the notes above are
          friendly suggestions, not blockers.
        </p>
      )}
    </div>
  );
}

function SceneList({ plan }: { plan: VideoGenerationPlan }) {
  return (
    <details className="rounded-md border border-white/10 bg-background/50">
      <summary className="cursor-pointer px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
        Scene breakdown ({plan.segments.length})
      </summary>
      <ul className="px-3 py-3 space-y-3 text-xs">
        {plan.segments.map((s, idx) => (
          <li key={s.id} className="border-l-2 border-white/10 pl-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Scene {idx + 1} &middot; {humanSceneType(s.type)}
              </span>
              <span className="text-[10px] text-muted-foreground/70">
                {s.durationSeconds}s
              </span>
            </div>
            <p className="mt-1 text-foreground/80">{s.purpose}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

function humanSceneType(type: string): string {
  switch (type) {
    case "ai_generated_clip":
      return "AI scene";
    case "uploaded_clip":
      return "Your clip";
    case "brand_end_card":
      return "End card";
    case "cta_card":
      return "End card";
    default:
      return "Scene";
  }
}

function NextStepHint({ canDispatch }: { canDispatch: boolean }) {
  if (canDispatch) {
    return (
      <p className="text-xs text-muted-foreground">
        Looks good. Hit <strong>Generate video</strong> when you&apos;re ready &mdash;
        we&apos;ll keep you posted on progress in your video list.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      Update the prompt or attachments above, then re-run preview to continue.
    </p>
  );
}
