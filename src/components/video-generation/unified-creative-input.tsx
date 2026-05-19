"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { AttachmentUploader } from "@/components/video-generation/attachment-uploader";
import { PlanPreviewCard } from "@/components/video-generation/plan-preview-card";
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

interface UnifiedCreativeInputProps {
  userType: "business" | "personal";
  initialDraft?: OrderCreativeDraft;
}

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
  userType: "business" | "personal",
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
  userType: "business" | "personal",
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
}: UnifiedCreativeInputProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const isPersonal = userType === "personal";
  const [rawPrompt, setRawPrompt] = useState(initialDraft?.rawPrompt ?? "");
  const [attachments, setAttachments] = useState<UploadedAsset[]>([]);
  const [selectedDuration, setSelectedDuration] = useState<15 | 30 | 60>(
    initialDraft?.selectedDuration ?? (isPersonal ? 15 : 30),
  );
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatio>(
    initialDraft?.selectedAspectRatio ?? "9:16",
  );
  const [selectedBrandEndingMode, setSelectedBrandEndingMode] =
    useState<BrandEndingMode>(
      initialDraft?.selectedBrandEndingMode ??
        (userType === "business" ? "auto_end_card" : "none"),
    );
  const [cta, setCta] = useState(initialDraft?.cta ?? "");
  const [brandName, setBrandName] = useState(initialDraft?.brandName ?? "");
  const [website, setWebsite] = useState(initialDraft?.website ?? "");

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
      selectedBrandEndingMode: userType === "business" ? selectedBrandEndingMode : "none",
      cta: userType === "business" ? cta || null : null,
      platform: null,
      brandKit:
        userType === "business"
          ? {
              brandName: brandName || null,
              website: website || null,
            }
          : null,
      language: null,
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
        (userType === "business" ? `/business/products` : `/personal/videos`);
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
      <div className="rounded-xl border border-white/10 bg-card p-6 space-y-5">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("shell.creative.promptLabel")}
          </label>
          <textarea
            value={rawPrompt}
            onChange={(e) => {
              setRawPrompt(e.target.value);
              if (planRequestKey !== null) {
                setPlan(null);
                setPlanRequestKey(null);
              }
            }}
            placeholder={
              userType === "business"
                ? t("shell.creative.promptPlaceholderBusiness")
                : t("shell.creative.promptPlaceholderPersonal")
            }
            rows={4}
            className="mt-2 block w-full rounded-md border border-white/10 bg-background px-3 py-2 text-sm focus:outline-none focus:border-white/30 transition-colors"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("shell.creative.attachmentsLabel")}
          </label>
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
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("shell.creative.durationLabel")}
            </label>
            <select
              value={selectedDuration}
              onChange={(e) =>
                setSelectedDuration(Number(e.target.value) as 15 | 30 | 60)
              }
              className="mt-1 block w-full rounded-md border border-white/10 bg-background px-2 py-2 text-sm"
            >
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d}s
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("shell.creative.aspectLabel")}
            </label>
            <select
              value={selectedAspectRatio}
              onChange={(e) =>
                setSelectedAspectRatio(e.target.value as AspectRatio)
              }
              className="mt-1 block w-full rounded-md border border-white/10 bg-background px-2 py-2 text-sm"
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
          </div>
          {userType === "business" && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("shell.creative.endingLabel")}
              </label>
              <select
                value={selectedBrandEndingMode}
                onChange={(e) =>
                  setSelectedBrandEndingMode(e.target.value as BrandEndingMode)
                }
                className="mt-1 block w-full rounded-md border border-white/10 bg-background px-2 py-2 text-sm"
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
            </div>
          )}
        </div>

        {userType === "business" && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("shell.creative.ctaLabel")}
              </label>
              <input
                type="text"
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder={t("shell.creative.ctaPlaceholder")}
                className="mt-1 block w-full rounded-md border border-white/10 bg-background px-2 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("shell.creative.brandNameLabel")}
              </label>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder={t("shell.creative.brandNamePlaceholder")}
                className="mt-1 block w-full rounded-md border border-white/10 bg-background px-2 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("shell.creative.websiteLabel")}
              </label>
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder={t("shell.creative.websitePlaceholder")}
                className="mt-1 block w-full rounded-md border border-white/10 bg-background px-2 py-2 text-sm"
              />
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        {isPersonal ? (
          <div className="space-y-3">
            <button
              type="button"
              disabled={!canQuickGenerate}
              onClick={() => void handleQuickGenerate()}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-md bg-foreground text-background px-5 py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-60"
            >
              {generating || previewing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {generating
                ? t("shell.creative.generating")
                : t("shell.creative.quickGenerate")}
            </button>
            <p className="text-xs text-muted-foreground">
              {t("shell.creative.quickHint")}
            </p>
            <button
              type="button"
              disabled={!canPreview}
              onClick={() => setShowPlanDetails((v) => !v)}
              className="text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              {showPlanDetails
                ? t("shell.creative.togglePlanHide")
                : t("shell.creative.togglePlanShow")}
            </button>
            {showPlanDetails ? (
              <button
                type="button"
                disabled={!canPreview || previewing}
                onClick={() => void handlePreview()}
                className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-card/60 px-3 py-1.5 text-xs hover:bg-card/90 transition-colors disabled:opacity-60"
              >
                {previewing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {t("shell.creative.refreshPlan")}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!canPreview}
              onClick={() => void handlePreview()}
              className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-card/60 px-4 py-2 text-sm hover:bg-card/90 transition-colors disabled:opacity-60"
            >
              {previewing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {t("shell.creative.previewPlan")}
            </button>
            {plan && planRequestKey === requestFingerprint() ? (
              <button
                type="button"
                disabled={!canGenerate}
                onClick={() => void handleGenerate(plan)}
                className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-60"
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {t("shell.creative.generateVideo")}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {plan && showPlanDetails ? <PlanPreviewCard plan={plan} /> : null}
    </div>
  );
}
