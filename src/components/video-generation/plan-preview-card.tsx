"use client";

import { AlertTriangle, CheckCircle2, ChevronRight, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type {
  PlanPreview,
  QualityReview,
  VideoGenerationPlan,
} from "@/types/video-generation";
import { useTranslation } from "@/i18n/useTranslation";
import type { Locale } from "@/i18n/config";
import { BRAND_END_CARD_ENTRY_ENABLED } from "@/lib/brand/brand-end-card-policy";

interface PlanPreviewCardProps {
  plan: VideoGenerationPlan;
}

/**
 * Plan preview card —— 给 B 端 / C 端用户看「我们准备拿什么交付」。
 * 文案约束（Phase 2.5 / Phase 3 demo 安全）：
 *   - 不出现 director / segment / prompt / provider / seedance 等内部术语
 *   - 用 "scene" / "plan" / "format" / "length" 这些用户能直接理解的词
 *   - 不展示原始 prompt 字符串（可能包含英文导演术语）
 *
 * 版式：一面接缝墙——第一格是方案摘要，中间一排读数，最后一格是质量结论与镜头拆解。
 */
export function PlanPreviewCard({ plan }: PlanPreviewCardProps) {
  const { locale } = useTranslation();
  const isEn = locale === "en-US";
  const { planPreview, qualityReview } = plan;
  return (
    <div className="x-wall grid-cols-2 sm:grid-cols-5">
      <p className="col-span-full px-5 py-4 text-body font-medium text-foreground">
        {localizedPlanSummary(planPreview, isEn)}
      </p>

      <PlanBreakdown preview={planPreview} locale={locale} />

      <div className="col-span-full space-y-4 px-5 py-4">
        <QualityBlock review={qualityReview} locale={locale} />
        <SceneList plan={plan} locale={locale} />
        <NextStepHint canDispatch={qualityReview.canDispatch} locale={locale} />
      </div>
    </div>
  );
}

function localizedPlanSummary(preview: PlanPreview, isEn: boolean): string {
  if (isEn) return preview.summary;
  const aiScenes = `${preview.breakdown.aiClipCount} 个 AI 镜头`;
  const ownClips = preview.breakdown.uploadedClipCount > 0
    ? `和 ${preview.breakdown.uploadedClipCount} 个自有片段`
    : "";
  const endCard = preview.breakdown.hasBrandEndCard
    ? "，并加入品牌片尾"
    : "";
  return `Aivora 将把 ${aiScenes}${ownClips}组合成一支 ${preview.breakdown.finalDurationSec} 秒 ${orientationLabel(preview.breakdown.aspectRatio, false)}视频${endCard}。`;
}

function PlanBreakdown({ preview, locale }: { preview: PlanPreview; locale: Locale }) {
  const isEn = locale === "en-US";
  const items: Array<{ label: string; value: string; numeric: boolean }> = [
    { label: isEn ? "AI scenes" : "AI 镜头", value: String(preview.breakdown.aiClipCount), numeric: true },
    { label: isEn ? "Your clips" : "自有片段", value: String(preview.breakdown.uploadedClipCount), numeric: true },
    /// 尾卡入口下线后不再常驻一行「片尾：无」；真带了尾卡（旧入口 / 显式请求）仍如实列出
    ...(BRAND_END_CARD_ENTRY_ENABLED || preview.breakdown.hasBrandEndCard
      ? [{
          label: isEn ? "End card" : "片尾",
          value: preview.breakdown.hasBrandEndCard ? (isEn ? "Included" : "已包含") : (isEn ? "None" : "无"),
          numeric: false,
        }]
      : []),
    { label: isEn ? "Length" : "时长", value: `${preview.breakdown.finalDurationSec}s`, numeric: true },
    { label: isEn ? "Format" : "画幅", value: orientationLabel(preview.breakdown.aspectRatio, isEn), numeric: false },
  ];
  return (
    <>
      {items.map((it, index) => (
        /* 窄屏两列时第 5 格独占一行，接缝墙不露底 */
        <dl key={it.label} className={index === items.length - 1 ? "col-span-2 px-4 py-3 sm:col-span-1" : "px-4 py-3"}>
          <dt className="x-label">{it.label}</dt>
          <dd className={it.numeric ? "mt-1.5 font-mono text-body tabular-nums text-foreground" : "mt-1.5 text-body text-foreground"}>
            {it.value}
          </dd>
        </dl>
      ))}
    </>
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
      <p className="flex items-start gap-2 text-body text-foreground">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={1.5} aria-hidden />
        <span>
          {isEn ? "Ready to generate. Quality score " : "可以生成。质量评分 "}
          <span className="font-mono tabular-nums text-success">{review.score}/100</span>
          {isEn ? "." : "。"}
        </span>
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {review.blockers.length > 0 && (
        <div className="border-l-2 border-danger pl-3">
          <p className="flex items-center gap-2 text-body font-medium text-danger">
            <AlertTriangle className="size-4" strokeWidth={1.5} aria-hidden />
            {isEn ? "Please fix before generating:" : "生成前需要修正："}
          </p>
          <ul className="mt-1.5 space-y-1 text-meta text-danger">
            {review.blockers.map((b, i) => (
              <li key={i}>· {b.message}</li>
            ))}
          </ul>
        </div>
      )}
      {review.warnings.length > 0 && (
        <div className="border-l-2 border-warning pl-3">
          <p className="flex items-center gap-2 text-body font-medium text-warning">
            <Info className="size-4" strokeWidth={1.5} aria-hidden />
            {isEn ? "Heads up" : "请注意"}
          </p>
          <ul className="mt-1.5 space-y-1 text-meta text-warning">
            {review.warnings.map((w, i) => (
              <li key={i}>· {w.message}</li>
            ))}
          </ul>
        </div>
      )}
      {review.suggestions.length > 0 && (
        <div className="border-l-2 border-border-strong pl-3">
          <p className="flex items-center gap-2 text-body font-medium text-muted-foreground">
            <Info className="size-4" strokeWidth={1.5} aria-hidden />
            {isEn ? "Suggestions" : "优化建议"}
          </p>
          <ul className="mt-1.5 space-y-1 text-meta text-muted-foreground">
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
    <details className="group border-t border-border pt-3">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-(--radius-sm) text-meta font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
        {isEn ? "Scene breakdown" : "镜头拆解"}
        <span className="font-mono text-data tabular-nums">{plan.segments.length}</span>
      </summary>
      <ul className="mt-3 space-y-3 text-meta">
        {plan.segments.map((s, idx) => (
          <li key={s.id} className="border-l-2 border-border pl-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {isEn ? "Scene" : "镜头"} {idx + 1} &middot; {humanSceneType(s.type, isEn)}
              </Badge>
              <span className="font-mono text-data tabular-nums text-muted-foreground">
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
        {isEn ? <>Looks good. Select <strong className="font-medium text-foreground">Generate video</strong> when ready; progress stays visible in your video list.</> : <>方案已就绪。确认后选择<strong className="font-medium text-foreground">生成视频</strong>，成品库会持续显示进度。</>}
      </p>
    );
  }
  return (
    <p className="text-meta text-muted-foreground">
      {isEn ? "Update the prompt or attachments, then preview again." : "请更新描述或附件，然后重新预览方案。"}
    </p>
  );
}
