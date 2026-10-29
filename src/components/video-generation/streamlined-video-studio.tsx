"use client";

import Link from "next/link";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clapperboard,
  Film,
  GalleryHorizontalEnd,
  ImagePlus,
  Link2,
  ListChecks,
  Loader2,
  Paperclip,
  PenLine,
  Settings2,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { QUOTE_TONE_CLASS } from "@/components/exchange/quote-header";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { requestPulseRefresh } from "@/lib/exchange/pulse";
import { formatRate, quotaStat, readingStat } from "@/lib/exchange/readings-registry";
import { SectionHead } from "@/components/exchange/section-head";
import { CreateModeTabs } from "@/components/product-images/create-mode-tabs";
import { uploadFilesToAssets } from "@/components/personal/upload-assets";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BrollQuickCard } from "@/components/video-generation/broll-quick-card";
import { ProductLinkPrefill } from "@/components/video-generation/product-link-prefill";
import {
  AudioCaptionControls,
  generateVoiceoverScript,
  type AudioCaptionControlValue,
} from "@/components/video-generation/audio-caption-controls";
import { FirstRunOnboardingDialog } from "@/components/video-generation/first-run-onboarding-dialog";
import { PlanPreviewCard } from "@/components/video-generation/plan-preview-card";
import { QuotaNextSteps } from "@/components/quota/quota-next-steps";
import { quotaNextStepsCopy } from "@/lib/quota-next-steps";
import {
  StoryboardWorkflowPanel,
  type StoryboardFrameRegenerateOptions,
  type StoryboardReferenceOption,
  type StoryboardRunView,
} from "@/components/video-generation/storyboard-workflow-panel";
import {
  VideoRouteSelector,
  type VideoRouteOverride,
} from "@/components/video-generation/video-route-selector";
import { useTranslation } from "@/i18n/useTranslation";
import { featureGate, type PublicCapabilities } from "@/lib/capabilities/registry";
import type { CustomerVideoDispatchResponse } from "@/lib/api/customer-video-dispatch";
import {
  customerDirectDispatchMessage,
  shouldResetDispatchAttempt,
} from "@/lib/api/customer-video-dispatch-recovery";
import { cn } from "@/lib/utils";
import type { WorkspaceBrandPackageView } from "@/lib/services/workspace-brand-package-service";
import { BRAND_END_CARD_ENTRY_ENABLED } from "@/lib/brand/brand-end-card-policy";
import { BROLL_ROUTE_ENTRY_ENABLED, PRODUCT_IMAGE_STUDIO_ENTRY_ENABLED } from "@/lib/create/entry-policy";
import { loadVoiceoverDraft, saveVoiceoverDraft } from "@/lib/video-generation/voiceover-draft-storage";
import { awaitVoiceoverDraft } from "@/lib/video-generation/voiceover-draft-wait";
import {
  COMMERCE_TEMPLATE_RECIPES,
  COMMERCE_TEMPLATE_SLUGS,
} from "@/lib/video-generation/commerce-template-catalog";
import { detectScriptLanguage } from "@/lib/video-generation/detect-script-language";
import { toOwnedCreationRequest } from "@/types/video-generation";
import type {
  AspectRatio,
  BrandEndingMode,
  OwnedUnifiedVideoGenerationRequest,
  UploadedAsset,
  VideoGenerationPlan,
} from "@/types/video-generation";

const MAX_PRODUCT_IMAGES = 9;
const MAX_ATTACHMENTS = 20;
const GUIDE_STORAGE_KEY = "aivora.streamlined-video-guide.v1";
const ONBOARDING_STORAGE_KEY = "aivora.create-onboarding.v1";
const STORYBOARD_ATTEMPT_STORAGE_KEY = "aivora.storyboard-attempt.v1";
const DISPATCH_ATTEMPT_STORAGE_KEY = "aivora.dispatch-attempt.v1";
const DISMISSED_STORYBOARDS_STORAGE_KEY = "aivora.dismissed-storyboards.v1";
const DURATIONS = [15, 30, 60] as const;
/// 出故事板前最多等 AI 口播稿这么久（服务端起稿自己 20 秒就放弃，这里多留一点网络余量）
const VOICEOVER_AUTO_DRAFT_WAIT_MS = 25_000;
const ASPECT_RATIOS: AspectRatio[] = ["9:16", "16:9", "1:1"];
const LEGACY_QUALITY_TEMPLATE_IDS = [
  "tpl_event_watch_party",
  "tpl_viral_result_first",
  "tpl_viral_pain_solution",
  "tpl_ugc_review",
  "tpl_viral_sensory_texture",
] as const;
const QUALITY_TEMPLATE_IDS = [
  ...COMMERCE_TEMPLATE_SLUGS,
  ...LEGACY_QUALITY_TEMPLATE_IDS,
] as const;

type CreationMode = "quick" | "advanced";
type ReferenceMode = "all" | "product_only";
type BusyState = "preview" | "storyboard" | "dispatch" | null;

interface StoredAttempt {
  fingerprint: string;
  key: string;
}

interface ResumableStoryboardPayload {
  run: StoryboardRunView;
  context: {
    prompt: string;
    durationSec: number;
    aspectRatio: string;
    sourceAssets: Array<{
      id: string;
      url: string;
      mimeType: string;
      width: number | null;
      height: number | null;
    }>;
  };
}

const ZH_COPY = {
  readingsLabel: "创作读数",
  readingsScope: "统计口径：本工作区实时读取，不含成品库样片；额度按 UTC 自然月计，失败与取消返还。",
  guideTitle: "第一次使用，顺着五步完成",
  guideBody: "产品图上传后直接进入创作，不经过 AI 审核；故事板会先把产品外观和场景连续性锁定。",
  /// 一页只有一套步骤：与首用弹窗同一个来源（platform-copy create.flowSteps）。
  guideSteps: getPlatformCopy("zh-CN").create.flowSteps.map((step) => step.title),
  workflowTitle: "当前创作流程",
  stageDone: "已完成",
  dismissGuide: "知道了，隐藏提示",
  optional: "可选",
  rowAssets: "产品素材",
  rowSpecs: "视频规格",
  rowEnding: "结尾联系方式",
  rowAudio: "口播与字幕",
  audioHint: "口播由成片直接说出，口播稿可随时修改；字幕在成片完成后按实际时长生成。",
  summaryVoiceover: "口播",
  summaryCaptions: "字幕",
  on: "开",
  off: "关",
  stepAsset: "选择产品素材（可选）",
  stepAssetHint: "最多 9 张。真实产品建议上传正面、侧面和细节图；不上传则使用纯文字生成。",
  productCount: "{count} / 9 张",
  productRequired: "暂未上传产品图，将使用纯文字生成。",
  removeProduct: "移除产品图",
  optionalReferences: "参考图与成片视频（可选）",
  optionalReferencesHint: "参考图用于补充风格；上传的视频可作为真实片段用于成片。",
  removeReference: "移除参考素材",
  unsupportedFile: "请选择受支持的图片或视频文件。",
  tooManyProducts: "产品图最多 9 张，多出的文件未上传。",
  tooManyReferences: "本次创作最多使用 20 个素材，多出的文件未上传。",
  uploaded: "已添加 {count} 个素材",
  uploadFailed: "素材上传未完成，请检查文件后重试。",
  quickHint: "系统自动完成镜头与质量检查",
  /// C4：能力暂停时这句说明要诚实——写作暂停 = 镜头按模板规划；看图暂停 = 画面质检跳过、成片照常
  quickHintNoQa: "系统自动完成镜头规划；画面质检暂停，成片照常生成",
  quickHintTemplateShots: "镜头先按模板规划，系统照常做质量检查",
  quickHintTemplateShotsNoQa: "镜头先按模板规划；画面质检暂停，成片照常生成",
  route: "生成线路",
  autoRoute: "Aivora 视频通道",
  routeHint: "故事板与视频统一走 Aivora 引擎",
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
  brandPackageStep: "结尾联系方式帧（可选）",
  brandPackageHint: "每条视频单独选择。关闭输出干净视频；开启后在片尾追加一帧品牌联系方式（logo 印在产品上，画面不再盖角标水印）。",
  cleanVideo: "只生成干净视频",
  cleanVideoHint: "不添加品牌 Logo 或尾卡",
  noBrandPackages: "当前工作区还没有可用品牌包；可先保持纯视频输出。",
  setUpBrandPackage: "去建品牌包",
  promptLabel: "描述你想生成的视频",
  promptPlaceholder: "例：把这只保温杯拍成通勤广告——清晨地铁站拿出来喝一口，到了办公室放在桌上，热气还在。",
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
  planningShots: "正在规划镜头…",
  writingVoiceover: "正在写口播稿…",
  cancelPlanning: "取消",
  planningCancelled: "已取消，素材和描述都保留着。",
  createStoryboard: "生成 AI 故事板",
  creatingStoryboard: "正在生成故事板…",
  storyboardFailed: "故事板暂时无法生成，请保留当前方案后重试。",
  editStoryboardConfirm: "修改创作方向会退出当前故事板。已生成的画面仍保留在任务记录中，确定继续吗？",
  approveFirst: "请先确认故事板",
  generate: "生成视频",
  generating: "正在提交…",
  stickySummary: "{count} 张产品图 · {ratio} · {duration} 秒",
  readyHint: "失败任务会按系统规则处理，不会因为重复点击产生重复提交。",
  cancelRound: "取消这一轮",
  cancelRoundHint: "生成服务出问题时，可以随时取消这一轮，素材和描述会保留。",
  routeCheckingHint: "正在检查所选生成线路，请稍候。",
  routeUnavailableHint: "所选线路当前不可用，请在线路菜单中更换后再提交。",
  quotaHint: "提交时预占 1 条额度，失败与取消自动返还：本月已用 {used} / {limit} 条。",
  previewFailed: "暂时无法准备生成方案，请稍后重试。",
  dispatchFailed: "暂时无法提交视频，请稍后重试。",
  qualityBlocked: "视频描述还需要更多细节。请按生成方案中的提示修改后再提交。",
  planHeading: "生成方案已准备",
  /// 2026-10-28 晚：创作页改成对话框优先（上线审核 §4）
  heroTitle: "今天想拍什么？",
  attachProduct: "商品图",
  attachReference: "参考",
  referenceTag: "参考",
  helpWrite: "帮我写",
  helpPolish: "帮我润色",
  helpWriting: "正在写…",
  helpWriteHint: "AI 看商品图（和你已经写的字）写两三句「拍什么」，你可以直接改；不占视频额度。",
  helpWriteNeedsInput: "先上传商品图，或写一句想拍什么。",
  helpWriteFailed: "这次没写出来，你原来的字都还在，可以再点一次。",
  helpWriteDone: "写好了，可以直接改。",
  tryThese: "试试这些",
  pasteLink: "贴商品链接",
  moreSettings: "更多设置",
  referenceModeHint: "全能参考：商品图和参考素材一起用；仅产品图：参考素材不参与生成。",
  rowPlan: "生成方案",
  previewPlanHint: "想先看 AI 打算怎么拍、能不能过，可以先核对方案；不核对也会在出故事板时一并生成。",
} as const;

type StudioCopy = {
  [Key in keyof typeof ZH_COPY]: (typeof ZH_COPY)[Key] extends readonly string[]
    ? readonly string[]
    : string;
};

const EN_COPY: StudioCopy = {
  readingsLabel: "Creation readings",
  readingsScope: "Live from this workspace; library samples excluded. The allowance runs per UTC month; failures and cancels are refunded.",
  guideTitle: "Follow five clear steps for your first video",
  guideBody: "Product uploads go straight into creation without AI review. The storyboard locks product identity and scene continuity first.",
  guideSteps: getPlatformCopy("en-US").create.flowSteps.map((step) => step.title),
  workflowTitle: "Current workflow",
  stageDone: "done",
  dismissGuide: "Got it, hide this guide",
  optional: "Optional",
  rowAssets: "Assets",
  rowSpecs: "Specs",
  rowEnding: "End frame",
  rowAudio: "Voice & captions",
  audioHint: "The video speaks your editable script; captions are timed to the finished video.",
  summaryVoiceover: "Voiceover",
  summaryCaptions: "Captions",
  on: "On",
  off: "Off",
  stepAsset: "Choose product assets (optional)",
  stepAssetHint: "Add up to 9 clear product images, or leave this empty for text-to-video generation.",
  productCount: "{count} / 9 images",
  productRequired: "No product image added. This will use text-to-video generation.",
  removeProduct: "Remove product image",
  optionalReferences: "Reference images and final-footage clips (optional)",
  optionalReferencesHint: "Images guide style. Uploaded videos can be used as real footage in the final edit.",
  removeReference: "Remove reference asset",
  unsupportedFile: "Choose a supported image or video file.",
  tooManyProducts: "You can use up to 9 product images. Extra files were not uploaded.",
  tooManyReferences: "A creation can use up to 20 assets. Extra files were not uploaded.",
  uploaded: "Added {count} assets",
  uploadFailed: "The upload did not finish. Check the files and try again.",
  quickHint: "Automatic shot planning and quality checks",
  quickHintNoQa: "Automatic shot planning; frame checks are paused, videos still render",
  quickHintTemplateShots: "Shots are planned from templates for now; quality checks still run",
  quickHintTemplateShotsNoQa: "Shots are planned from templates and frame checks are paused; videos still render",
  route: "Generation route",
  autoRoute: "Aivora video route",
  routeHint: "Storyboard and video stay on the Aivora engine",
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
  brandPackageStep: "Contact end frame (optional)",
  brandPackageHint: "Choose per video. Off produces a clean video; on appends one brand contact frame at the end (no corner watermark — the logo lives on the product).",
  cleanVideo: "Clean video only",
  cleanVideoHint: "No brand logo or end card",
  noBrandPackages: "This workspace has no active brand package yet. You can continue with a clean video.",
  setUpBrandPackage: "Set up a brand kit",
  promptLabel: "Describe the video you want to generate",
  promptPlaceholder: "Example: Turn this tumbler into a commute ad. A sip on the morning subway, then it sits on the office desk, still steaming.",
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
  planningShots: "Planning shots…",
  writingVoiceover: "Writing the voiceover…",
  cancelPlanning: "Cancel",
  planningCancelled: "Cancelled. Your uploads and description are kept.",
  createStoryboard: "Generate AI storyboard",
  creatingStoryboard: "Generating storyboard…",
  storyboardFailed: "The storyboard could not be generated right now. Your direction is preserved; try again shortly.",
  editStoryboardConfirm: "Editing the direction exits this storyboard. Generated frames remain in task history. Continue?",
  approveFirst: "Approve the storyboard first",
  generate: "Generate video",
  generating: "Submitting…",
  stickySummary: "{count} product images · {ratio} · {duration}s",
  readyHint: "Failed jobs follow safe recovery rules, and repeated clicks cannot create duplicate submissions.",
  cancelRound: "Cancel this round",
  cancelRoundHint: "If generation is having trouble, cancel this round anytime — your uploads and direction are kept.",
  routeCheckingHint: "Checking the selected generation route…",
  routeUnavailableHint: "The selected route is unavailable. Choose another route before submitting.",
  quotaHint: "Reserves 1 video at submission, refunded automatically on failure or cancel: {used} / {limit} used this month.",
  previewFailed: "The generation plan is temporarily unavailable. Try again shortly.",
  dispatchFailed: "The video could not be submitted right now. Try again shortly.",
  qualityBlocked: "The brief needs more detail. Update it using the generation-plan guidance, then submit again.",
  planHeading: "Generation plan ready",
  heroTitle: "What will you create today?",
  attachProduct: "Product photos",
  attachReference: "Reference",
  referenceTag: "Ref",
  helpWrite: "Write it for me",
  helpPolish: "Polish my words",
  helpWriting: "Writing…",
  helpWriteHint: "AI looks at your product photos (and anything you wrote) and drafts two or three sentences you can edit. It doesn't use your video allowance.",
  helpWriteNeedsInput: "Add a product photo or a few words first.",
  helpWriteFailed: "Couldn't write it this time. Your text is kept, so you can try again.",
  helpWriteDone: "Draft ready. Edit it as you like.",
  tryThese: "Try these",
  pasteLink: "Paste a product link",
  moreSettings: "More settings",
  referenceModeHint: "Use all references: product photos and references work together. Product only: references are left out.",
  rowPlan: "Generation plan",
  previewPlanHint: "Want to see how the AI plans to shoot it first? Review the plan, or skip it: it's built with the storyboard anyway.",
};

/**
 * 行情头读数：由 server page 读好后以纯数字传入。
 * 这里只声明形状，不 import 服务端 service（client bundle 铁律）。
 */
export type StudioReadings = {
  /** 真在生成的视频条数（与壳层「生成中」同源）。 */
  generating: number;
  filled24h: number;
  /** 本月（UTC）已用视频额度与生效上限（试用 3 条）。 */
  quotaUsed: number;
  quotaLimit: number;
  /** 0–100；近 7 天没有样本时为 null，界面写「—」。 */
  successRate7d: number | null;
};

export function StreamlinedVideoStudio({
  initialAssets = [],
  initialStyleTemplateId,
  initialPrompt = "",
  initialDurationSec,
  initialAspectRatio,
  retryOfOrderId = null,
  brandPackages = [],
  canSelectVideoRoute,
  showInternalVideoRoutes = false,
  forceOnboarding = false,
  brollAvailable = false,
  capabilities = null,
  readings = null,
  contactEmail = null,
}: {
  initialAssets?: UploadedAsset[];
  initialStyleTemplateId?: string;
  initialPrompt?: string;
  /** 成品库「重新生成」带回的原时长 / 画幅。 */
  initialDurationSec?: 15 | 30 | 60;
  initialAspectRatio?: AspectRatio;
  /** 成品库「重新生成」的原订单：有值时不做故事板静默恢复，避免覆盖预填。 */
  retryOfOrderId?: string | null;
  brandPackages?: WorkspaceBrandPackageView[];
  canSelectVideoRoute: boolean;
  showInternalVideoRoutes?: boolean;
  forceOnboarding?: boolean;
  brollAvailable?: boolean;
  /** C4 · 服务端读好的能力状态（纯 DTO）；缺省 = 不拦（老调用方、读失败）。 */
  capabilities?: PublicCapabilities | null;
  readings?: StudioReadings | null;
  /** 对外联系邮箱：服务端页面用 contactEmail() 取好传进来（额度用完时「联系我们」用；审计 A7）。 */
  contactEmail?: string | null;
}) {
  const router = useRouter();
  const { locale } = useTranslation();
  const english = locale === "en-US";
  const copy = english ? EN_COPY : ZH_COPY;
  /// C4 · 能力闸门：实拍线路要 写作 + 配音 + 图库；口播稿起草与镜头规划要写作；画面质检要看图。
  const brollGate = featureGate(capabilities, "broll");
  const narrationFromTemplate = featureGate(capabilities, "narrationDraft").status === "blocked";
  const shotsFromTemplate = featureGate(capabilities, "scriptWriting").status === "blocked";
  const frameQaPaused = featureGate(capabilities, "frameQa").status === "blocked";
  const quickModeHint = shotsFromTemplate && frameQaPaused
    ? copy.quickHintTemplateShotsNoQa
    : frameQaPaused
      ? copy.quickHintNoQa
      : shotsFromTemplate
        ? copy.quickHintTemplateShots
        : copy.quickHint;
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
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [productAssets, setProductAssets] = useState<UploadedAsset[]>(initialProductAssets);
  const [referenceAssets, setReferenceAssets] = useState<UploadedAsset[]>(initialReferenceAssets);
  const [uploadingTarget, setUploadingTarget] = useState<"product" | "reference" | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [creationMode, setCreationMode] = useState<CreationMode>("quick");
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>("all");
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatio>(
    initialAspectRatio ?? "9:16",
  );
  const [selectedDuration, setSelectedDuration] = useState<15 | 30 | 60>(
    initialDurationSec ?? 15,
  );
  const [styleTemplateId, setStyleTemplateId] = useState(seededStyleTemplateId);
  /// 默认出干净视频。1028 闭环轮曾改成默认选中品牌包，保温杯片尾因此冒出窗帘厂尾卡，当天撤回；
  /// 尾卡入口也已 A 级下线（BRAND_END_CARD_ENTRY_ENABLED），入口关着时这里恒为 null。
  const [selectedBrandPackageId, setSelectedBrandPackageId] = useState<string | null>(null);
  const [selectedVideoRouteId, setSelectedVideoRouteId] = useState<VideoRouteOverride>("");
  const [selectedRouteAvailable, setSelectedRouteAvailable] = useState<
    boolean | null
  >(true);
  const [rawPrompt, setRawPrompt] = useState(initialPrompt);
  const [audioCaptionSettings, setAudioCaptionSettings] =
    useState<AudioCaptionControlValue>(() => ({
      voiceoverEnabled: true,
      voiceId: "warm-confident",
      voiceoverScript: generateVoiceoverScript({
        prompt: initialPrompt,
        cta: null,
        durationSec: initialDurationSec ?? 15,
        language: locale,
        templateId: seededStyleTemplateId === "auto" ? null : seededStyleTemplateId,
      }),
      captionsEnabled: true,
      captionStyle: "word_by_word",
      captionPosition: "bottom",
      exportSrt: true,
      bgmTrackId: "none",
      bgmVolume: 0.2,
    }));
  const [plan, setPlan] = useState<VideoGenerationPlan | null>(null);
  const [planRequestKey, setPlanRequestKey] = useState<string | null>(null);
  const [storyboard, setStoryboard] = useState<StoryboardRunView | null>(null);
  const [storyboardFrameBusy, setStoryboardFrameBusy] = useState<string | null>(null);
  const [approvingStoryboard, setApprovingStoryboard] = useState(false);
  const [cancellingRound, setCancellingRound] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  /// 「生成 AI 故事板」里先出方案（40–60 秒）再建故事板：前半段主按钮写「正在规划镜头…」，别让人以为帧已经在画
  const [planningShots, setPlanningShots] = useState(false);
  /// 出方案期间也要能退出（每一轮都可取消）：只是不再等这次结果——出方案没有副作用、不占额度
  const planAbortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  /// 额度用完那条错误的原文：当前错误就是它时，错误框里给真实下一步（申请陪跑试点 / 联系我们）。
  /// 只按原文比对，别的错误替换掉它之后入口自然消失，不用在每个 setError 旁边清状态。
  const [quotaError, setQuotaError] = useState<string | null>(null);
  /// 「帮我写」进行中：输入框与主按钮一起锁住，免得 AI 稿盖掉刚敲的字、或拿旧描述出方案
  const [draftingPrompt, setDraftingPrompt] = useState(false);
  /// 卡下「更多设置」与「贴商品链接」默认收起：默认值都替商家定好，不展开也能出片
  const [moreOpen, setMoreOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const storyboardAttemptRef = useRef<StoredAttempt | null>(null);
  const dispatchAttemptRef = useRef<StoredAttempt | null>(null);
  const voiceoverEditedRef = useRef(false);
  /// 用户一旦改动任何创作输入，挂载时的静默恢复就必须放弃，避免覆盖新意图。
  const interactedRef = useRef(false);

  useEffect(() => {
    try {
      setShowGuide(localStorage.getItem(GUIDE_STORAGE_KEY) !== "dismissed");
      setOnboardingOpen(
        forceOnboarding
          || localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "dismissed",
      );
    } catch {
      setShowGuide(true);
      setOnboardingOpen(forceOnboarding);
    }
  }, [forceOnboarding]);

  useEffect(() => {
    /// 幂等键写入 sessionStorage：刷新后重提同一内容会命中服务端幂等回放，
    /// 而不是创建重复计费的新任务。
    storyboardAttemptRef.current = loadStoredAttempt(STORYBOARD_ATTEMPT_STORAGE_KEY);
    dispatchAttemptRef.current = loadStoredAttempt(DISPATCH_ATTEMPT_STORAGE_KEY);
  }, []);

  useEffect(() => {
    // Arriving from the Product Image Studio (or the regenerate link in the library)
    // expresses intent to start a new creation, so the silent resume stays out
    // of the way.
    if (initialProductAssets.length > 0 || retryOfOrderId) return;
    let cancelled = false;
    const resume = async () => {
      /// 恢复是「必须尽力」而不是「随缘」：0805 实测 APPROVED 故事板在刷新后
      /// 悬空 —— 挂载期这次 fetch 撞上瞬时失败（dev 重编译/网络抖动）就被旧的
      /// 静默 catch 吞掉，用户以为白做了。改为重试 + 失败留 console 痕。
      /// 1028 闭环轮实测：三次（共约 3 秒）扛不住一次重编译 / 冷启动，放宽到五次、退避约 15 秒；
      /// 用户这期间动了任何输入就放弃恢复（interactedRef），不会盖掉新意图。
      let payload:
        | { ok: true; resume: ResumableStoryboardPayload | null }
        | { ok: false }
        | null = null;
      const RESUME_BACKOFF_MS = [0, 800, 2_000, 4_000, 8_000];
      for (let attempt = 0; attempt < RESUME_BACKOFF_MS.length && !cancelled; attempt += 1) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, RESUME_BACKOFF_MS[attempt]));
        }
        try {
          const response = await fetch("/api/video-generation/storyboards", { cache: "no-store" });
          if (!response.ok) continue;
          payload = await response.json().catch(() => null);
          if (payload) break;
        } catch (error) {
          console.debug("[studio-resume] fetch attempt failed", attempt + 1, error);
        }
      }
      if (cancelled || !payload?.ok || !payload.resume) return;
      if (interactedRef.current) return;
      const { run, context } = payload.resume;
      if (run.status === "CANCELLED") return;
      if (loadDismissedStoryboardRunIds().includes(run.id)) return;
      setStoryboard(run);
      setRawPrompt(context.prompt);
      /// 故事板恢复了，口播稿也要回来：商家改过 / AI 写过的稿子不能悄悄退回模板稿
      const voiceoverDraft = loadVoiceoverDraft(sessionStorage, context.prompt);
      if (voiceoverDraft !== null) {
        voiceoverEditedRef.current = true;
        setAudioCaptionSettings((current) => ({ ...current, voiceoverScript: voiceoverDraft }));
      }
      if ((DURATIONS as readonly number[]).includes(context.durationSec)) {
        setSelectedDuration(context.durationSec as 15 | 30 | 60);
      }
      if (ASPECT_RATIOS.includes(context.aspectRatio as AspectRatio)) {
        setSelectedAspectRatio(context.aspectRatio as AspectRatio);
      }
      if (context.sourceAssets.length > 0) {
        setProductAssets(context.sourceAssets.slice(0, MAX_PRODUCT_IMAGES).map((asset, index) => ({
          id: asset.id,
          assetId: asset.id,
          type: "IMAGE" as const,
          inferredRole: "product_image" as const,
          roleConfidence: 1,
          url: asset.url,
          mimeType: asset.mimeType,
          fileName: `product-image-${index + 1}`,
          width: asset.width,
          height: asset.height,
          durationSeconds: null,
          userAssignedRole: "product_image" as const,
          suggestedUse: english
            ? "Restored from your storyboard in progress."
            : "已从进行中的故事板任务恢复。",
          warnings: [],
        })));
      }
      if (run.status === "FAILED") {
        setError(run.errorMessage ?? copy.storyboardFailed);
      }
      toast.success(
        english
          ? "Resumed your storyboard in progress."
          : "已恢复进行中的故事板任务。",
      );
      requestAnimationFrame(() => {
        document.getElementById("single-video-storyboard")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    };
    void resume();
    return () => {
      cancelled = true;
    };
  }, [copy.storyboardFailed, english, initialProductAssets.length, retryOfOrderId]);

  useEffect(() => {
    if (!retryOfOrderId) return;
    toast.success(
      english
        ? "Loaded the photos and direction from that video. Review them, then start a new storyboard."
        : "已载入那条视频的产品照片与创作方向。检查一下，再开始新的故事板。",
      { id: "create-retry-prefill" },
    );
  }, [english, retryOfOrderId]);

  const selectedBrandPackage = brandPackages.find(
    (brandPackage) => brandPackage.id === selectedBrandPackageId,
  ) ?? null;
  const activeStyleTemplateId = creationMode === "advanced"
    ? styleTemplateId
    : seededStyleTemplateId;
  const autoVoiceoverScript = useMemo(() => generateVoiceoverScript({
    prompt: rawPrompt,
    cta: selectedBrandPackage?.cta ?? null,
    durationSec: selectedDuration,
    language: locale,
    templateId: activeStyleTemplateId === "auto" ? null : activeStyleTemplateId,
  }), [
    activeStyleTemplateId,
    locale,
    rawPrompt,
    selectedBrandPackage?.cta,
    selectedDuration,
  ]);
  const {
    voiceoverEnabled,
    voiceId,
    voiceoverScript,
    captionsEnabled,
    captionStyle,
    captionPosition,
    exportSrt,
    bgmTrackId,
    bgmVolume,
  } = audioCaptionSettings;
  const brandPackageAssets = useMemo<UploadedAsset[]>(() => {
    if (!selectedBrandPackage) return [];
    const logo: UploadedAsset = {
      id: selectedBrandPackage.logoAsset.id,
      assetId: selectedBrandPackage.logoAsset.id,
      type: "IMAGE",
      inferredRole: "logo",
      roleConfidence: 1,
      url: selectedBrandPackage.logoAsset.url,
      mimeType: selectedBrandPackage.logoAsset.mimeType,
      fileName: `${selectedBrandPackage.name}-logo`,
      width: selectedBrandPackage.logoAsset.width,
      height: selectedBrandPackage.logoAsset.height,
      durationSeconds: null,
      userAssignedRole: "logo",
      suggestedUse: "Workspace brand package logo",
      warnings: [],
    };
    const endCard = selectedBrandPackage.endCardAsset;
    if (!endCard) return [logo];
    const isVideo = endCard.mimeType.startsWith("video/");
    return [
      logo,
      {
        id: endCard.id,
        assetId: endCard.id,
        type: isVideo ? "VIDEO" : "IMAGE",
        inferredRole: isVideo ? "outro_clip" : "reference_image",
        roleConfidence: 1,
        url: endCard.url,
        mimeType: endCard.mimeType,
        fileName: `${selectedBrandPackage.name}-end-card`,
        width: endCard.width,
        height: endCard.height,
        durationSeconds: null,
        userAssignedRole: isVideo ? "outro_clip" : "reference_image",
        suggestedUse: "Workspace brand package end card",
        warnings: [],
      },
    ];
  }, [selectedBrandPackage]);
  const activeAttachments = useMemo(() => {
    const creativeAssets = referenceMode === "all"
      ? [...productAssets, ...referenceAssets]
      : productAssets;
    const boundedCreativeAssets = creativeAssets.slice(
      0,
      Math.max(0, MAX_ATTACHMENTS - brandPackageAssets.length),
    );
    const seen = new Set(boundedCreativeAssets.map((asset) => asset.assetId ?? asset.id));
    return [
      ...boundedCreativeAssets,
      ...brandPackageAssets.filter((asset) => !seen.has(asset.assetId ?? asset.id)),
    ];
  }, [brandPackageAssets, productAssets, referenceAssets, referenceMode]);
  /// 重做单帧时可改选的参考图：只给创作台里的产品图（故事板的商家实拍就是这几张）。
  const storyboardReferenceOptions = useMemo<StoryboardReferenceOption[]>(
    () => productAssets.map((asset) => ({
      assetId: asset.assetId ?? asset.id,
      url: asset.url,
      label: asset.fileName,
    })),
    [productAssets],
  );

  useEffect(() => {
    if (voiceoverEditedRef.current) return;
    setAudioCaptionSettings((current) => (
      current.voiceoverScript === autoVoiceoverScript
        ? current
        : { ...current, voiceoverScript: autoVoiceoverScript }
    ));
  }, [autoVoiceoverScript]);

  /// 改过 / AI 写过的口播稿跟描述一起存进 sessionStorage，刷新后随故事板一起恢复
  useEffect(() => {
    if (voiceoverEditedRef.current) saveVoiceoverDraft(sessionStorage, rawPrompt, voiceoverScript);
  }, [rawPrompt, voiceoverScript]);

  const invalidatePlan = useCallback(() => {
    interactedRef.current = true;
    setPlan(null);
    setPlanRequestKey(null);
    setStoryboard(null);
    storyboardAttemptRef.current = null;
    dispatchAttemptRef.current = null;
    persistStoredAttempt(STORYBOARD_ATTEMPT_STORAGE_KEY, null);
    persistStoredAttempt(DISPATCH_ATTEMPT_STORAGE_KEY, null);
    setError(null);
  }, []);

  /**
   * 服务端真取消：还在出帧 / 等确认的故事板必须让服务端停下来（排队分镜不再提交，
   * 已提交的分镜继续收回素材），否则后台照样出帧计费，换台设备还会「复活」。
   * 返回 false 表示服务端没有确认取消：调用方必须保留这一轮并说明原因。
   */
  async function cancelStoryboardOnServer(run: StoryboardRunView): Promise<boolean> {
    if (run.status !== "GENERATING" && run.status !== "AWAITING_APPROVAL") return true;
    const failed = english
      ? "Could not cancel this round. Nothing was lost — please try again."
      : "暂时没能取消这一轮，素材都还在，请再试一次。";
    try {
      const response = await fetch(
        `/api/video-generation/storyboards/${encodeURIComponent(run.id)}/cancel`,
        { method: "POST" },
      );
      const payload = await response.json().catch(() => null) as
        | { ok: true; run: StoryboardRunView }
        | { ok: false; code?: string; error?: string }
        | null;
      if (response.ok && payload?.ok) return true;
      // 已确认 / 已失败 / 已不存在：服务端不会再为它出帧，前端放弃即可。
      if (payload && !payload.ok && (payload.code === "INVALID_STATE" || payload.code === "NOT_FOUND")) {
        return true;
      }
      setError(payload && !payload.ok && payload.error ? payload.error : failed);
      return false;
    } catch {
      setError(failed);
      return false;
    }
  }

  /**
   * 放弃当前这一轮创作。
   *
   * 供应商崩溃、故事板失败、任务卡住时，用户必须能退出这一轮而不是只能一直重试：
   * 先让服务端真取消（见 cancelStoryboardOnServer），再清掉本地的故事板、失败态与
   * 浏览器里的幂等键，并把这个 run 标记为不再自动恢复。素材和创作描述保留，方便
   * 直接改一改重开一轮。
   */
  async function cancelCurrentRound() {
    if (cancellingRound) return;
    const run = storyboard;
    if (run) {
      setCancellingRound(true);
      const cancelled = await cancelStoryboardOnServer(run);
      setCancellingRound(false);
      if (!cancelled) return;
      markStoryboardRunDismissed(run.id);
    }
    invalidatePlan();
    setBusy(null);
    toast.success(
      english
        ? "This round was cancelled. Your uploads and direction are kept."
        : "已取消这一轮创作。素材与创作描述都保留着，可以直接改一改重开。",
    );
  }

  const updateAudioCaptionSettings = useCallback((
    next: AudioCaptionControlValue,
  ) => {
    setAudioCaptionSettings((current) => {
      if (next.voiceoverScript !== current.voiceoverScript) {
        voiceoverEditedRef.current = true;
      }
      return next;
    });
    invalidatePlan();
  }, [invalidatePlan]);

  /// 2026-10-28：「生成口播稿」由 AI 按商家原话写（/api/video-generation/voiceover-draft）；
  /// AI 不可用、超时或超长时退回本地模板稿（与之前同一份）。AI 稿视同用户确认过的稿，描述再改也不被模板覆盖。
  const [voiceoverDrafting, setVoiceoverDrafting] = useState(false);
  /// 正在写的那一份 AI 口播稿（离开输入框 / 「生成口播稿」/ 出故事板前自动，三处共用）：同一时间只有一份，
  /// 出故事板时有就等它，不再并发写第二份。
  const voiceoverDraftRef = useRef<Promise<string | null> | null>(null);
  const draftVoiceoverWithAi = useCallback((signal?: AbortSignal): Promise<string | null> => {
    if (voiceoverDraftRef.current) return voiceoverDraftRef.current;
    const run = (async () => {
      setVoiceoverDrafting(true);
      try {
        const response = await fetch("/api/video-generation/voiceover-draft", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: rawPrompt,
            durationSec: selectedDuration,
            language: locale,
            cta: selectedBrandPackage?.cta ?? null,
          }),
          signal,
        });
        const payload = await response.json().catch(() => null) as { ok?: boolean; script?: string | null } | null;
        if (!response.ok || !payload?.script) return null;
        const script = payload.script;
        voiceoverEditedRef.current = true;
        setAudioCaptionSettings((current) => ({ ...current, voiceoverScript: script }));
        return script;
      } catch {
        return null;
      } finally {
        setVoiceoverDrafting(false);
        voiceoverDraftRef.current = null;
      }
    })();
    voiceoverDraftRef.current = run;
    return run;
  }, [locale, rawPrompt, selectedBrandPackage?.cta, selectedDuration]);
  const regenerateVoiceoverScript = useCallback(async () => {
    const applyTemplate = () => {
      voiceoverEditedRef.current = false;
      saveVoiceoverDraft(sessionStorage, rawPrompt, null);
      setAudioCaptionSettings((current) => ({ ...current, voiceoverScript: autoVoiceoverScript }));
    };
    if (!rawPrompt.trim() || narrationFromTemplate) {
      applyTemplate();
      invalidatePlan();
      return;
    }
    const script = await draftVoiceoverWithAi();
    if (!script) applyTemplate();
    invalidatePlan();
  }, [autoVoiceoverScript, draftVoiceoverWithAi, invalidatePlan, narrationFromTemplate, rawPrompt]);

  useEffect(() => {
    if (!storyboard || storyboard.status !== "GENERATING") return;
    let cancelled = false;
    let timer = 0;
    /// 服务端按「每次 reconcile 推进一帧」逐帧生成，UI 轮询是它唯一的前台驱动；
    /// 因此链条必须在失败/异常后照常续上，且页面回到前台时立即补一拍。
    const poll = async () => {
      let next: StoryboardRunView | null = null;
      try {
        const response = await fetch(
          `/api/video-generation/storyboards/${encodeURIComponent(storyboard.id)}`,
          { cache: "no-store" },
        );
        const payload = await response.json().catch(() => null) as
          | { ok: true; run: StoryboardRunView }
          | { ok: false; error?: string }
          | null;
        if (response.ok && payload?.ok) next = payload.run;
      } catch {
        // The durable storyboard remains available after a transient browser error.
      }
      if (cancelled) return;
      if (next?.status === "CANCELLED") {
        // 在另一台设备上取消了（或账号停用时被一并取消）：这一轮不会再出帧，退回编辑态。
        markStoryboardRunDismissed(next.id);
        setStoryboard(null);
        storyboardAttemptRef.current = null;
        persistStoredAttempt(STORYBOARD_ATTEMPT_STORAGE_KEY, null);
        setError(next.errorMessage ?? copy.storyboardFailed);
        return;
      }
      if (next) {
        setStoryboard(next);
        if (next.status === "FAILED") {
          setError(next.errorMessage ?? copy.storyboardFailed);
        }
        // A successful poll swaps `storyboard`, so the effect re-runs and
        // re-arms itself while the run is still generating.
        return;
      }
      timer = window.setTimeout(poll, 2_500);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      window.clearTimeout(timer);
      void poll();
    };
    timer = window.setTimeout(poll, 2_500);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [copy.storyboardFailed, storyboard]);

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

  function closeOnboarding(startCreating: boolean) {
    setOnboardingOpen(false);
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, "dismissed");
      if (!showGuide) localStorage.setItem(GUIDE_STORAGE_KEY, "dismissed");
      else localStorage.removeItem(GUIDE_STORAGE_KEY);
    } catch {
      // Storage unavailable: the dialog still closes for the current visit.
    }
    if (startCreating) {
      document
        .querySelector('[data-testid="streamlined-product-assets"]')
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function uploadProductImages(files: File[]) {
    if (busy !== null || uploadingTarget !== null || storyboard) return;
    interactedRef.current = true;
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
      const uploaded = await uploadFilesToAssets(accepted, {
        forceRole: "product_image",
        skipAiClassification: true,
      });
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
    if (busy !== null || uploadingTarget !== null || storyboard) return;
    interactedRef.current = true;
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
          ? uploadFilesToAssets(images, {
              forceRole: "reference_image",
              skipAiClassification: true,
            })
          : Promise.resolve([]),
        videos.length > 0
          ? uploadFilesToAssets(videos, {
              forceRole: "product_demo_clip",
              skipAiClassification: true,
            })
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
    if (busy !== null || storyboard) return;
    setProductAssets((current) => current.filter((asset) => asset.id !== assetId));
    invalidatePlan();
  }

  function removeReferenceAsset(assetId: string) {
    if (busy !== null || storyboard) return;
    setReferenceAssets((current) => current.filter((asset) => asset.id !== assetId));
    invalidatePlan();
  }

  /// voiceoverScriptOverride：出故事板前刚由 AI 写好的口播稿——同一次点击里 state 还没刷新，直接用它
  function buildRequest(voiceoverScriptOverride?: string | null): OwnedUnifiedVideoGenerationRequest {
    const script = voiceoverScriptOverride ?? voiceoverScript;
    const selectedBrandEndingMode: BrandEndingMode = selectedBrandPackage?.endCardAsset?.mimeType.startsWith("video/")
      ? "uploaded_clip"
      : selectedBrandPackage
        ? "auto_end_card"
        : "none";
    return toOwnedCreationRequest({
      userType: "platform",
      rawPrompt: rawPrompt.trim(),
      attachments: activeAttachments,
      selectedDuration,
      selectedAspectRatio,
      selectedBrandEndingMode,
      cta: selectedBrandPackage?.cta ?? null,
      platform: null,
      brandKit: selectedBrandPackage
        ? {
            brandName: selectedBrandPackage.brandName,
            slogan: selectedBrandPackage.slogan,
            website: selectedBrandPackage.website,
          }
        : null,
      language: locale,
      styleTemplateId: activeStyleTemplateId === "auto" ? null : activeStyleTemplateId,
      audio: {
        voiceover: {
          enabled: voiceoverEnabled,
          voiceId,
          /// P04-B：口播 / 字幕语言看稿子本身（含汉字 → zh-CN），不再拿界面 locale 代替
          language: detectScriptLanguage(script, locale),
          script: script.trim(),
        },
        bgm: {
          trackId: bgmTrackId,
          volume: bgmTrackId === "none" ? 0 : bgmVolume,
        },
      },
      captions: {
        enabled: captionsEnabled,
        style: captionStyle,
        language: detectScriptLanguage(script, locale),
        position: captionPosition,
        exportSrt,
      },
    });
  }

  function validateBeforeRequest(): string | null {
    if (!rawPrompt.trim()) return copy.promptRequired;
    if (voiceoverEnabled && !voiceoverScript.trim()) {
      return english
        ? "Add a voiceover script or turn native voiceover off."
        : "请填写口播稿，或关闭原生口播。";
    }
    return null;
  }

  async function fetchPlan(
    request: OwnedUnifiedVideoGenerationRequest,
    signal?: AbortSignal,
  ): Promise<VideoGenerationPlan> {
    const response = await fetch("/api/video-generation/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
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
    const controller = new AbortController();
    planAbortRef.current = controller;
    try {
      const nextPlan = await fetchPlan(request, controller.signal);
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
      if (controller.signal.aborted) toast.success(copy.planningCancelled);
      else setError(copy.previewFailed);
    } finally {
      planAbortRef.current = null;
      setBusy(null);
    }
  }

  function cancelPlanning() {
    planAbortRef.current?.abort();
  }

  async function handleCreateStoryboard() {
    const validationError = validateBeforeRequest();
    if (validationError) {
      setError(validationError);
      return;
    }
    let request = buildRequest();
    let requestKey = JSON.stringify(request);
    setError(null);
    setBusy("storyboard");
    try {
      let activePlan = plan;
      if (!activePlan || planRequestKey !== requestKey) {
        const controller = new AbortController();
        planAbortRef.current = controller;
        setPlanningShots(true);
        try {
          /// 口播稿还停在模板（没手改、AI 也没写过）或正有一份在写：出方案前先等 AI 按商家原话写的稿。
          /// 预填的描述（重新生成 / 帮我写 / 试试这些 / 贴链接）从不触发「离开输入框就起稿」，之前成片口播是模板套话；
          /// 写不出、超时或取消就照旧用模板稿（2026-10-29 灰度真机）。
          if (
            voiceoverEnabled
            && !narrationFromTemplate
            && rawPrompt.trim().length >= 12
            && (voiceoverDraftRef.current !== null || !voiceoverEditedRef.current)
          ) {
            const drafted = await awaitVoiceoverDraft(
              draftVoiceoverWithAi(controller.signal),
              controller.signal,
              VOICEOVER_AUTO_DRAFT_WAIT_MS,
            );
            if (drafted) {
              request = buildRequest(drafted);
              requestKey = JSON.stringify(request);
            }
          }
          activePlan = await fetchPlan(request, controller.signal);
        } catch (reason) {
          if (controller.signal.aborted) {
            toast.success(copy.planningCancelled);
            return;
          }
          throw reason;
        } finally {
          planAbortRef.current = null;
          setPlanningShots(false);
        }
        setPlan(activePlan);
        setPlanRequestKey(requestKey);
      }
      if (!activePlan.qualityReview.canDispatch) {
        setError(copy.qualityBlocked);
        return;
      }
      const storyboardBody = {
        prompt: request.rawPrompt,
        durationSec: request.selectedDuration,
        aspectRatio: request.selectedAspectRatio,
        sourceAssetIds: productAssets.map((asset) => asset.assetId ?? asset.id),
        approvalPolicy: "MANUAL" as const,
        purpose: "single-video-storyboard",
      };
      const fingerprint = JSON.stringify(storyboardBody);
      if (storyboardAttemptRef.current?.fingerprint !== fingerprint) {
        storyboardAttemptRef.current = { fingerprint, key: crypto.randomUUID() };
      }
      persistStoredAttempt(STORYBOARD_ATTEMPT_STORAGE_KEY, storyboardAttemptRef.current);
      const response = await fetch("/api/video-generation/storyboards", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": storyboardAttemptRef.current.key,
        },
        body: fingerprint,
      });
      const payload = await response.json().catch(() => null) as
        | { ok: true; run: StoryboardRunView }
        | { ok: false; error?: string }
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload && "error" in payload ? payload.error : copy.storyboardFailed);
      }
      setStoryboard(payload.run);
      requestAnimationFrame(() => {
        document.getElementById("single-video-storyboard")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.storyboardFailed);
    } finally {
      setBusy(null);
    }
  }

  async function regenerateStoryboardFrame(frameId: string, options: StoryboardFrameRegenerateOptions = {}) {
    if (!storyboard || storyboardFrameBusy || approvingStoryboard) return;
    setStoryboardFrameBusy(frameId);
    setError(null);
    try {
      const response = await fetch(
        `/api/video-generation/storyboards/${encodeURIComponent(storyboard.id)}/frames/${encodeURIComponent(frameId)}/regenerate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options),
        },
      );
      const payload = await response.json().catch(() => null) as
        | { ok: true; run: StoryboardRunView }
        | { ok: false; error?: string }
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload && "error" in payload ? payload.error : copy.storyboardFailed);
      }
      setStoryboard(payload.run);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.storyboardFailed);
    } finally {
      setStoryboardFrameBusy(null);
    }
  }

  async function approveStoryboard() {
    if (!storyboard?.canApprove || approvingStoryboard) return;
    setApprovingStoryboard(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/video-generation/storyboards/${encodeURIComponent(storyboard.id)}/approve`,
        { method: "POST" },
      );
      const payload = await response.json().catch(() => null) as
        | { ok: true; run: StoryboardRunView }
        | { ok: false; error?: string }
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload && "error" in payload ? payload.error : copy.storyboardFailed);
      }
      setStoryboard(payload.run);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.storyboardFailed);
    } finally {
      setApprovingStoryboard(false);
    }
  }

  async function editStoryboardDirection() {
    if (cancellingRound) return;
    if (!storyboard || window.confirm(copy.editStoryboardConfirm)) {
      interactedRef.current = true;
      if (storyboard) {
        // 退出故事板 = 放弃这一轮：仍在出帧的要让服务端停下，不在后台继续计费。
        setCancellingRound(true);
        const cancelled = await cancelStoryboardOnServer(storyboard);
        setCancellingRound(false);
        if (!cancelled) return;
        markStoryboardRunDismissed(storyboard.id);
      }
      setStoryboard(null);
      storyboardAttemptRef.current = null;
      dispatchAttemptRef.current = null;
      persistStoredAttempt(STORYBOARD_ATTEMPT_STORAGE_KEY, null);
      persistStoredAttempt(DISPATCH_ATTEMPT_STORAGE_KEY, null);
      setError(null);
      requestAnimationFrame(() => {
        document.getElementById("streamlined-video-prompt")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  }

  async function handleGenerate() {
    const validationError = validateBeforeRequest();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (storyboard?.status !== "APPROVED") {
      setError(copy.storyboardFailed);
      return;
    }
    const request = buildRequest();
    setError(null);
    setBusy("dispatch");
    try {
      /// 派发时服务端会重新出方案并做质量把关（拦下时回 QUALITY_BLOCKED，有专门提示），这里不再先等一遍 40–60 秒的方案——
      /// 刷新后恢复的故事板没有本页方案，以前得先「核对规格」再生成（1028 闭环轮 E2E #6）。
      /// 本页已有的当期方案若已判定不能生成，照旧直接拦下。
      if (plan && planRequestKey === JSON.stringify(request) && !plan.qualityReview.canDispatch) {
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
        storyboardRunId: storyboard.id,
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
      persistStoredAttempt(DISPATCH_ATTEMPT_STORAGE_KEY, dispatchAttemptRef.current);

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
        if (shouldResetDispatchAttempt(payload)) {
          dispatchAttemptRef.current = null;
          persistStoredAttempt(DISPATCH_ATTEMPT_STORAGE_KEY, null);
        }
        const message = customerDirectDispatchMessage(payload, locale);
        setError(message);
        setQuotaError(payload.code === "QUOTA_EXCEEDED" ? message : null);
        return;
      }
      if (!response.ok) throw new Error(copy.dispatchFailed);

      dispatchAttemptRef.current = null;
      persistStoredAttempt(DISPATCH_ATTEMPT_STORAGE_KEY, null);
      persistStoredAttempt(STORYBOARD_ATTEMPT_STORAGE_KEY, null);
      saveVoiceoverDraft(sessionStorage, rawPrompt, null);
      if (storyboard) markStoryboardRunDismissed(storyboard.id);
      requestPulseRefresh();
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
    && !draftingPrompt
    && selectedRouteAvailable === true;
  const configurationLocked = Boolean(storyboard);
  const locked = busy !== null || configurationLocked;
  const currentRequestKey = rawPrompt.trim()
    ? JSON.stringify(buildRequest())
    : null;
  const planIsCurrent = Boolean(
    plan && currentRequestKey && planRequestKey === currentRequestKey,
  );
  /// 本页当期方案已判定不能生成（要改描述或素材）；没有方案不算——方案在「生成 AI 故事板」里一并出，派发时服务端再把关。
  const planBlocksDispatch = Boolean(planIsCurrent && plan && !plan.qualityReview.canDispatch);
  /// 有故事板（含刷新后恢复的）就只按故事板走，不再要求本页先有方案（1028 闭环轮 E2E #6）。
  const canGenerate = Boolean(
    canReview
      && !planBlocksDispatch
      && storyboard?.status === "APPROVED",
  );
  /// 快速、高级两种模式都一键出故事板：不再单独「核对规格」（首用五步里本来就没有这一步，学 LibTV 一键出分镜）；
  /// 高级模式的「核对生成方案」留作可选预览。
  const needsStoryboard = !storyboard && !planBlocksDispatch;
  const storyboardGenerating = storyboard?.status === "GENERATING";
  const storyboardNeedsApproval = storyboard?.status === "AWAITING_APPROVAL";
  const primaryIsBusy = busy === "dispatch" || busy === "storyboard";
  /// 委托进度沿用首用提示的五步（guideSteps）：一页只有一套步骤，当前一步只有一个。
  /// 关键帧还在画时停在「生成 AI 故事板」，画完才进「确认每一帧」（不在 0/4 时标已完成）。
  const stageIndex = busy === "dispatch" || storyboard?.status === "APPROVED"
    ? 4
    : storyboard
      ? (storyboardGenerating ? 2 : 3)
      : planIsCurrent
        ? 2
        : rawPrompt.trim()
          ? 1
          : 0;
  /// 光只给正在发生的事：故事板逐帧生成或正在提交时，当前一步才带扫描光。
  const stageWorking = storyboardGenerating || busy === "storyboard" || busy === "dispatch";
  const ratioLabel = aspectRatioLabel(selectedAspectRatio, copy);
  const primaryLabel = busy === "dispatch"
    ? copy.generating
    : busy === "storyboard"
      ? (planningShots ? (voiceoverDrafting ? copy.writingVoiceover : copy.planningShots) : copy.creatingStoryboard)
      : needsStoryboard
        ? copy.createStoryboard
        : storyboardGenerating
          ? copy.creatingStoryboard
          : storyboardNeedsApproval
            ? copy.approveFirst
            : copy.generate;
  const PrimaryIcon = primaryIsBusy || storyboardGenerating
    ? Loader2
    : needsStoryboard || storyboardNeedsApproval
      ? GalleryHorizontalEnd
      : Clapperboard;
  const routeNeedsAttention = selectedRouteAvailable !== true;
  /// 本月额度已经用完：提交前就把真实下一步摆出来，不让人做完方案和故事板才在派发时撞墙（审计 A7）。
  const quotaExhausted = Boolean(readings && readings.quotaLimit > 0 && readings.quotaUsed >= readings.quotaLimit);
  const showingQuotaError = quotaError !== null && error === quotaError;
  /// 商家的成本是「成片条数」（本月额度，失败与取消返还），不是供应商积分：
  /// 之前这里给同行线路写死「900 积分/支」——供应商价目早已换成 700 分与按秒计费，客户也从没买过积分。
  const statusHint = selectedRouteAvailable === null
    ? copy.routeCheckingHint
    : selectedRouteAvailable === false
      ? copy.routeUnavailableHint
      : readings
        ? copy.quotaHint
            .replace("{used}", String(readings.quotaUsed))
            .replace("{limit}", String(readings.quotaLimit))
        : copy.readyHint;
  const attachDisabled = busy !== null || configurationLocked || uploadingTarget !== null || draftingPrompt;
  const productSlotsFull = productAssets.length >= MAX_PRODUCT_IMAGES
    || productAssets.length + referenceAssets.length >= MAX_ATTACHMENTS;
  const referenceSlotsFull = productAssets.length + referenceAssets.length
    >= MAX_ATTACHMENTS - (productAssets.length === 0 ? 1 : 0);

  /// 「帮我写 / 帮我润色」（2026-10-28 晚，上线审核 §3，回应 CEO「没有自动生成提示词，商家嫌写字麻烦」）：
  /// AI 看商品图（和已写的字）用商家的语言写两三句「拍什么」，商家直接改。只写文本、不扣额度；任何失败都保留原字。
  async function draftPrompt() {
    if (draftingPrompt || locked || uploadingTarget !== null) return;
    const hint = rawPrompt.trim();
    if (productAssets.length === 0 && !hint) {
      toast.error(copy.helpWriteNeedsInput);
      return;
    }
    interactedRef.current = true;
    setDraftingPrompt(true);
    try {
      const response = await fetch("/api/video-generation/prompt-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetIds: productAssets.map((asset) => asset.assetId ?? asset.id).slice(0, 6),
          hint: hint || null,
          durationSec: selectedDuration,
          language: locale,
        }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string | null } | null;
      if (response.ok && payload?.description) {
        setRawPrompt(payload.description);
        invalidatePlan();
        toast.success(copy.helpWriteDone);
      } else {
        toast.error(response.status === 400 ? copy.helpWriteNeedsInput : copy.helpWriteFailed);
      }
    } catch {
      toast.error(copy.helpWriteFailed);
    } finally {
      setDraftingPrompt(false);
    }
  }

  /// 拖到整张提示卡上也能传：有图先当商品图（满了转参考），只有视频就进参考
  function dropFiles(files: File[]) {
    if (files.length === 0) return;
    const images = files.filter((file) => isSupportedImage(file));
    if (images.length > 0 && !productSlotsFull) {
      void uploadProductImages(images);
      return;
    }
    void uploadReferenceAssets(files);
  }

  const loadedFromStudio = initialProductAssets.filter((initial) =>
    productAssets.some((asset) => asset.id === initial.id),
  );
  /// 读数取不到时写「—」，不放示例数字
  const readingStats = readings
    ? [
        readingStat("generating", readings.generating, locale),
        readingStat("filled24h", readings.filled24h, locale),
        quotaStat(readings.quotaUsed, readings.quotaLimit, locale),
        readingStat("successRate7d", formatRate(readings.successRate7d), locale),
      ]
    : [
        readingStat("generating", null, locale),
        readingStat("filled24h", null, locale),
        readingStat("monthlyQuota", null, locale),
        readingStat("successRate7d", null, locale),
      ];
  /// 模板芯片：「自动」= 系统按描述匹配；选了模板就按它的镜头配方走（原「快速 / 高级生成」并进这里，2026-10-28 晚）。
  /// 从模板库带进来的老模板不在配方表里，单独补一项，下拉显示才与实际一致。
  const templateOptions = [
    { value: "auto", label: copy.templateAuto },
    ...COMMERCE_TEMPLATE_RECIPES.map((recipe) => ({
      value: recipe.slug,
      label: english ? recipe.name : recipe.nameZh,
    })),
    ...(activeStyleTemplateId !== "auto"
      && !COMMERCE_TEMPLATE_RECIPES.some((recipe) => recipe.slug === activeStyleTemplateId)
      ? [{ value: activeStyleTemplateId, label: legacyTemplateLabel(activeStyleTemplateId, copy) }]
      : []),
  ];
  /// 写作 / 看图能力暂停时，在卡下明说镜头怎么规划、质检是否照常（C4 · 诚实说明）
  const capabilityDegraded = shotsFromTemplate || frameQaPaused;
  const moreSummary = `${copy.summaryVoiceover} ${voiceoverEnabled ? copy.on : copy.off} · ${copy.summaryCaptions} ${captionsEnabled ? copy.on : copy.off}`;

  /// 错误与额度提醒：没有故事板时贴在提示卡下面，有故事板时进底部操作条——同一份元素只渲染一处
  const statusNotices = (
    <>
      {error ? (
        <div role="alert" className="flex flex-wrap items-start gap-2 rounded-(--radius-md) border border-danger bg-danger-soft px-3 py-2 text-meta text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{error}</span>
          {/* 供应商挂了 / 这一轮失败时，用户必须有一条「不再纠缠这一轮」的出口 */}
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={cancellingRound}
            onClick={() => void cancelCurrentRound()}
          >
            <X aria-hidden />
            {copy.cancelRound}
          </Button>
          {showingQuotaError ? (
            <QuotaNextSteps locale={locale} contactEmail={contactEmail} className="basis-full" />
          ) : null}
        </div>
      ) : null}
      {quotaExhausted && !showingQuotaError ? (
        <div
          className="space-y-2 rounded-(--radius-md) border border-border bg-gold-soft px-3 py-2"
          data-testid="quota-exhausted-notice"
        >
          <p className="text-meta font-medium text-gold">{quotaNextStepsCopy(locale).exhausted}</p>
          <QuotaNextSteps locale={locale} contactEmail={contactEmail} />
        </div>
      ) : null}
    </>
  );

  /// 主按钮只有一枚：没有故事板时在提示卡右下角（像 Runway 的 Generate），有故事板时进故事板下面的操作条
  const generateBar = (
    <div
      role="group"
      aria-label={needsStoryboard ? copy.createStoryboard : copy.generate}
      data-testid="streamlined-generate-bar"
      className="flex flex-wrap items-center justify-end gap-2"
    >
      {/* 出方案要 40–60 秒，期间页面锁住：给一个出口（素材与描述原样保留） */}
      {busy === "preview" || planningShots ? (
        <Button type="button" variant="ghost" size="sm" onClick={cancelPlanning} data-testid="cancel-planning">
          <X aria-hidden />
          {copy.cancelPlanning}
        </Button>
      ) : null}
      <Button
        type="button"
        id="platform-primary-generate"
        disabled={needsStoryboard
          ? !canReview || busy !== null
          : storyboardGenerating || storyboardNeedsApproval || !canGenerate}
        onClick={() => {
          if (needsStoryboard) {
            void handleCreateStoryboard();
            return;
          }
          if (storyboardGenerating || storyboardNeedsApproval) {
            document.getElementById("single-video-storyboard")?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
            return;
          }
          void handleGenerate();
        }}
        className="min-w-36"
      >
        <PrimaryIcon
          className={primaryIsBusy || storyboardGenerating ? "animate-spin motion-reduce:animate-none" : undefined}
          aria-hidden
        />
        {primaryLabel}
      </Button>
    </div>
  );

  /// 五步流程（与首用提示同一个来源）：一页只有一套步骤，当前一步只有一个
  const workflowRail = (
    <ol
      aria-label={copy.workflowTitle}
      className="flex flex-wrap items-center justify-center gap-1"
      data-testid="creation-workflow-rail"
    >
      {copy.guideSteps.map((step, index) => {
        const state = index < stageIndex ? "done" : index === stageIndex ? "current" : "pending";
        return (
          <li
            key={step}
            aria-current={state === "current" ? "step" : undefined}
            data-beam={state === "current" && stageWorking ? "row" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-(--radius-pill) px-2.5 py-1 text-meta",
              state === "current"
                ? "bg-active text-foreground"
                : state === "done"
                  ? "text-muted-foreground"
                  : "text-tertiary",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "font-mono text-data tabular-nums",
                state === "done" ? "text-success" : state === "current" ? "text-accent" : "text-tertiary",
              )}
            >
              {state === "done" ? <Check className="size-3" /> : index + 1}
            </span>
            <span className="whitespace-nowrap">{step}</span>
            {state === "done" ? <span className="sr-only">{copy.stageDone}</span> : null}
          </li>
        );
      })}
    </ol>
  );

  return (
    <div className="space-y-10 pb-4" data-testid="streamlined-video-studio">
      <FirstRunOnboardingDialog
        open={onboardingOpen}
        english={english}
        keepHints={showGuide}
        onKeepHintsChange={setShowGuide}
        onSkip={() => closeOnboarding(false)}
        onStart={() => closeOnboarding(true)}
      />

      {/* 对话框优先（2026-10-28 晚，上线审核 §4）：学 Runway 首页——一句轻标题 + 一张提示卡，规格芯片在卡下面；
          默认值都替商家定好，口播 / 字幕 / 参考方式收进「更多设置」，不展开也能出片 */}
      <section aria-labelledby="create-hero-title" className="mx-auto w-full max-w-[52.5rem] space-y-4 pt-2 md:pt-6">
        {/* 「生成视频 / 产品图片」切换 A 级下线（entry-policy.ts）：商品图改进品牌套件 */}
        {PRODUCT_IMAGE_STUDIO_ENTRY_ENABLED ? <CreateModeTabs active="video" /> : null}
        <header className="space-y-3 text-center">
          <h1 id="create-hero-title" className="create-hero-title">{copy.heroTitle}</h1>
          <dl
            aria-label={copy.readingsLabel}
            title={copy.readingsScope}
            className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1 text-meta"
            data-testid="create-readings"
          >
            {readingStats.map((stat) => (
              <div key={stat.label} className="flex items-baseline gap-1.5">
                <dt className="text-tertiary">{stat.label}</dt>
                <dd className={cn("font-mono text-data tabular-nums", QUOTE_TONE_CLASS[stat.tone ?? "neutral"])}>{stat.value}</dd>
              </div>
            ))}
          </dl>
        </header>

        {showGuide ? (
          <section
            className="flex items-start gap-2 rounded-(--radius-md) border border-border bg-raised py-1 pl-3 pr-1 sm:items-center"
            aria-labelledby="streamlined-first-use-heading"
            data-testid="streamlined-first-use-guide"
          >
            <p className="min-w-0 flex-1 py-1.5 text-meta text-muted-foreground">
              <span id="streamlined-first-use-heading" className="font-medium text-foreground">{copy.guideTitle}</span>
              <span className="mx-2 text-tertiary" aria-hidden>·</span>
              {copy.guideBody}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground"
              onClick={dismissGuide}
              aria-label={copy.dismissGuide}
              title={copy.dismissGuide}
            >
              <X aria-hidden />
            </Button>
          </section>
        ) : null}

        {/* 提示卡：素材在上、描述在中、帮我写与主按钮在右下；整张卡都能拖进文件 */}
        <div
          id="streamlined-video-prompt"
          data-testid="streamlined-video-prompt"
          className={cn(
            "scroll-mt-24 rounded-(--radius-prompt) border bg-surface p-3 transition-colors duration-fast ease-out focus-within:border-(--accent-line) motion-reduce:transition-none sm:p-4",
            dragOver ? "border-(--accent-line)" : "border-border",
          )}
          onDragOver={(event) => {
            if (attachDisabled || !event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
          }}
          onDrop={(event) => {
            if (attachDisabled || !event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setDragOver(false);
            dropFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <div
            role="group"
            aria-label={copy.rowAssets}
            className="flex flex-wrap items-center gap-2"
            data-testid="streamlined-product-assets"
          >
            <AttachButton
              label={copy.attachProduct}
              hint={productAssets.length === 0 ? copy.productRequired : copy.stepAssetHint}
              accept="image/png,image/jpeg,image/webp"
              icon={ImagePlus}
              uploading={uploadingTarget === "product"}
              disabled={attachDisabled || productSlotsFull}
              onFiles={(files) => void uploadProductImages(files)}
            />
            <AssetThumbs
              assets={productAssets}
              imageLabel={copy.stepAsset}
              removeLabel={copy.removeProduct}
              onRemove={removeProductAsset}
              disabled={locked}
            />
            <AttachButton
              label={copy.attachReference}
              hint={copy.optionalReferencesHint}
              accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
              icon={Paperclip}
              uploading={uploadingTarget === "reference"}
              disabled={attachDisabled || referenceSlotsFull}
              onFiles={(files) => void uploadReferenceAssets(files)}
            />
            <AssetThumbs
              assets={referenceAssets}
              imageLabel={copy.optionalReferences}
              removeLabel={copy.removeReference}
              referenceTag={copy.referenceTag}
              onRemove={removeReferenceAsset}
              disabled={locked}
            />
            <span className="ml-auto self-end font-mono text-data tabular-nums text-tertiary">
              {copy.productCount.replace("{count}", String(productAssets.length))}
            </span>
          </div>
          <Textarea
            value={rawPrompt}
            maxLength={4000}
            rows={4}
            disabled={locked || draftingPrompt}
            aria-label={copy.promptLabel}
            aria-invalid={Boolean(error && !rawPrompt.trim())}
            onChange={(event) => {
              setRawPrompt(event.target.value);
              invalidatePlan();
            }}
            onBlur={() => {
              /// 写完描述离开输入框：口播稿还没被手动改过，就请 AI 按描述起一版（学 LibTV：AI 先写，人来改）
              if (!voiceoverEditedRef.current && voiceoverEnabled && rawPrompt.trim().length >= 12 && !voiceoverDrafting) {
                void regenerateVoiceoverScript();
              }
            }}
            placeholder={copy.promptPlaceholder}
            className="mt-3 max-h-80 min-h-28 resize-none border-0 bg-transparent px-1 py-1 text-body leading-relaxed shadow-none focus-visible:outline-none disabled:bg-transparent"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-data tabular-nums text-tertiary">
              {copy.charCount.replace("{count}", String(rawPrompt.length))}
            </span>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={locked || draftingPrompt || uploadingTarget !== null}
                onClick={() => void draftPrompt()}
                title={copy.helpWriteHint}
                data-testid="prompt-draft"
                className="[&_svg]:text-iris"
              >
                {draftingPrompt ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <PenLine aria-hidden />}
                {draftingPrompt ? copy.helpWriting : rawPrompt.trim() ? copy.helpPolish : copy.helpWrite}
              </Button>
              {!storyboard ? generateBar : null}
            </div>
          </div>
        </div>

        {uploadError ? <p role="alert" className="text-meta text-danger">{uploadError}</p> : null}
        {loadedFromStudio.length > 0 ? (
          <p role="status" className="text-meta text-success">
            {english
              ? "Loaded from Product Image Studio as a product consistency reference."
              : "已从产品图工作台载入，并作为产品一致性参考。"}
            <span className="ml-1 font-mono text-muted-foreground">
              {loadedFromStudio.map((asset) => asset.fileName).join("、")}
            </span>
          </p>
        ) : null}
        {!storyboard ? statusNotices : null}

        {/* 卡下的规格芯片：时长 · 画幅 · 模板 · 更多设置 */}
        <div
          role="group"
          aria-label={copy.rowSpecs}
          className="flex flex-wrap items-center justify-center gap-2"
          data-testid="streamlined-video-specs"
        >
          <ChipSelect
            label={copy.duration}
            value={String(selectedDuration)}
            disabled={locked}
            options={DURATIONS.map((duration) => ({ value: String(duration), label: `${duration}s` }))}
            onChange={(value) => {
              setSelectedDuration(Number(value) as 15 | 30 | 60);
              invalidatePlan();
            }}
          />
          <ChipSelect
            label={copy.aspect}
            value={selectedAspectRatio}
            disabled={locked}
            options={ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: aspectRatioLabel(ratio, copy) }))}
            onChange={(value) => {
              setSelectedAspectRatio(value as AspectRatio);
              invalidatePlan();
            }}
          />
          <ChipSelect
            label={copy.template}
            showLabel
            value={activeStyleTemplateId}
            disabled={locked}
            hint={quickModeHint}
            options={templateOptions}
            onChange={(value) => {
              setCreationMode("advanced");
              setStyleTemplateId(value);
              invalidatePlan();
            }}
            data-testid="streamlined-generation-mode"
          />
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls="streamlined-more-settings"
            onClick={() => setMoreOpen((open) => !open)}
            className={cn(CHIP_CLASS, moreOpen && "border-(--accent-line)")}
          >
            <Settings2 aria-hidden />
            {copy.moreSettings}
            <span className="font-normal text-tertiary">{moreSummary}</span>
          </button>
        </div>

        {/* 试试这些：一点就把描述填好（模板化的说法），也可以贴商品链接自动起草 */}
        {!storyboard ? (
          <div className="space-y-3">
            <div
              role="group"
              aria-label={english ? "Video prompt presets" : "视频提示词快捷选项"}
              className="flex flex-wrap items-center justify-center gap-1.5"
            >
              <span className="mr-1 text-meta text-tertiary">{copy.tryThese}</span>
              {copy.promptPresets.map((label, index) => (
                <button
                  key={label}
                  type="button"
                  className={CHIP_CLASS}
                  disabled={locked || draftingPrompt}
                  onClick={() => {
                    setRawPrompt(copy.presetPrompts[index] ?? "");
                    invalidatePlan();
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                aria-expanded={linkOpen}
                className={cn(CHIP_CLASS, linkOpen && "border-(--accent-line)")}
                disabled={locked}
                onClick={() => setLinkOpen((open) => !open)}
              >
                <Link2 aria-hidden />
                {copy.pasteLink}
              </button>
            </div>
            {/* 链接起片（PRD O1）：有独立站的商家贴链接自动预填描述 */}
            {linkOpen ? (
              <div className="mx-auto w-full max-w-xl">
                <ProductLinkPrefill
                  disabled={locked}
                  onPrefill={(promptText) => {
                    setRawPrompt((current) => (current.trim() ? `${current}\n${promptText}` : promptText));
                    invalidatePlan();
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 更多设置：收起时也保持挂载（线路可用性检查照常跑），只是不显示 */}
        <div
          id="streamlined-more-settings"
          hidden={!moreOpen}
          className="@container divide-y divide-border rounded-(--radius-card) border border-border bg-surface"
          data-testid="streamlined-more-settings"
        >
          <TicketRow label={copy.route}>
            {canSelectVideoRoute ? (
              <VideoRouteSelector
                canSelectVideoRoute={canSelectVideoRoute}
                showInternalRoutes={showInternalVideoRoutes}
                durationSeconds={selectedDuration}
                value={selectedVideoRouteId}
                disabled={locked}
                onChange={handleVideoRouteChange}
                onSelectedAvailabilityChange={handleSelectedRouteAvailabilityChange}
              />
            ) : (
              <p className="text-body">
                <span className="font-medium text-foreground">{copy.autoRoute}</span>
                <span className="text-meta text-muted-foreground"> · {copy.routeHint}</span>
              </p>
            )}
          </TicketRow>
          <TicketRow label={copy.referenceMode}>
            <p className="text-meta text-muted-foreground">{copy.referenceModeHint}</p>
            <Segmented
              label={copy.referenceMode}
              value={referenceMode}
              disabled={locked}
              onChange={(value) => {
                setReferenceMode(value as ReferenceMode);
                invalidatePlan();
              }}
              options={[
                { value: "all", label: copy.referenceAll },
                { value: "product_only", label: copy.referenceProduct },
              ]}
            />
          </TicketRow>
          {/* 口播 / 字幕 / 配乐：默认开口播与逐词字幕，口播稿 AI 先写、人来改 */}
          <TicketRow label={copy.rowAudio}>
            <p className="text-meta text-muted-foreground">{copy.audioHint}</p>
            <AudioCaptionControls
              value={audioCaptionSettings}
              english={english}
              disabled={locked}
              onChange={updateAudioCaptionSettings}
              onRegenerate={() => void regenerateVoiceoverScript()}
              regenerating={voiceoverDrafting}
              draftFromTemplate={narrationFromTemplate}
            />
          </TicketRow>
          {/* 品牌尾卡入口 A 级下线（2026-10-28，见 brand-end-card-policy.ts）：品牌跟着商品走，不再在片尾贴卡 */}
          {BRAND_END_CARD_ENTRY_ENABLED ? (
            <TicketRow
              data-testid="streamlined-brand-package"
              label={copy.rowEnding}
              optional={copy.optional}
            >
              <p className="text-meta text-muted-foreground">{copy.brandPackageHint}</p>
              <div className="grid gap-2 @md:grid-cols-2" role="group" aria-label={copy.brandPackageStep}>
                <OptionButton
                  active={selectedBrandPackageId === null}
                  title={copy.cleanVideo}
                  description={copy.cleanVideoHint}
                  disabled={locked}
                  onClick={() => {
                    setSelectedBrandPackageId(null);
                    invalidatePlan();
                  }}
                />
                {brandPackages.map((brandPackage) => (
                  <OptionButton
                    key={brandPackage.id}
                    active={selectedBrandPackageId === brandPackage.id}
                    title={brandPackage.name}
                    description={`${brandPackage.brandName} · ${english ? "contact end frame" : "联系方式帧"}`}
                    disabled={locked}
                    onClick={() => {
                      setSelectedBrandPackageId(brandPackage.id);
                      invalidatePlan();
                    }}
                  />
                ))}
              </div>
              {brandPackages.length === 0 ? (
                <p className="text-meta text-muted-foreground">
                  {copy.noBrandPackages}{" "}
                  {/* C1：给去处——上传 logo、留联系方式，成片结尾的联系卡就有了 */}
                  <Link href="/app/brands" className="font-medium text-foreground underline underline-offset-4 hover:text-accent">
                    {copy.setUpBrandPackage}
                  </Link>
                </p>
              ) : null}
            </TicketRow>
          ) : null}
          {/* 想先看 AI 怎么拍的人：可选的「核对生成方案」（不核对也会在出故事板时一并出方案） */}
          {!storyboard ? (
            <TicketRow label={copy.rowPlan}>
              <p className="text-meta text-muted-foreground">{copy.previewPlanHint}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={!canReview}
                onClick={() => void handlePreview()}
              >
                {busy === "preview" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <ListChecks aria-hidden />}
                {busy === "preview" ? copy.previewing : copy.previewPlan}
              </Button>
            </TicketRow>
          ) : null}
        </div>

        {capabilityDegraded ? (
          <p className="text-center text-meta text-gold" data-testid="create-capability-notice">{quickModeHint}</p>
        ) : null}
        {!storyboard ? (
          <p className={cn("text-center text-meta", routeNeedsAttention ? "text-gold" : "text-tertiary")}>
            {statusHint}
          </p>
        ) : null}
        {workflowRail}
      </section>

      {plan ? (
        <section
          id="streamlined-plan-preview"
          className="scroll-mt-24 space-y-3"
          aria-label={copy.planHeading}
        >
          <SectionHead title={copy.planHeading} />
          <PlanPreviewCard plan={plan} />
        </section>
      ) : null}

      {storyboard ? (
        <div id="single-video-storyboard" className="scroll-mt-24 space-y-3">
          <StoryboardWorkflowPanel
            run={storyboard}
            english={english}
            busyFrameId={storyboardFrameBusy}
            approving={approvingStoryboard}
            referenceOptions={storyboardReferenceOptions}
            onRegenerate={(frameId, options) => void regenerateStoryboardFrame(frameId, options)}
            onApprove={() => void approveStoryboard()}
            onEditPlan={() => void editStoryboardDirection()}
          />
          {/* 任何一轮创作都要有退出口：卡在生成中或失败时，用户不必只能等或只能重试 */}
          <div className="flex flex-wrap items-center justify-end gap-2 text-meta text-muted-foreground">
            <span className="min-w-0 flex-1">{copy.cancelRoundHint}</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={cancellingRound}
              onClick={() => void cancelCurrentRound()}
            >
              <X aria-hidden />
              {copy.cancelRound}
            </Button>
          </div>
          {/* 有故事板之后的操作条：贴底常驻（窄屏也看得到唯一的主按钮） */}
          <div className="sticky bottom-20 z-10 space-y-3 rounded-(--radius-card) border border-border bg-surface p-3 md:bottom-10">
            {statusNotices}
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-foreground">
                  {copy.stickySummary
                    .replace("{count}", String(productAssets.length))
                    .replace("{ratio}", ratioLabel)
                    .replace("{duration}", String(selectedDuration))}
                </p>
                <p className={cn("mt-0.5 truncate text-meta", routeNeedsAttention ? "text-gold" : "text-muted-foreground")}>
                  {statusHint}
                </p>
              </div>
              {generateBar}
            </div>
          </div>
        </div>
      ) : null}

      {/* 第三条线路：实拍图库 b-roll（自包含，不接故事板状态机）；能力暂停时禁用提交并写明原因 */}
      {BROLL_ROUTE_ENTRY_ENABLED ? <BrollQuickCard available={brollAvailable} gate={brollGate} /> : null}
    </div>
  );
}

/// 卡下芯片与「试试这些」共用一套外观（学 Runway 模型芯片：约 38px 高、12px 圆角、二级面）
const CHIP_CLASS =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-(--radius-lg) border border-border bg-raised px-3 text-meta font-medium text-foreground transition-colors duration-fast ease-out hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

/**
 * 「更多设置」里的一行：左侧短标签（窄屏时折到上方），右侧是这一项的控件。
 * 行本身就是容器——不再套卡片；只有真正的输入（下拉、文本框）是下沉井。
 */
function TicketRow({
  label,
  optional,
  reading,
  className,
  children,
  ...props
}: {
  label: string;
  optional?: string;
  reading?: React.ReactNode;
  children: React.ReactNode;
} & Omit<React.ComponentProps<"section">, "children">) {
  return (
    <section
      {...props}
      aria-label={label}
      className={cn(
        "grid min-w-0 gap-x-6 gap-y-3 px-4 py-4 @xl:grid-cols-[8.5rem_minmax(0,1fr)] @xl:px-5 @xl:py-5",
        className,
      )}
    >
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 @xl:flex-col @xl:justify-start @xl:gap-2">
        <h2 className="x-label text-muted-foreground">{label}</h2>
        {reading || optional ? (
          <p className="flex items-baseline gap-2 font-mono text-data tabular-nums text-muted-foreground">
            {reading}
            {optional ? <span className="x-label">{optional}</span> : null}
          </p>
        ) : null}
      </header>
      <div className="@container min-w-0 space-y-3">{children}</div>
    </section>
  );
}

/** 片尾这类二选一：选中只用信号色细线与信号色字，不铺实心色块。 */
function OptionButton({
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
  icon?: LucideIcon;
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
        "flex min-w-0 items-start gap-2.5 rounded-(--radius-md) border px-3 py-2.5 text-left transition-colors duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none",
        active
          ? "border-(--accent-line) text-accent"
          : "border-border text-foreground hover:border-border-strong",
      )}
    >
      {Icon ? (
        <Icon className={cn("mt-0.5 size-4 shrink-0", active ? "text-accent" : "text-muted-foreground")} aria-hidden />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium">{title}</span>
        <span className="mt-0.5 block text-meta text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

/** 参考方式这类档位：所有选项一眼看全，一次点击；选中态与 OptionButton 同一套语言。 */
function Segmented({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            /// 与原生下拉一致：只有真正换档才触发（重复点当前档不会作废已核对的方案）。
            onClick={() => {
              if (!active) onChange(option.value);
            }}
            className={cn(
              "inline-flex h-10 items-center rounded-(--radius-md) border px-3 text-meta font-medium tabular-nums transition-colors duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none sm:h-8",
              active
                ? "border-(--accent-line) text-accent"
                : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 卡下的规格芯片：透明的原生下拉铺满整枚芯片——点哪里都能打开，键盘与读屏开箱即用；
 * 只有真正换档才触发（重复选当前档不会作废已核对的方案）。
 */
function ChipSelect({
  label,
  showLabel = false,
  value,
  options,
  disabled,
  hint,
  onChange,
  className,
  ...props
}: {
  label: string;
  /// 芯片上显示「模板」这类前缀；时长、画幅的值自己就说明了，只给读屏
  showLabel?: boolean;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  hint?: string;
  onChange: (value: string) => void;
} & Omit<React.ComponentProps<"label">, "onChange" | "children">) {
  const selected = options.find((option) => option.value === value);
  return (
    <label
      {...props}
      title={hint}
      className={cn(
        CHIP_CLASS,
        "relative pr-8 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
        disabled ? "cursor-not-allowed opacity-50 hover:border-border" : "cursor-pointer",
        className,
      )}
    >
      <span className={showLabel ? "text-muted-foreground" : "sr-only"}>{label}</span>
      <span aria-hidden className="max-w-56 truncate">{selected?.label ?? value}</span>
      <ChevronDown className="pointer-events-none absolute right-3" aria-hidden />
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value !== value) onChange(event.target.value);
        }}
        className="absolute inset-0 cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

/** 提示卡里的「+ 商品图 / + 参考」：按钮代点隐藏的文件框；拖到整张卡上也能传（见提示卡的 onDrop）。 */
function AttachButton({
  label,
  hint,
  accept,
  icon: Icon,
  uploading,
  disabled,
  onFiles,
}: {
  label: string;
  hint: string;
  accept: string;
  icon: LucideIcon;
  uploading: boolean;
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        title={hint}
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-14 shrink-0 items-center gap-1.5 rounded-(--radius-md) border border-dashed border-border-strong px-3 text-meta font-medium text-muted-foreground transition-colors duration-fast ease-out hover:border-(--accent-line) hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
      >
        {uploading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Icon className="size-4" aria-hidden />}
        {label}
      </button>
    </>
  );
}

/** 提示卡里的素材缩略图：参考素材带角标；移除按钮悬停 / 聚焦时出现（触屏常显），锁定时不给。 */
function AssetThumbs({
  assets,
  imageLabel,
  removeLabel,
  referenceTag,
  onRemove,
  disabled,
}: {
  assets: UploadedAsset[];
  imageLabel: string;
  removeLabel: string;
  referenceTag?: string;
  onRemove: (assetId: string) => void;
  disabled: boolean;
}) {
  if (assets.length === 0) return null;
  return (
    <ul className="flex min-w-0 flex-wrap items-center gap-2" aria-label={imageLabel}>
      {assets.map((asset, index) => (
        <li key={asset.id} className="group relative size-14 shrink-0 overflow-hidden rounded-(--radius-md) border border-border bg-sunken">
          {asset.type === "IMAGE" ? (
            <Image
              src={asset.url}
              alt={`${imageLabel} ${index + 1}`}
              fill
              unoptimized
              sizes="56px"
              className="object-cover"
            />
          ) : (
            <span className="flex h-full items-center justify-center text-muted-foreground" title={asset.fileName}>
              <Film className="size-4" aria-hidden />
              <span className="sr-only">{asset.fileName}</span>
            </span>
          )}
          {referenceTag ? (
            <span aria-hidden className="absolute bottom-0.5 left-0.5 rounded-(--radius-sm) bg-overlay px-1 text-micro text-foreground">
              {referenceTag}
            </span>
          ) : null}
          {disabled ? null : (
            <button
              type="button"
              onClick={() => onRemove(asset.id)}
              className="absolute right-0.5 top-0.5 flex size-6 items-center justify-center rounded-(--radius-sm) bg-overlay text-foreground opacity-100 transition-opacity focus-visible:outline-2 focus-visible:outline-ring sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
              aria-label={`${removeLabel} ${index + 1}`}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** 从模板库带进来的老模板（不在配方表里）在模板芯片上的名字。 */
function legacyTemplateLabel(templateId: string, copy: StudioCopy): string {
  switch (templateId) {
    case "tpl_event_watch_party":
      return copy.templateEvent;
    case "tpl_viral_result_first":
      return copy.templateResult;
    case "tpl_viral_pain_solution":
      return copy.templatePain;
    case "tpl_ugc_review":
      return copy.templateUgc;
    case "tpl_viral_sensory_texture":
      return copy.templateSensory;
    default:
      return templateId;
  }
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

function loadStoredAttempt(storageKey: string): StoredAttempt | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAttempt> | null;
    if (typeof parsed?.fingerprint === "string" && typeof parsed?.key === "string") {
      return { fingerprint: parsed.fingerprint, key: parsed.key };
    }
  } catch {
    // Session storage unavailable: the attempt simply restarts with a new key.
  }
  return null;
}

function persistStoredAttempt(storageKey: string, attempt: StoredAttempt | null): void {
  try {
    if (attempt) sessionStorage.setItem(storageKey, JSON.stringify(attempt));
    else sessionStorage.removeItem(storageKey);
  } catch {
    // Session storage unavailable: idempotent replay still works within this visit.
  }
}

function loadDismissedStoryboardRunIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED_STORYBOARDS_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function markStoryboardRunDismissed(runId: string): void {
  try {
    const ids = [runId, ...loadDismissedStoryboardRunIds().filter((id) => id !== runId)].slice(0, 20);
    localStorage.setItem(DISMISSED_STORYBOARDS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable: the run may resume again on the next visit.
  }
}
