"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clock3,
  Film,
  Layers3,
  Loader2,
  Monitor,
  Package,
  Route,
  Sparkles,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { CreateModeTabs } from "@/components/product-images/create-mode-tabs";
import { uploadFilesToAssets } from "@/components/personal/upload-assets";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileDropzone } from "@/components/ui/dropzone";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PlanPreviewCard } from "@/components/video-generation/plan-preview-card";
import {
  VideoRouteSelector,
  type VideoRouteOverride,
} from "@/components/video-generation/video-route-selector";
import { useTranslation } from "@/i18n/useTranslation";
import type { CustomerVideoDispatchResponse } from "@/lib/api/customer-video-dispatch";
import {
  customerDirectDispatchMessage,
  shouldResetDispatchAttempt,
} from "@/lib/api/customer-video-dispatch-recovery";
import { cn } from "@/lib/utils";
import type {
  AspectRatio,
  BrandEndingMode,
  UnifiedVideoGenerationRequest,
  UploadedAsset,
  VideoGenerationPlan,
} from "@/types/video-generation";

const MAX_PRODUCT_IMAGES = 9;
const MAX_ATTACHMENTS = 20;
const GUIDE_STORAGE_KEY = "aivora.streamlined-video-guide.v1";
const DURATIONS = [15, 30, 60] as const;
const ASPECT_RATIOS: AspectRatio[] = ["9:16", "16:9", "1:1"];
const QUALITY_TEMPLATE_IDS = [
  "tpl_event_watch_party",
  "tpl_viral_result_first",
  "tpl_viral_pain_solution",
  "tpl_ugc_review",
  "tpl_viral_sensory_texture",
] as const;

type CreationMode = "quick" | "advanced";
type ReferenceMode = "all" | "product_only";
type BusyState = "preview" | "dispatch" | null;

const ZH_COPY = {
  kicker: "单条视频创作",
  title: "选规格，写提示词，直接生成",
  subtitle: "不必先和 AI 对话。按页面从上到下完成素材、模式、规格和提示词，提交后可在成品库查看进度。",
  guideTitle: "第一次使用，顺着四步完成",
  guideBody: "有真实产品时先给参考图，再说清想拍什么；没有素材也可以直接使用纯文字生成。",
  guideSteps: ["添加产品图（可选）", "选择生成方式", "选择视频规格", "写提示词，核对后生成"],
  dismissGuide: "知道了，隐藏提示",
  stepAsset: "选择产品素材（可选）",
  stepAssetHint: "最多 9 张。真实产品建议上传正面、侧面和细节图；不上传则使用纯文字生成。",
  productDropTitle: "拖拽或点击上传产品图",
  productDropDescription: "JPG / PNG / WebP · 单次可选择多张",
  productCount: "{count} / 9 张",
  productRequired: "暂未上传产品图，将使用纯文字生成。",
  removeProduct: "移除产品图",
  optionalReferences: "参考图与成片视频（可选）",
  optionalReferencesHint: "参考图用于补充风格；上传的视频可作为真实片段用于成片。",
  referenceDropTitle: "添加参考图或成片片段",
  referenceDropDescription: "JPG / PNG / WebP / MP4 / MOV / WebM",
  removeReference: "移除参考素材",
  unsupportedFile: "请选择受支持的图片或视频文件。",
  tooManyProducts: "产品图最多 9 张，多出的文件未上传。",
  tooManyReferences: "本次创作最多使用 20 个素材，多出的文件未上传。",
  uploaded: "已添加 {count} 个素材",
  uploadFailed: "素材上传未完成，请检查文件后重试。",
  stepMode: "生成方式",
  stepModeHint: "第一次使用建议选快速生成；需要控制模板或品牌片尾时再用高级生成。",
  quick: "快速生成",
  quickHint: "系统自动完成镜头与质量检查",
  advanced: "高级生成",
  advancedHint: "开放模板与品牌片尾设置",
  stepSpecs: "视频规格",
  stepSpecsHint: "所有选项集中在一栏，提交前可再次核对。",
  route: "生成线路",
  autoRoute: "系统智能线路",
  routeHint: "自动选择当前可用线路",
  referenceMode: "参考方式",
  referenceAll: "全能参考",
  referenceProduct: "仅产品图",
  aspect: "画幅",
  duration: "时长",
  vertical: "9:16 竖屏",
  horizontal: "16:9 横屏",
  square: "1:1 方形",
  template: "创意模板",
  templateAuto: "自动匹配（推荐）",
  templateEvent: "赛事观看",
  templateResult: "成果前置",
  templatePain: "痛点解决",
  templateUgc: "UGC 测评",
  templateSensory: "光影质感",
  ending: "品牌片尾",
  endingNone: "不添加",
  endingAuto: "自动生成",
  brandName: "品牌名称",
  brandNamePlaceholder: "例如 Aivora",
  cta: "行动文案",
  ctaPlaceholder: "例如 立即了解",
  stepPrompt: "视频提示词",
  stepPromptHintQuick: "一句话写清产品、受众、场景和效果即可。系统会自动拆分镜头。",
  stepPromptHintAdvanced: "可写分秒节奏、人物动作、镜头语言和不希望出现的内容。",
  promptLabel: "描述你想生成的视频",
  promptPlaceholder: "例如：15 秒 9:16 真实 UGC 产品演示。年轻人在明亮浴室中直接展示产品如何解决具体问题；产品颜色、材质和包装全程与上传图片一致，结尾干净自然，不出现字幕、水印或虚构功能。",
  promptRequired: "请填写视频提示词。",
  promptPresets: ["真实 UGC 演示", "产品质感展示", "痛点到效果"],
  presetPrompts: [
    "真实 UGC 产品演示：人物在可信生活场景中自然使用产品，开头直接呈现问题，中段清楚展示使用动作与结果，产品外观与上传图片保持一致。",
    "产品质感展示：用简洁光线和近景镜头突出产品材质、结构与细节，画面高级克制，产品外观与上传图片保持一致。",
    "痛点到效果：前 3 秒呈现一个真实具体的问题，随后用产品完成一次清晰使用动作，结尾展示可信结果，不夸大产品功能。",
  ],
  charCount: "{count} / 4000",
  previewPlan: "核对生成方案",
  previewing: "正在准备方案…",
  reviewSpecs: "核对规格与积分",
  reviewingSpecs: "正在核对…",
  generate: "生成视频",
  generating: "正在提交…",
  stickySummary: "{count} 张产品图 · {ratio} · {duration} 秒",
  readyHint: "失败任务会按系统规则处理，不会因为重复点击产生重复提交。",
  routeCheckingHint: "正在检查所选生成线路，请稍候。",
  routeUnavailableHint: "所选线路当前不可用，请在线路菜单中更换后再提交。",
  shuyuEstimate: "同行线路预计 {points} 积分/支，提交时会再次核对余额。",
  previewFailed: "暂时无法准备生成方案，请稍后重试。",
  dispatchFailed: "暂时无法提交视频，请稍后重试。",
  qualityBlocked: "视频描述还需要更多细节。请按生成方案中的提示修改后再提交。",
  planHeading: "生成方案已准备",
} as const;

type StudioCopy = {
  [Key in keyof typeof ZH_COPY]: (typeof ZH_COPY)[Key] extends readonly string[]
    ? readonly string[]
    : string;
};

const EN_COPY: StudioCopy = {
  kicker: "SINGLE VIDEO",
  title: "Choose the specs, write a prompt, and generate",
  subtitle: "No required AI conversation. Move straight through assets, mode, format, and prompt, then follow progress in your video library.",
  guideTitle: "Follow four simple steps for your first video",
  guideBody: "Add real product references when you have them, then describe the video. You can also generate directly from text.",
  guideSteps: ["Add product images (optional)", "Choose a generation mode", "Choose video specs", "Write the prompt, review, and generate"],
  dismissGuide: "Got it, hide this guide",
  stepAsset: "Choose product assets (optional)",
  stepAssetHint: "Add up to 9 clear product images, or leave this empty for text-to-video generation.",
  productDropTitle: "Drop or choose product images",
  productDropDescription: "JPG / PNG / WebP · select multiple files at once",
  productCount: "{count} / 9 images",
  productRequired: "No product image added. This will use text-to-video generation.",
  removeProduct: "Remove product image",
  optionalReferences: "Reference images and final-footage clips (optional)",
  optionalReferencesHint: "Images guide style. Uploaded videos can be used as real footage in the final edit.",
  referenceDropTitle: "Add reference images or final-footage clips",
  referenceDropDescription: "JPG / PNG / WebP / MP4 / MOV / WebM",
  removeReference: "Remove reference asset",
  unsupportedFile: "Choose a supported image or video file.",
  tooManyProducts: "You can use up to 9 product images. Extra files were not uploaded.",
  tooManyReferences: "A creation can use up to 20 assets. Extra files were not uploaded.",
  uploaded: "Added {count} assets",
  uploadFailed: "The upload did not finish. Check the files and try again.",
  stepMode: "Generation mode",
  stepModeHint: "Quick generation is best for a first video. Use advanced mode when you need a template or branded ending.",
  quick: "Quick generation",
  quickHint: "Automatic shot planning and quality checks",
  advanced: "Advanced generation",
  advancedHint: "Template and branded-ending controls",
  stepSpecs: "Video specs",
  stepSpecsHint: "The important choices stay together in one compact bar for a final check.",
  route: "Generation route",
  autoRoute: "Smart system route",
  routeHint: "Uses the best currently available route",
  referenceMode: "Reference mode",
  referenceAll: "Use all references",
  referenceProduct: "Product only",
  aspect: "Format",
  duration: "Length",
  vertical: "9:16 vertical",
  horizontal: "16:9 horizontal",
  square: "1:1 square",
  template: "Creative template",
  templateAuto: "Auto match (recommended)",
  templateEvent: "Watch party",
  templateResult: "Result first",
  templatePain: "Pain to proof",
  templateUgc: "UGC review",
  templateSensory: "Material and light",
  ending: "Brand ending",
  endingNone: "None",
  endingAuto: "Generate automatically",
  brandName: "Brand name",
  brandNamePlaceholder: "Example: Aivora",
  cta: "Call to action",
  ctaPlaceholder: "Example: Learn more",
  stepPrompt: "Video prompt",
  stepPromptHintQuick: "One sentence covering the product, audience, setting, and outcome is enough. Shots are planned automatically.",
  stepPromptHintAdvanced: "You can specify timing, actions, camera direction, and anything that must not appear.",
  promptLabel: "Describe the video you want to generate",
  promptPlaceholder: "Example: A realistic 15-second 9:16 UGC product demo. A young adult shows how the product solves one specific problem in a bright bathroom. Keep its color, material, and packaging identical to the uploaded images. End naturally with no captions, watermark, or invented features.",
  promptRequired: "Write a video prompt.",
  promptPresets: ["Real UGC demo", "Material showcase", "Pain to result"],
  presetPrompts: [
    "A realistic UGC product demo in a believable everyday setting. Open with a specific problem, show one clear use action and outcome, and keep the product identical to the uploaded images.",
    "A restrained product showcase using clean light and close shots to reveal materials, construction, and details. Keep the product identical to the uploaded images.",
    "Show one real problem in the first three seconds, solve it with one clear product action, and end on a believable result without exaggerating any feature.",
  ],
  charCount: "{count} / 4000",
  previewPlan: "Review generation plan",
  previewing: "Preparing the plan…",
  reviewSpecs: "Review specs & points",
  reviewingSpecs: "Checking…",
  generate: "Generate video",
  generating: "Submitting…",
  stickySummary: "{count} product images · {ratio} · {duration}s",
  readyHint: "Failed jobs follow safe recovery rules, and repeated clicks cannot create duplicate submissions.",
  routeCheckingHint: "Checking the selected generation route…",
  routeUnavailableHint: "The selected route is unavailable. Choose another route before submitting.",
  shuyuEstimate: "Partner route estimate: {points} points/video. Balance is checked again at submit.",
  previewFailed: "The generation plan is temporarily unavailable. Try again shortly.",
  dispatchFailed: "The video could not be submitted right now. Try again shortly.",
  qualityBlocked: "The brief needs more detail. Update it using the generation-plan guidance, then submit again.",
  planHeading: "Generation plan ready",
};

export function StreamlinedVideoStudio({
  initialAssets = [],
  initialStyleTemplateId,
  canSelectVideoRoute,
  showInternalVideoRoutes = false,
}: {
  initialAssets?: UploadedAsset[];
  initialStyleTemplateId?: string;
  canSelectVideoRoute: boolean;
  showInternalVideoRoutes?: boolean;
}) {
  const router = useRouter();
  const { locale } = useTranslation();
  const copy = locale === "en-US" ? EN_COPY : ZH_COPY;
  const initialProductAssets = initialAssets
    .filter((asset) => asset.type === "IMAGE")
    .slice(0, MAX_PRODUCT_IMAGES)
    .map((asset) => ({ ...asset, userAssignedRole: "product_image" as const }));
  const initialReferenceAssets = initialAssets
    .filter((asset) => !initialProductAssets.some((product) => product.id === asset.id))
    .slice(0, MAX_ATTACHMENTS - initialProductAssets.length);
  const seededStyleTemplateId = isQualityTemplateId(initialStyleTemplateId)
    ? initialStyleTemplateId
    : "auto";

  const [showGuide, setShowGuide] = useState(true);
  const [productAssets, setProductAssets] = useState<UploadedAsset[]>(initialProductAssets);
  const [referenceAssets, setReferenceAssets] = useState<UploadedAsset[]>(initialReferenceAssets);
  const [uploadingTarget, setUploadingTarget] = useState<"product" | "reference" | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [creationMode, setCreationMode] = useState<CreationMode>("quick");
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>("all");
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatio>("9:16");
  const [selectedDuration, setSelectedDuration] = useState<15 | 30 | 60>(15);
  const [styleTemplateId, setStyleTemplateId] = useState(seededStyleTemplateId);
  const [selectedBrandEndingMode, setSelectedBrandEndingMode] = useState<BrandEndingMode>("none");
  const [brandName, setBrandName] = useState("");
  const [cta, setCta] = useState("");
  const [selectedVideoRouteId, setSelectedVideoRouteId] = useState<VideoRouteOverride>("");
  const [selectedRouteAvailable, setSelectedRouteAvailable] = useState<
    boolean | null
  >(true);
  const [rawPrompt, setRawPrompt] = useState("");
  const [plan, setPlan] = useState<VideoGenerationPlan | null>(null);
  const [planRequestKey, setPlanRequestKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState<string | null>(null);
  const dispatchAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    try {
      setShowGuide(localStorage.getItem(GUIDE_STORAGE_KEY) !== "dismissed");
    } catch {
      setShowGuide(true);
    }
  }, []);

  const activeAttachments = useMemo(
    () => referenceMode === "all" ? [...productAssets, ...referenceAssets] : productAssets,
    [productAssets, referenceAssets, referenceMode],
  );

  const invalidatePlan = useCallback(() => {
    setPlan(null);
    setPlanRequestKey(null);
    setError(null);
  }, []);

  const handleVideoRouteChange = useCallback(
    (routeId: VideoRouteOverride) => {
      setSelectedVideoRouteId(routeId);
      invalidatePlan();
    },
    [invalidatePlan],
  );

  const handleSelectedRouteAvailabilityChange = useCallback(
    (available: boolean | null) => {
      setSelectedRouteAvailable(available);
    },
    [],
  );

  function dismissGuide() {
    setShowGuide(false);
    try {
      localStorage.setItem(GUIDE_STORAGE_KEY, "dismissed");
    } catch {
      // The guide is still dismissible for the current visit when storage is unavailable.
    }
  }

  async function uploadProductImages(files: File[]) {
    if (busy !== null || uploadingTarget !== null) return;
    const remaining = Math.min(
      MAX_PRODUCT_IMAGES - productAssets.length,
      MAX_ATTACHMENTS - productAssets.length - referenceAssets.length,
    );
    if (remaining <= 0) return;
    const supported = files.filter((file) => isSupportedImage(file));
    const accepted = supported.slice(0, remaining);
    if (accepted.length !== files.length) {
      const message = supported.length > remaining ? copy.tooManyProducts : copy.unsupportedFile;
      setUploadError(message);
      toast.error(message);
    }
    if (accepted.length === 0) return;
    setUploadingTarget("product");
    try {
      const uploaded = await uploadFilesToAssets(accepted, { forceRole: "product_image" });
      setProductAssets((current) => [...current, ...uploaded].slice(0, MAX_PRODUCT_IMAGES));
      invalidatePlan();
      setUploadError(null);
      toast.success(copy.uploaded.replace("{count}", String(uploaded.length)));
    } catch (uploadFailure) {
      const message = safeUploadError(uploadFailure, copy.uploadFailed);
      setUploadError(message);
      toast.error(message);
    } finally {
      setUploadingTarget(null);
    }
  }

  async function uploadReferenceAssets(files: File[]) {
    if (busy !== null || uploadingTarget !== null) return;
    const reservedProductSlot = productAssets.length === 0 ? 1 : 0;
    const remaining = MAX_ATTACHMENTS
      - productAssets.length
      - referenceAssets.length
      - reservedProductSlot;
    if (remaining <= 0) return;
    const supported = files.filter((file) => isSupportedReference(file));
    const accepted = supported.slice(0, remaining);
    if (accepted.length !== files.length) {
      const message = supported.length > remaining ? copy.tooManyReferences : copy.unsupportedFile;
      setUploadError(message);
      toast.error(message);
    }
    if (accepted.length === 0) return;
    setUploadingTarget("reference");
    try {
      const images = accepted.filter((file) => isSupportedImage(file));
      const videos = accepted.filter((file) => file.type.startsWith("video/"));
      const [uploadedImages, uploadedVideos] = await Promise.all([
        images.length > 0
          ? uploadFilesToAssets(images, { forceRole: "reference_image" })
          : Promise.resolve([]),
        videos.length > 0
          ? uploadFilesToAssets(videos, { forceRole: "product_demo_clip" })
          : Promise.resolve([]),
      ]);
      const uploaded = [...uploadedImages, ...uploadedVideos];
      setReferenceAssets((current) => [...current, ...uploaded].slice(0, MAX_ATTACHMENTS - productAssets.length));
      invalidatePlan();
      setUploadError(null);
      toast.success(copy.uploaded.replace("{count}", String(uploaded.length)));
    } catch (uploadFailure) {
      const message = safeUploadError(uploadFailure, copy.uploadFailed);
      setUploadError(message);
      toast.error(message);
    } finally {
      setUploadingTarget(null);
    }
  }

  function removeProductAsset(assetId: string) {
    if (busy !== null) return;
    setProductAssets((current) => current.filter((asset) => asset.id !== assetId));
    invalidatePlan();
  }

  function removeReferenceAsset(assetId: string) {
    if (busy !== null) return;
    setReferenceAssets((current) => current.filter((asset) => asset.id !== assetId));
    invalidatePlan();
  }

  function buildRequest(): UnifiedVideoGenerationRequest {
    const advanced = creationMode === "advanced";
    const activeStyleTemplateId = advanced ? styleTemplateId : seededStyleTemplateId;
    return {
      userType: "platform",
      rawPrompt: rawPrompt.trim(),
      attachments: activeAttachments,
      selectedDuration,
      selectedAspectRatio,
      selectedBrandEndingMode: advanced ? selectedBrandEndingMode : "none",
      cta: advanced && selectedBrandEndingMode === "auto_end_card" ? cta.trim() || null : null,
      platform: null,
      brandKit: advanced && selectedBrandEndingMode === "auto_end_card"
        ? { brandName: brandName.trim() || null, website: null }
        : null,
      language: locale,
      styleTemplateId: activeStyleTemplateId === "auto" ? null : activeStyleTemplateId,
    };
  }

  function validateBeforeRequest(): string | null {
    if (!rawPrompt.trim()) return copy.promptRequired;
    return null;
  }

  async function fetchPlan(
    request: UnifiedVideoGenerationRequest,
  ): Promise<VideoGenerationPlan> {
    const response = await fetch("/api/video-generation/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const payload = await response.json().catch(() => null) as
      | { ok: true; plan: VideoGenerationPlan }
      | { ok: false; error?: string }
      | null;
    if (!response.ok || !payload?.ok) throw new Error(copy.previewFailed);
    return payload.plan;
  }

  async function handlePreview() {
    const validationError = validateBeforeRequest();
    if (validationError) {
      setError(validationError);
      return;
    }
    const request = buildRequest();
    const requestKey = JSON.stringify(request);
    setError(null);
    setBusy("preview");
    try {
      const nextPlan = await fetchPlan(request);
      setPlan(nextPlan);
      setPlanRequestKey(requestKey);
      if (!nextPlan.qualityReview.canDispatch) {
        setError(copy.qualityBlocked);
      }
      requestAnimationFrame(() => {
        document.getElementById("streamlined-plan-preview")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    } catch {
      setError(copy.previewFailed);
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerate() {
    const validationError = validateBeforeRequest();
    if (validationError) {
      setError(validationError);
      return;
    }
    const request = buildRequest();
    setError(null);
    setBusy("dispatch");
    try {
      const key = JSON.stringify(request);
      let activePlan = plan;
      if (!activePlan || planRequestKey !== key) {
        activePlan = await fetchPlan(request);
        setPlan(activePlan);
        setPlanRequestKey(key);
      }
      if (!activePlan.qualityReview.canDispatch) {
        setError(copy.qualityBlocked);
        requestAnimationFrame(() => {
          document.getElementById("streamlined-plan-preview")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        });
        return;
      }

      const dispatchBody = {
        request,
        ...(canSelectVideoRoute && selectedVideoRouteId
          ? { videoRouteId: selectedVideoRouteId }
          : {}),
      };
      const dispatchFingerprint = JSON.stringify(dispatchBody);
      if (dispatchAttemptRef.current?.fingerprint !== dispatchFingerprint) {
        dispatchAttemptRef.current = {
          fingerprint: dispatchFingerprint,
          key: crypto.randomUUID(),
        };
      }

      const response = await fetch("/api/video-generation/dispatch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": dispatchAttemptRef.current.key,
        },
        body: dispatchFingerprint,
      });
      const payload = await response.json().catch(() => null) as CustomerVideoDispatchResponse | null;
      if (!payload) throw new Error(copy.dispatchFailed);
      if (!payload.ok) {
        if (shouldResetDispatchAttempt(payload)) dispatchAttemptRef.current = null;
        setError(customerDirectDispatchMessage(payload, locale));
        return;
      }
      if (!response.ok) throw new Error(copy.dispatchFailed);

      dispatchAttemptRef.current = null;
      router.push(payload.nextUrl ?? "/app/library");
      router.refresh();
    } catch {
      setError(copy.dispatchFailed);
    } finally {
      setBusy(null);
    }
  }

  const canReview =
    rawPrompt.trim().length > 0
    && busy === null
    && uploadingTarget === null
    && selectedRouteAvailable === true;
  const currentRequestKey = rawPrompt.trim()
    ? JSON.stringify(buildRequest())
    : null;
  const planIsCurrent = Boolean(
    plan && currentRequestKey && planRequestKey === currentRequestKey,
  );
  const canGenerate = Boolean(
    canReview && planIsCurrent && plan?.qualityReview.canDispatch,
  );
  const quickNeedsReview = creationMode === "quick" && !planIsCurrent;
  const primaryIsBusy =
    busy === "dispatch"
    || (creationMode === "quick" && busy === "preview");
  const ratioLabel = aspectRatioLabel(selectedAspectRatio, copy);

  return (
    <div className="space-y-6 pb-4" data-testid="streamlined-video-studio">
      <header className="max-w-4xl space-y-3">
        <p className="studio-label text-muted-foreground">{copy.kicker}</p>
        <h1 className="editorial-display">{copy.title}</h1>
        <p className="max-w-3xl text-body text-muted-foreground">{copy.subtitle}</p>
        <CreateModeTabs active="video" />
      </header>

      {showGuide ? (
        <section
          className="studio-panel relative overflow-hidden p-4 sm:p-5"
          aria-labelledby="streamlined-first-use-heading"
          data-testid="streamlined-first-use-guide"
        >
          <div className="flex items-start gap-3 pr-10">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-primary bg-accent-soft text-foreground">
              <Sparkles className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="streamlined-first-use-heading" className="font-heading text-subhead font-semibold">{copy.guideTitle}</h2>
              <p className="mt-1 text-meta text-muted-foreground">{copy.guideBody}</p>
              <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {copy.guideSteps.map((step, index) => (
                  <li key={step} className="flex items-center gap-2 rounded-(--radius-md) border border-border bg-muted px-3 py-2 text-meta text-foreground">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-[10px] tabular-nums">{index + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute right-3 top-3"
            onClick={dismissGuide}
            aria-label={copy.dismissGuide}
            title={copy.dismissGuide}
          >
            <X aria-hidden />
          </Button>
        </section>
      ) : null}

      <Card data-testid="streamlined-product-assets">
        <StepCardHeader number={1} title={copy.stepAsset} hint={copy.stepAssetHint}>
          <span className="rounded-full border border-border bg-secondary px-2.5 py-1 font-mono text-meta tabular-nums text-muted-foreground">
            {copy.productCount.replace("{count}", String(productAssets.length))}
          </span>
        </StepCardHeader>
        <CardContent className="space-y-4">
          <FileDropzone
            title={copy.productDropTitle}
            description={copy.productDropDescription}
            uploading={uploadingTarget === "product"}
            disabled={busy !== null
              || uploadingTarget !== null
              || productAssets.length >= MAX_PRODUCT_IMAGES
              || productAssets.length + referenceAssets.length >= MAX_ATTACHMENTS}
            onFiles={(files) => void uploadProductImages(files)}
            onRejected={() => {
              setUploadError(copy.unsupportedFile);
              toast.error(copy.unsupportedFile);
            }}
            className="py-5"
          />
          {productAssets.length > 0 ? (
            <AssetGrid
              assets={productAssets}
              imageLabel={copy.stepAsset}
              removeLabel={copy.removeProduct}
              onRemove={removeProductAsset}
              disabled={busy !== null}
            />
          ) : (
            <p className="flex items-center gap-2 text-meta text-muted-foreground">
              <Package className="size-4" aria-hidden />
              {copy.productRequired}
            </p>
          )}

          <details className="group rounded-(--radius-md) border border-border bg-muted" data-testid="streamlined-reference-assets">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 text-left [&::-webkit-details-marker]:hidden">
              <Layers3 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium text-foreground">{copy.optionalReferences}</span>
                <span className="mt-0.5 block text-meta text-muted-foreground">{copy.optionalReferencesHint}</span>
              </span>
              {referenceAssets.length > 0 ? (
                <span className="rounded-full border border-border bg-card px-2 py-0.5 font-mono text-meta tabular-nums">{referenceAssets.length}</span>
              ) : null}
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
            </summary>
            <div className="space-y-3 border-t border-border p-3">
              <FileDropzone
                accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
                title={copy.referenceDropTitle}
                description={copy.referenceDropDescription}
                uploading={uploadingTarget === "reference"}
                disabled={busy !== null
                  || uploadingTarget !== null
                  || productAssets.length + referenceAssets.length >= MAX_ATTACHMENTS - (productAssets.length === 0 ? 1 : 0)}
                onFiles={(files) => void uploadReferenceAssets(files)}
                onRejected={() => {
                  setUploadError(copy.unsupportedFile);
                  toast.error(copy.unsupportedFile);
                }}
                className="bg-card py-4"
              />
              {referenceAssets.length > 0 ? (
                <AssetGrid
                  assets={referenceAssets}
                  imageLabel={copy.optionalReferences}
                  removeLabel={copy.removeReference}
                  onRemove={removeReferenceAsset}
                  disabled={busy !== null}
                />
              ) : null}
            </div>
          </details>
          {uploadError ? <p role="alert" className="text-meta text-danger">{uploadError}</p> : null}
        </CardContent>
      </Card>

      <Card data-testid="streamlined-generation-mode">
        <StepCardHeader number={2} title={copy.stepMode} hint={copy.stepModeHint} />
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label={copy.stepMode}>
            <ModeButton
              active={creationMode === "quick"}
              title={copy.quick}
              description={copy.quickHint}
              icon={Zap}
              disabled={busy !== null}
              onClick={() => {
                setCreationMode("quick");
                invalidatePlan();
              }}
            />
            <ModeButton
              active={creationMode === "advanced"}
              title={copy.advanced}
              description={copy.advancedHint}
              icon={WandSparkles}
              disabled={busy !== null}
              onClick={() => {
                setCreationMode("advanced");
                invalidatePlan();
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="streamlined-video-specs">
        <StepCardHeader number={3} title={copy.stepSpecs} hint={copy.stepSpecsHint} />
        <CardContent className="space-y-4">
          <div className="rounded-(--radius-lg) border border-border bg-muted p-3">
            <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {canSelectVideoRoute ? (
                <div className="min-w-0 rounded-(--radius-md) border border-border bg-card px-3 py-2">
                  <VideoRouteSelector
                    canSelectVideoRoute={canSelectVideoRoute}
                    showInternalRoutes={showInternalVideoRoutes}
                    durationSeconds={selectedDuration}
                    value={selectedVideoRouteId}
                    disabled={busy !== null}
                    onChange={handleVideoRouteChange}
                    onSelectedAvailabilityChange={handleSelectedRouteAvailabilityChange}
                  />
                </div>
              ) : (
                <StaticSpec icon={Route} label={copy.route} value={copy.autoRoute} hint={copy.routeHint} />
              )}
              <SpecSelect
                icon={Layers3}
                label={copy.referenceMode}
                value={referenceMode}
                disabled={busy !== null}
                onChange={(value) => {
                  setReferenceMode(value as ReferenceMode);
                  invalidatePlan();
                }}
                options={[
                  { value: "all", label: copy.referenceAll },
                  { value: "product_only", label: copy.referenceProduct },
                ]}
              />
              <SpecSelect
                icon={Monitor}
                label={copy.aspect}
                value={selectedAspectRatio}
                disabled={busy !== null}
                onChange={(value) => {
                  setSelectedAspectRatio(value as AspectRatio);
                  invalidatePlan();
                }}
                options={ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: aspectRatioLabel(ratio, copy) }))}
              />
              <SpecSelect
                icon={Clock3}
                label={copy.duration}
                value={String(selectedDuration)}
                disabled={busy !== null}
                onChange={(value) => {
                  setSelectedDuration(Number(value) as 15 | 30 | 60);
                  invalidatePlan();
                }}
                options={DURATIONS.map((duration) => ({ value: String(duration), label: `${duration}s` }))}
              />
            </div>
          </div>

          {creationMode === "advanced" ? (
            <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2" data-testid="streamlined-advanced-options">
              <label className="text-meta font-medium text-muted-foreground">
                {copy.template}
                <select
                  value={styleTemplateId}
                  disabled={busy !== null}
                  onChange={(event) => {
                    setStyleTemplateId(event.target.value);
                    invalidatePlan();
                  }}
                  className="studio-select mt-1"
                >
                  <option value="auto">{copy.templateAuto}</option>
                  <option value="tpl_event_watch_party">{copy.templateEvent}</option>
                  <option value="tpl_viral_result_first">{copy.templateResult}</option>
                  <option value="tpl_viral_pain_solution">{copy.templatePain}</option>
                  <option value="tpl_ugc_review">{copy.templateUgc}</option>
                  <option value="tpl_viral_sensory_texture">{copy.templateSensory}</option>
                </select>
              </label>
              <label className="text-meta font-medium text-muted-foreground">
                {copy.ending}
                <select
                  value={selectedBrandEndingMode}
                  disabled={busy !== null}
                  onChange={(event) => {
                    setSelectedBrandEndingMode(event.target.value as BrandEndingMode);
                    invalidatePlan();
                  }}
                  className="studio-select mt-1"
                >
                  <option value="none">{copy.endingNone}</option>
                  <option value="auto_end_card">{copy.endingAuto}</option>
                </select>
              </label>
              {selectedBrandEndingMode === "auto_end_card" ? (
                <>
                  <label className="text-meta font-medium text-muted-foreground">
                    {copy.brandName}
                    <Input
                      value={brandName}
                      maxLength={120}
                      disabled={busy !== null}
                      onChange={(event) => {
                        setBrandName(event.target.value);
                        invalidatePlan();
                      }}
                      placeholder={copy.brandNamePlaceholder}
                      className="mt-1"
                    />
                  </label>
                  <label className="text-meta font-medium text-muted-foreground">
                    {copy.cta}
                    <Input
                      value={cta}
                      maxLength={500}
                      disabled={busy !== null}
                      onChange={(event) => {
                        setCta(event.target.value);
                        invalidatePlan();
                      }}
                      placeholder={copy.ctaPlaceholder}
                      className="mt-1"
                    />
                  </label>
                </>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card data-testid="streamlined-video-prompt">
        <StepCardHeader
          number={4}
          title={copy.stepPrompt}
          hint={creationMode === "quick" ? copy.stepPromptHintQuick : copy.stepPromptHintAdvanced}
        />
        <CardContent className="space-y-3">
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label={copy.promptLabel}>
            {copy.promptPresets.map((label, index) => (
              <Button
                key={label}
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 bg-card"
                disabled={busy !== null}
                onClick={() => {
                  setRawPrompt(copy.presetPrompts[index] ?? "");
                  invalidatePlan();
                }}
              >
                <Sparkles aria-hidden />
                {label}
              </Button>
            ))}
          </div>
          <label className="block text-meta font-medium text-muted-foreground">
            {copy.promptLabel}
            <Textarea
              value={rawPrompt}
              maxLength={4000}
              rows={7}
              disabled={busy !== null}
              aria-invalid={Boolean(error && !rawPrompt.trim())}
              onChange={(event) => {
                setRawPrompt(event.target.value);
                invalidatePlan();
              }}
              placeholder={copy.promptPlaceholder}
              className="mt-2 min-h-44 resize-y bg-card text-body leading-relaxed"
            />
          </label>
          <p className="text-right font-mono text-meta tabular-nums text-muted-foreground">
            {copy.charCount.replace("{count}", String(rawPrompt.length))}
          </p>
        </CardContent>
      </Card>

      {plan ? (
        <section id="streamlined-plan-preview" className="scroll-mt-20 space-y-3" aria-labelledby="streamlined-plan-heading">
          <h2 id="streamlined-plan-heading" className="font-heading text-title font-semibold">{copy.planHeading}</h2>
          <PlanPreviewCard plan={plan} />
        </section>
      ) : null}

      <section
        className="sticky bottom-20 z-10 rounded-(--radius-lg) border border-border bg-overlay p-3 shadow-editorial md:bottom-4"
        data-testid="streamlined-generate-bar"
        aria-label={quickNeedsReview ? copy.reviewSpecs : copy.generate}
      >
        {error ? (
          <p role="alert" className="mb-3 flex items-start gap-2 rounded-(--radius-md) border border-danger bg-card px-3 py-2 text-meta text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-foreground">
              {copy.stickySummary
                .replace("{count}", String(productAssets.length))
                .replace("{ratio}", ratioLabel)
                .replace("{duration}", String(selectedDuration))}
            </p>
            <p className="mt-0.5 text-meta text-muted-foreground">
              {selectedRouteAvailable === null
                ? copy.routeCheckingHint
                : selectedRouteAvailable === false
                  ? copy.routeUnavailableHint
                  : selectedVideoRouteId === "buddy"
                    ? copy.shuyuEstimate.replace(
                        "{points}",
                        String(selectedDuration * 104),
                      )
                    : copy.readyHint}
            </p>
          </div>
          <div className="grid shrink-0 gap-2 sm:flex">
            {creationMode === "advanced" ? (
              <Button
                type="button"
                variant="outline"
                disabled={!canReview}
                onClick={() => void handlePreview()}
                className="bg-card"
              >
                {busy === "preview" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Film aria-hidden />}
                {busy === "preview" ? copy.previewing : copy.previewPlan}
              </Button>
            ) : null}
            <Button
              type="button"
              id="platform-primary-generate"
              disabled={quickNeedsReview ? !canReview : !canGenerate}
              onClick={() => {
                if (quickNeedsReview) {
                  void handlePreview();
                  return;
                }
                void handleGenerate();
              }}
              className="min-w-36"
            >
              {primaryIsBusy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Sparkles aria-hidden />}
              {busy === "dispatch"
                  ? copy.generating
                  : creationMode === "quick" && busy === "preview"
                    ? copy.reviewingSpecs
                  : quickNeedsReview
                    ? copy.reviewSpecs
                    : copy.generate}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function StepCardHeader({
  number,
  title,
  hint,
  children,
}: {
  number: number;
  title: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <CardHeader className="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-primary bg-accent-soft font-mono text-meta font-semibold tabular-nums text-foreground">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <CardTitle className="font-semibold">{title}</CardTitle>
          <p className="mt-1 text-meta text-muted-foreground">{hint}</p>
        </div>
        {children}
      </div>
    </CardHeader>
  );
}

function ModeButton({
  active,
  title,
  description,
  icon: Icon,
  disabled,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  icon: typeof Zap;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-(--radius-md) border p-3 text-left transition-[border-color,background-color] duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none",
        active ? "border-primary bg-accent-soft" : "border-border bg-muted hover:border-border-strong",
      )}
    >
      <span className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full border",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground",
      )}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold text-foreground">{title}</span>
        <span className="mt-1 block text-meta text-muted-foreground">{description}</span>
      </span>
      <span className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border",
      )}>
        {active ? <Check className="size-3" aria-hidden /> : null}
      </span>
    </button>
  );
}

function SpecSelect({
  icon: Icon,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  icon: typeof Layers3;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-(--radius-md) border border-border bg-card px-3 py-2 text-meta font-medium text-muted-foreground">
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="sr-only">{label}</span>
      <select
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 min-w-0 flex-1 cursor-pointer appearance-auto border-0 bg-transparent p-0 text-body font-medium text-foreground outline-none disabled:cursor-not-allowed"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function StaticSpec({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Route;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-(--radius-md) border border-border bg-card px-3 py-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-body font-medium text-foreground">{value}</span>
        <span className="block truncate text-meta text-muted-foreground">{label} · {hint}</span>
      </span>
    </div>
  );
}

function AssetGrid({
  assets,
  imageLabel,
  removeLabel,
  onRemove,
  disabled,
}: {
  assets: UploadedAsset[];
  imageLabel: string;
  removeLabel: string;
  onRemove: (assetId: string) => void;
  disabled: boolean;
}) {
  return (
    <ul className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9" aria-label={imageLabel}>
      {assets.map((asset, index) => (
        <li key={asset.id} className="group relative aspect-square min-w-0 overflow-hidden rounded-(--radius-md) border border-border bg-card">
          {asset.type === "IMAGE" ? (
            <Image
              src={asset.url}
              alt={`${imageLabel} ${index + 1}`}
              fill
              unoptimized
              sizes="(min-width:1280px) 8vw, (min-width:640px) 16vw, 30vw"
              className="object-cover"
            />
          ) : (
            <span className="flex h-full flex-col items-center justify-center gap-2 p-2 text-center text-muted-foreground">
              <Film className="size-5" aria-hidden />
              <span className="line-clamp-2 text-[10px]">{asset.fileName}</span>
            </span>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(asset.id)}
            className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full border border-border bg-overlay text-foreground opacity-100 transition-opacity disabled:cursor-not-allowed disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            aria-label={`${removeLabel} ${index + 1}`}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

function isSupportedImage(file: File): boolean {
  return file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp";
}

function isSupportedReference(file: File): boolean {
  return isSupportedImage(file)
    || file.type === "video/mp4"
    || file.type === "video/quicktime"
    || file.type === "video/webm";
}

function isQualityTemplateId(value: string | undefined): value is typeof QUALITY_TEMPLATE_IDS[number] {
  return typeof value === "string" && (QUALITY_TEMPLATE_IDS as readonly string[]).includes(value);
}

function aspectRatioLabel(ratio: AspectRatio, copy: StudioCopy): string {
  if (ratio === "9:16") return copy.vertical;
  if (ratio === "16:9") return copy.horizontal;
  return copy.square;
}

function safeUploadError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message || message.length > 100) return fallback;
  if (/(api|key|token|provider|seedance|byteplus|blob|stack|json|https?:\/\/)/i.test(message)) return fallback;
  return message;
}
