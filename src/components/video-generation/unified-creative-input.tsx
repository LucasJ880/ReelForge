"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { AttachmentUploader } from "@/components/video-generation/attachment-uploader";
import { PlanPreviewCard } from "@/components/video-generation/plan-preview-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OrderCreativeDraft } from "@/lib/services/order-creative-draft";
import type {
  AspectRatio,
  BrandEndingMode,
  UnifiedVideoGenerationRequest,
  UploadedAsset,
  VideoGenerationPlan,
} from "@/types/video-generation";

const DURATIONS = [15, 30, 60] as const;
const ASPECT_RATIOS: AspectRatio[] = ["9:16", "16:9", "1:1"];
const BRAND_ENDING_MODES: BrandEndingMode[] = ["auto_end_card", "uploaded_clip", "none"];
const LABEL_CLASS = "text-meta font-medium text-muted-foreground";
const SELECT_CLASS =
  "mt-1 block h-10 w-full rounded-(--radius-md) border border-input bg-card px-3 text-body text-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

interface UnifiedCreativeInputProps {
  userType: "business" | "personal" | "platform";
  initialDraft?: OrderCreativeDraft;
  initialAssets?: UploadedAsset[];
  initialStyleTemplateId?: string;
}

const QUALITY_TEMPLATE_IDS = [
  "tpl_event_watch_party",
  "tpl_viral_result_first",
  "tpl_viral_pain_solution",
  "tpl_ugc_review",
  "tpl_viral_sensory_texture",
] as const;

/**
 * 把任意错误转成客户可读的中文提示。
 * 服务端会返回内部话术（"Dispatch 失败"、"Plan 重建失败"），
 * 这些不该直接给 B/C 端用户看，统一兜底为简洁可执行的提示。
 *
 * Phase 3：根据 userType 微调口吻 —— 个人用户用更轻、更口语化的文案。
 */
function toCustomerSafeError(
  err: unknown,
  scope: "preview" | "dispatch",
  userType: "business" | "personal" | "platform",
  t: (key: string) => string,
): string {
  const fallback =
    userType === "personal"
      ? scope === "preview"
        ? t("shell.creative.errPreviewPersonal")
        : t("shell.creative.errDispatchPersonal")
      : scope === "preview"
        ? t("shell.creative.errPreviewBusiness")
        : t("shell.creative.errDispatchBusiness");
  if (!err) return fallback;
  const msg = err instanceof Error ? err.message : String(err);
  /// 已经是中文且不含明显内部术语的短消息可以直接显示。
  const looksInternal =
    /(plan|dispatch|stitch|seedance|provider|ffmpeg|json|adapter|blob|mock|executor|pipeline|debug|concat)/i.test(
      msg,
    );
  if (looksInternal || msg.length > 80) return fallback;
  return msg;
}

function planBlockerMessage(
  plan: VideoGenerationPlan,
  userType: "business" | "personal" | "platform",
  t: (key: string) => string,
): string {
  const first = plan.qualityReview.blockers[0]?.message;
  if (first && !/(plan|seedance|provider|ffmpeg)/i.test(first)) return first;
  return userType === "personal"
    ? t("shell.creative.planBlockerPersonal")
    : t("shell.creative.planBlockerBusiness");
}

export function UnifiedCreativeInput({
  userType,
  initialDraft,
  initialAssets = [],
  initialStyleTemplateId,
}: UnifiedCreativeInputProps) {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const platformCopy = getPlatformCopy(locale).create;
  const isPersonal = userType === "personal";
  const [rawPrompt, setRawPrompt] = useState(initialDraft?.rawPrompt ?? "");
  const [attachments, setAttachments] = useState<UploadedAsset[]>(initialAssets);
  const [selectedDuration, setSelectedDuration] = useState<15 | 30 | 60>(
    initialDraft?.selectedDuration ?? (isPersonal ? 15 : 30),
  );
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatio>(
    initialDraft?.selectedAspectRatio ?? "9:16",
  );
  const [selectedBrandEndingMode, setSelectedBrandEndingMode] =
    useState<BrandEndingMode>(
      initialDraft?.selectedBrandEndingMode ??
        (userType !== "personal" ? "auto_end_card" : "none"),
    );
  const [cta, setCta] = useState(initialDraft?.cta ?? "");
  const [brandName, setBrandName] = useState(initialDraft?.brandName ?? "");
  const [website, setWebsite] = useState(initialDraft?.website ?? "");
  const [styleTemplateId, setStyleTemplateId] = useState<string>(
    initialStyleTemplateId && (QUALITY_TEMPLATE_IDS as readonly string[]).includes(initialStyleTemplateId)
      ? initialStyleTemplateId
      : "auto",
  );

  const [plan, setPlan] = useState<VideoGenerationPlan | null>(null);
  const [planRequestKey, setPlanRequestKey] = useState<string | null>(null);
  const [showPlanDetails, setShowPlanDetails] = useState(!isPersonal);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildRequest(): UnifiedVideoGenerationRequest {
    return {
      userType,
      rawPrompt,
      attachments,
      selectedDuration,
      selectedAspectRatio,
      selectedBrandEndingMode: userType !== "personal" ? selectedBrandEndingMode : "none",
      cta: userType !== "personal" ? cta || null : null,
      platform: null,
      brandKit:
        userType !== "personal"
          ? {
              brandName: brandName || null,
              website: website || null,
            }
          : null,
      language: locale,
      styleTemplateId: styleTemplateId === "auto" ? null : styleTemplateId,
    };
  }

  function requestFingerprint(): string {
    return JSON.stringify(buildRequest());
  }

  async function fetchPlan(): Promise<VideoGenerationPlan> {
    const res = await fetch("/api/video-generation/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildRequest()),
    });
    const j = (await res.json()) as
      | { ok: true; plan: VideoGenerationPlan }
      | { ok: false; error: string; issues?: unknown };
    if (!res.ok || !j.ok) {
      const friendly =
        userType === "personal"
          ? t("shell.creative.errPreviewPersonal")
          : t("shell.creative.errPreviewBusiness");
      throw new Error(
        !j.ok && j.error && j.error.length < 80 ? j.error : friendly,
      );
    }
    return j.plan;
  }

  async function handlePreview() {
    setError(null);
    setPreviewing(true);
    try {
      const next = await fetchPlan();
      setPlan(next);
      setPlanRequestKey(requestFingerprint());
      setShowPlanDetails(true);
    } catch (e) {
      setError(toCustomerSafeError(e, "preview", userType, t));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleGenerate(existingPlan?: VideoGenerationPlan | null) {
    setError(null);
    setGenerating(true);
    try {
      const key = requestFingerprint();
      let activePlan = existingPlan ?? plan;
      if (!activePlan || planRequestKey !== key) {
        activePlan = await fetchPlan();
        setPlan(activePlan);
        setPlanRequestKey(key);
      }
      if (!activePlan.qualityReview.canDispatch) {
        setError(planBlockerMessage(activePlan, userType, t));
        setGenerating(false);
        setShowPlanDetails(true);
        return;
      }

      const res = await fetch("/api/video-generation/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: buildRequest() }),
      });
      const j = (await res.json()) as
        | {
            ok: true;
            deliveryOrderId: string;
            briefId: string;
            nextUrl?: string;
            userStatus?: { status: string; label: string };
          }
        | { ok: false; error: string; blockers?: string[] };
      if (!res.ok || !j.ok) {
        if (!j.ok && j.blockers?.length) {
          throw new Error(j.blockers[0]);
        }
        const friendly =
          userType === "personal"
            ? t("shell.creative.errDispatchPersonal")
            : t("shell.creative.errDispatchBusiness");
        throw new Error(
          !j.ok && j.error && j.error.length < 80 ? j.error : friendly,
        );
      }
      const target =
        j.nextUrl ??
        (userType === "platform"
          ? "/app/library"
          : userType === "business"
            ? "/business/products"
            : "/personal/videos");
      router.push(target);
      router.refresh();
    } catch (e) {
      setError(toCustomerSafeError(e, "dispatch", userType, t));
      setGenerating(false);
    }
  }

  async function handleQuickGenerate() {
    await handleGenerate(null);
  }

  const canPreview =
    rawPrompt.trim().length > 0 && !previewing && !generating;
  const canGenerate =
    plan != null &&
    planRequestKey === requestFingerprint() &&
    plan.qualityReview.canDispatch &&
    !generating;
  const canQuickGenerate =
    isPersonal && rawPrompt.trim().length > 0 && !previewing && !generating;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-5">
        <div>
          <label className={LABEL_CLASS}>
            {t("shell.creative.promptLabel")}
            <Textarea
              value={rawPrompt}
              onChange={(e) => {
                setRawPrompt(e.target.value);
                if (planRequestKey !== null) {
                  setPlan(null);
                  setPlanRequestKey(null);
                }
              }}
              placeholder={
                userType !== "personal"
                  ? t("shell.creative.promptPlaceholderBusiness")
                  : t("shell.creative.promptPlaceholderPersonal")
              }
              rows={4}
              className="mt-2"
            />
          </label>
        </div>

        {userType === "platform" ? (
          <label className={LABEL_CLASS}>
            {platformCopy.templateLabel}
            <select
              data-testid="quality-template-select"
              value={styleTemplateId}
              onChange={(event) => {
                setStyleTemplateId(event.target.value);
                setPlan(null);
                setPlanRequestKey(null);
              }}
              className={SELECT_CLASS}
            >
              <option value="auto">{platformCopy.templateAuto}</option>
              <option value="tpl_event_watch_party">{platformCopy.templateEvent}</option>
              <option value="tpl_viral_result_first">{platformCopy.templateResult}</option>
              <option value="tpl_viral_pain_solution">{platformCopy.templatePain}</option>
              <option value="tpl_ugc_review">{platformCopy.templateUgc}</option>
              <option value="tpl_viral_sensory_texture">{platformCopy.templateSensory}</option>
            </select>
            <span className="mt-1 block text-meta font-normal text-muted-foreground">{platformCopy.templateAutoHint}</span>
          </label>
        ) : null}

        <div>
          <p className={LABEL_CLASS}>
            {t("shell.creative.attachmentsLabel")}
          </p>
          <div className="mt-2">
            <AttachmentUploader
              userType={userType}
              attachments={attachments}
              onChange={setAttachments}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={LABEL_CLASS}>
              {t("shell.creative.durationLabel")}
              <select
                value={selectedDuration}
                onChange={(e) =>
                  setSelectedDuration(Number(e.target.value) as 15 | 30 | 60)
                }
                className={SELECT_CLASS}
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}s
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <label className={LABEL_CLASS}>
              {t("shell.creative.aspectLabel")}
              <select
                value={selectedAspectRatio}
                onChange={(e) =>
                  setSelectedAspectRatio(e.target.value as AspectRatio)
                }
                className={SELECT_CLASS}
              >
                {ASPECT_RATIOS.map((r) => (
                  <option key={r} value={r}>
                    {r === "9:16"
                      ? t("shell.creative.aspect916")
                      : r === "16:9"
                        ? t("shell.creative.aspect169")
                        : t("shell.creative.aspect11")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {userType !== "personal" && (
            <div>
              <label className={LABEL_CLASS}>
                {t("shell.creative.endingLabel")}
                <select
                  value={selectedBrandEndingMode}
                  onChange={(e) =>
                    setSelectedBrandEndingMode(e.target.value as BrandEndingMode)
                  }
                  className={SELECT_CLASS}
                >
                  {BRAND_ENDING_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m === "auto_end_card"
                        ? t("shell.creative.endingAuto")
                        : m === "uploaded_clip"
                          ? t("shell.creative.endingUploaded")
                          : t("shell.creative.endingNone")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        {userType !== "personal" && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={LABEL_CLASS}>
                {t("shell.creative.ctaLabel")}
                <Input
                  type="text"
                  value={cta}
                  onChange={(e) => setCta(e.target.value)}
                  placeholder={t("shell.creative.ctaPlaceholder")}
                  className="mt-1"
                />
              </label>
            </div>
            <div>
              <label className={LABEL_CLASS}>
                {t("shell.creative.brandNameLabel")}
                <Input
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder={t("shell.creative.brandNamePlaceholder")}
                  className="mt-1"
                />
              </label>
            </div>
            <div>
              <label className={LABEL_CLASS}>
                {t("shell.creative.websiteLabel")}
                <Input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder={t("shell.creative.websitePlaceholder")}
                  className="mt-1"
                />
              </label>
            </div>
          </div>
        )}

        {error && <p role="alert" className="text-meta text-danger">{error}</p>}

        {isPersonal ? (
          <div className="space-y-3">
            <Button
              type="button"
              disabled={!canQuickGenerate}
              onClick={() => void handleQuickGenerate()}
              className="w-full sm:w-auto"
            >
              {generating || previewing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {generating
                ? t("shell.creative.generating")
                : t("shell.creative.quickGenerate")}
            </Button>
            <p className="text-meta text-muted-foreground">
              {t("shell.creative.quickHint")}
            </p>
            <Button
              type="button"
              variant="link"
              disabled={!canPreview}
              onClick={() => setShowPlanDetails((v) => !v)}
              className="px-0"
            >
              {showPlanDetails
                ? t("shell.creative.togglePlanHide")
                : t("shell.creative.togglePlanShow")}
            </Button>
            {showPlanDetails ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canPreview || previewing}
                onClick={() => void handlePreview()}
              >
                {previewing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {t("shell.creative.refreshPlan")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={!canPreview}
              onClick={() => void handlePreview()}
            >
              {previewing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {t("shell.creative.previewPlan")}
            </Button>
            {plan && planRequestKey === requestFingerprint() ? (
              <Button
                type="button"
                disabled={!canGenerate}
                onClick={() => void handleGenerate(plan)}
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {t("shell.creative.generateVideo")}
              </Button>
            ) : null}
          </div>
        )}
        </CardContent>
      </Card>

      {plan && showPlanDetails ? <PlanPreviewCard plan={plan} /> : null}
    </div>
  );
}
