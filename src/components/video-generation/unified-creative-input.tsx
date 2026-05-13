"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { AttachmentUploader } from "@/components/video-generation/attachment-uploader";
import { PlanPreviewCard } from "@/components/video-generation/plan-preview-card";
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
}

/**
 * 把任意错误转成客户可读的中文提示。
 * 服务端会返回内部话术（"Dispatch 失败"、"Plan 重建失败"），
 * 这些不该直接给 B/C 端用户看，统一兜底为简洁可执行的提示。
 */
function toCustomerSafeError(
  err: unknown,
  scope: "preview" | "dispatch",
): string {
  const fallback =
    scope === "preview"
      ? "暂时无法生成预览，请稍后再试。"
      : "无法开始生成视频，请稍后重试。";
  if (!err) return fallback;
  const msg = err instanceof Error ? err.message : String(err);
  /// 已经是中文且不含明显内部术语的短消息可以直接显示。
  const looksInternal = /(plan|dispatch|stitch|seedance|provider|ffmpeg|json|adapter)/i.test(
    msg,
  );
  if (looksInternal || msg.length > 80) return fallback;
  return msg;
}

export function UnifiedCreativeInput({ userType }: UnifiedCreativeInputProps) {
  const router = useRouter();
  const [rawPrompt, setRawPrompt] = useState("");
  const [attachments, setAttachments] = useState<UploadedAsset[]>([]);
  const [selectedDuration, setSelectedDuration] = useState<15 | 30 | 60>(30);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatio>("9:16");
  const [selectedBrandEndingMode, setSelectedBrandEndingMode] = useState<BrandEndingMode>(
    userType === "business" ? "auto_end_card" : "none",
  );
  const [cta, setCta] = useState("");
  const [brandName, setBrandName] = useState("");
  const [website, setWebsite] = useState("");

  const [plan, setPlan] = useState<VideoGenerationPlan | null>(null);
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

  async function handlePreview() {
    setError(null);
    setPreviewing(true);
    try {
      const res = await fetch("/api/video-generation/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildRequest()),
      });
      const j = (await res.json()) as
        | { ok: true; plan: VideoGenerationPlan }
        | { ok: false; error: string; issues?: unknown };
      if (!res.ok || !j.ok) {
        throw new Error(
          "ok" in j && j.ok === false
            ? "暂时无法生成预览，请稍后再试。"
            : "暂时无法生成预览，请稍后再试。",
        );
      }
      setPlan(j.plan);
    } catch (e) {
      setError(toCustomerSafeError(e, "preview"));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    try {
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
        | { ok: false; error: string };
      if (!res.ok || !j.ok) {
        throw new Error("无法开始生成视频，请稍后重试。");
      }
      /// 优先用服务端给的 nextUrl；fallback 到旧 hardcoded 路径，避免前端解析失败时卡住
      const target =
        j.nextUrl ??
        (userType === "business" ? `/business/products` : `/personal/videos`);
      router.push(target);
      router.refresh();
    } catch (e) {
      setError(toCustomerSafeError(e, "dispatch"));
      setGenerating(false);
    }
  }

  const canPreview = rawPrompt.trim().length > 0 && !previewing && !generating;
  const canGenerate = plan != null && plan.qualityReview.canDispatch && !generating;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-card p-6 space-y-5">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            What do you want to make?
          </label>
          <textarea
            value={rawPrompt}
            onChange={(e) => setRawPrompt(e.target.value)}
            placeholder={
              userType === "business"
                ? "e.g. A 30-second product ad showing my hydration bottle being used during a morning trail run, warm sunrise light, ends with the brand name."
                : "e.g. Cinematic 30-second clip of a cat exploring a sunny apartment, slow handheld camera, golden hour."
            }
            rows={4}
            className="mt-2 block w-full rounded-md border border-white/10 bg-background px-3 py-2 text-sm focus:outline-none focus:border-white/30 transition-colors"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Attachments (optional)
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
              Duration
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
              Aspect ratio
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
                  {r === "9:16" ? "9:16 vertical" : r === "16:9" ? "16:9 horizontal" : "1:1 square"}
                </option>
              ))}
            </select>
          </div>
          {userType === "business" && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Ending
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
                      ? "Auto end card (logo + CTA)"
                      : m === "uploaded_clip"
                        ? "Use my uploaded end clip"
                        : "No end card"}
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
                CTA
              </label>
              <input
                type="text"
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="e.g. Tap to shop"
                className="mt-1 block w-full rounded-md border border-white/10 bg-background px-2 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Brand name
              </label>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="ACME"
                className="mt-1 block w-full rounded-md border border-white/10 bg-background px-2 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Website
              </label>
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://example.com"
                className="mt-1 block w-full rounded-md border border-white/10 bg-background px-2 py-2 text-sm"
              />
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!canPreview}
            onClick={handlePreview}
            className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-card/60 px-4 py-2 text-sm hover:bg-card/90 transition-colors disabled:opacity-60"
          >
            {previewing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Preview plan
          </button>
          {plan && (
            <button
              type="button"
              disabled={!canGenerate}
              onClick={handleGenerate}
              className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-60"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Generate video
            </button>
          )}
        </div>
      </div>

      {plan && <PlanPreviewCard plan={plan} />}
    </div>
  );
}
