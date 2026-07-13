"use client";

import { AlertTriangle, CheckCircle2, Info, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type {
  PlanPreview,
  QualityReview,
  VideoGenerationPlan,
} from "@/types/video-generation";
import { useTranslation } from "@/i18n/useTranslation";
import type { Locale } from "@/i18n/config";

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
  const { locale } = useTranslation();
  const isEn = locale === "en-US";
  const { planPreview, qualityReview } = plan;
  return (
    <Card>
      <CardContent className="space-y-5">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Sparkles className="size-4" strokeWidth={1.5} aria-hidden />
          <span className="text-meta font-medium">
            {isEn ? "Generation plan" : "生成方案"}
          </span>
        </div>
        <p className="text-body font-medium text-foreground">
          {planPreview.summary}
        </p>
      </header>

      <PlanBreakdown preview={planPreview} locale={locale} />

      <QualityBlock review={qualityReview} locale={locale} />

      <SceneList plan={plan} locale={locale} />

      <NextStepHint canDispatch={qualityReview.canDispatch} locale={locale} />
      </CardContent>
    </Card>
  );
}

function PlanBreakdown({ preview, locale }: { preview: PlanPreview; locale: Locale }) {
  const isEn = locale === "en-US";
  const items: Array<{ label: string; value: string }> = [
    { label: isEn ? "AI scenes" : "AI 镜头", value: String(preview.breakdown.aiClipCount) },
    { label: isEn ? "Your clips" : "自有片段", value: String(preview.breakdown.uploadedClipCount) },
    {
      label: isEn ? "End card" : "片尾",
      value: preview.breakdown.hasBrandEndCard ? (isEn ? "Included" : "已包含") : (isEn ? "None" : "无"),
    },
    { label: isEn ? "Length" : "时长", value: `${preview.breakdown.finalDurationSec}s` },
    { label: isEn ? "Format" : "画幅", value: orientationLabel(preview.breakdown.aspectRatio, isEn) },
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

function orientationLabel(ratio: string, isEn: boolean): string {
  if (ratio === "9:16") return isEn ? "9:16 vertical" : "9:16 竖屏";
  if (ratio === "16:9") return isEn ? "16:9 horizontal" : "16:9 横屏";
  if (ratio === "1:1") return isEn ? "1:1 square" : "1:1 方形";
  return ratio;
}

function QualityBlock({ review, locale }: { review: QualityReview; locale: Locale }) {
  const isEn = locale === "en-US";
  if (
    review.canDispatch &&
    review.warnings.length === 0 &&
    review.suggestions.length === 0
  ) {
    return (
      <div className="flex items-start gap-2 rounded-(--radius-md) border border-border bg-muted p-3 text-body">
        <CheckCircle2 className="mt-0.5 size-4 text-success" strokeWidth={1.5} aria-hidden />
        <span className="text-foreground">
          {isEn ? `Ready to generate. Quality score ${review.score}/100.` : `可以生成。质量评分 ${review.score}/100。`}
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
            <strong>{isEn ? "Please fix before generating:" : "生成前需要修正："}</strong>
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
            <strong>{isEn ? "Heads up" : "请注意"}</strong>
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
            <strong>{isEn ? "Suggestions" : "优化建议"}</strong>
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
          {isEn ? `Score ${review.score}/100. You can continue; the notes above are suggestions, not blockers.` : `评分 ${review.score}/100。仍可继续；以上是建议，不会阻止生成。`}
        </p>
      )}
    </div>
  );
}

function SceneList({ plan, locale }: { plan: VideoGenerationPlan; locale: Locale }) {
  const isEn = locale === "en-US";
  return (
    <details className="rounded-(--radius-md) border border-border bg-card">
      <summary className="cursor-pointer px-3 py-2 text-meta font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {isEn ? "Scene breakdown" : "镜头拆解"} ({plan.segments.length})
      </summary>
      <ul className="space-y-3 px-3 py-3 text-meta">
        {plan.segments.map((s, idx) => (
          <li key={s.id} className="border-l-2 border-border pl-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {isEn ? "Scene" : "镜头"} {idx + 1} &middot; {humanSceneType(s.type, isEn)}
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

function humanSceneType(type: string, isEn: boolean): string {
  switch (type) {
    case "ai_generated_clip":
      return isEn ? "AI scene" : "AI 画面";
    case "uploaded_clip":
      return isEn ? "Your clip" : "自有片段";
    case "brand_end_card":
      return isEn ? "End card" : "片尾";
    case "cta_card":
      return isEn ? "End card" : "片尾";
    default:
      return isEn ? "Scene" : "镜头";
  }
}

function NextStepHint({ canDispatch, locale }: { canDispatch: boolean; locale: Locale }) {
  const isEn = locale === "en-US";
  if (canDispatch) {
    return (
      <p className="text-meta text-muted-foreground">
        {isEn ? <>Looks good. Select <strong>Generate video</strong> when ready; progress stays visible in your video list.</> : <>方案已就绪。确认后选择<strong>生成视频</strong>，成品库会持续显示进度。</>}
      </p>
    );
  }
  return (
    <p className="text-meta text-muted-foreground">
      {isEn ? "Update the prompt or attachments, then preview again." : "请更新描述或附件，然后重新预览方案。"}
    </p>
  );
}
