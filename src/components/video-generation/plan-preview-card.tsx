"use client";

import { AlertTriangle, CheckCircle2, Info, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
    <Card>
      <CardContent className="space-y-5">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Sparkles className="size-4" strokeWidth={1.5} aria-hidden />
          <span className="text-meta font-medium">
            Generation plan
          </span>
        </div>
        <p className="text-body font-medium text-foreground">
          {planPreview.summary}
        </p>
      </header>

      <PlanBreakdown preview={planPreview} />

      <QualityBlock review={qualityReview} />

      <SceneList plan={plan} />

      <NextStepHint canDispatch={qualityReview.canDispatch} />
      </CardContent>
    </Card>
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
    <ul className="grid grid-cols-2 gap-3 text-meta sm:grid-cols-5">
      {items.map((it) => (
        <li
          key={it.label}
          className="rounded-(--radius-md) border border-border bg-muted px-3 py-2"
        >
          <div className="text-meta text-muted-foreground">
            {it.label}
          </div>
          <div className="mt-1 text-body font-medium">{it.value}</div>
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
      <div className="flex items-start gap-2 rounded-(--radius-md) border border-border bg-muted p-3 text-body">
        <CheckCircle2 className="mt-0.5 size-4 text-success" strokeWidth={1.5} aria-hidden />
        <span className="text-foreground">
          Ready to generate. Quality score {review.score}/100.
        </span>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {review.blockers.length > 0 && (
        <div className="rounded-(--radius-md) border border-danger bg-card p-3">
          <div className="flex items-center gap-2 text-body text-danger">
            <AlertTriangle className="size-4" strokeWidth={1.5} aria-hidden />
            <strong>Please fix before generating:</strong>
          </div>
          <ul className="mt-2 space-y-1 text-meta text-danger">
            {review.blockers.map((b, i) => (
              <li key={i}>· {b.message}</li>
            ))}
          </ul>
        </div>
      )}
      {review.warnings.length > 0 && (
        <div className="rounded-(--radius-md) border border-warning bg-card p-3">
          <div className="flex items-center gap-2 text-body text-warning">
            <Info className="size-4" strokeWidth={1.5} aria-hidden />
            <strong>Heads up</strong>
          </div>
          <ul className="mt-2 space-y-1 text-meta text-warning">
            {review.warnings.map((w, i) => (
              <li key={i}>· {w.message}</li>
            ))}
          </ul>
        </div>
      )}
      {review.suggestions.length > 0 && (
        <div className="rounded-(--radius-md) border border-border bg-muted p-3">
          <div className="flex items-center gap-2 text-body text-muted-foreground">
            <Info className="size-4" strokeWidth={1.5} aria-hidden />
            <strong>Suggestions</strong>
          </div>
          <ul className="mt-2 space-y-1 text-meta text-muted-foreground">
            {review.suggestions.map((s, i) => (
              <li key={i}>· {s.message}</li>
            ))}
          </ul>
        </div>
      )}
      {review.canDispatch && review.warnings.length > 0 && (
        <p className="text-meta text-muted-foreground">
          Score {review.score}/100. You can still continue &mdash; the notes above are
          friendly suggestions, not blockers.
        </p>
      )}
    </div>
  );
}

function SceneList({ plan }: { plan: VideoGenerationPlan }) {
  return (
    <details className="rounded-(--radius-md) border border-border bg-card">
      <summary className="cursor-pointer px-3 py-2 text-meta font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        Scene breakdown ({plan.segments.length})
      </summary>
      <ul className="space-y-3 px-3 py-3 text-meta">
        {plan.segments.map((s, idx) => (
          <li key={s.id} className="border-l-2 border-border pl-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                Scene {idx + 1} &middot; {humanSceneType(s.type)}
              </Badge>
              <span className="text-meta text-muted-foreground">
                {s.durationSeconds}s
              </span>
            </div>
            <p className="mt-1 text-foreground">{s.purpose}</p>
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
      <p className="text-meta text-muted-foreground">
        Looks good. Hit <strong>Generate video</strong> when you&apos;re ready &mdash;
        we&apos;ll keep you posted on progress in your video list.
      </p>
    );
  }
  return (
    <p className="text-meta text-muted-foreground">
      Update the prompt or attachments above, then re-run preview to continue.
    </p>
  );
}
