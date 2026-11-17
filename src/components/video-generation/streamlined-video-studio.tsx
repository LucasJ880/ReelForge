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
  Loader2,
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
import { uploadFilesToAssets } from "@/components/personal/upload-assets";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  AudioCaptionControls,
  type AudioCaptionControlValue,
} from "@/components/video-generation/audio-caption-controls";
import { FirstRunOnboardingDialog } from "@/components/video-generation/first-run-onboarding-dialog";
import { QuotaNextSteps } from "@/components/quota/quota-next-steps";
import { quotaNextStepsCopy } from "@/lib/quota-next-steps";
import {
  StoryboardWorkflowPanel,
  type StoryboardFrameRegenerateOptions,
  type StoryboardReferenceOption,
  type StoryboardRunView,
} from "@/components/video-generation/storyboard-workflow-panel";
import { CustomerRoutePicker } from "@/components/video-generation/customer-route-picker";
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
import { HOOK_ANGLES, applyHookAngle, detectHookAngle, stripHookAngle } from "@/lib/create/hook-angles";
import { applyProductSize, detectProductSize, PRODUCT_SIZE_MAX, stripProductSize } from "@/lib/create/product-size";
import { SIGNOFF_BRAND_MAX, SIGNOFF_CTA_MAX } from "@/lib/video-generation/brand-signoff";
import { DIRECTOR_STYLES, directorLineBlocker, directorStyle } from "@/lib/video-generation/director-line-policy";
import { decideStoryboardResume } from "@/lib/create/storyboard-resume";
import { loadVoiceoverDraft, saveVoiceoverDraft } from "@/lib/video-generation/voiceover-draft-storage";
import { detectScriptLanguage } from "@/lib/video-generation/detect-script-language";
import { toOwnedCreationRequest } from "@/types/video-generation";
import type {
  AspectRatio,
  BrandEndingMode,
  OwnedUnifiedVideoGenerationRequest,
  UploadedAsset,
} from "@/types/video-generation";

const MAX_PRODUCT_IMAGES = 9;
const MAX_ATTACHMENTS = 20;
const GUIDE_STORAGE_KEY = "aivora.streamlined-video-guide.v1";
const ONBOARDING_STORAGE_KEY = "aivora.create-onboarding.v1";
const STORYBOARD_ATTEMPT_STORAGE_KEY = "aivora.storyboard-attempt.v1";
const DISPATCH_ATTEMPT_STORAGE_KEY = "aivora.dispatch-attempt.v1";
const DISMISSED_STORYBOARDS_STORAGE_KEY = "aivora.dismissed-storyboards.v1";
/// 导演线路只做 15 / 30 秒，都是整条一次生成（60 秒 2026-11-17 下线）
const DURATIONS = [15, 30] as const;
const ASPECT_RATIOS: AspectRatio[] = ["9:16", "16:9", "1:1"];

type CreationMode = "quick" | "advanced";
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
  resumeOfferGenerating: "你有一轮故事板还在出画面。",
  resumeOfferAwaiting: "你有一轮故事板画好了，等你确认。",
  resumeOfferApproved: "你有一轮故事板已经确认，还没开始生成视频。",
  resumeOfferFailed: "你有一轮故事板没做完：有画面没画成，已画好的都保留着。",
  resumeOfferHint: "接着处理会把那一轮的商品图和描述带回来，替换现在填的内容。",
  resumeOfferApply: "接着处理那一轮",
  resumeOfferDismiss: "不用了",
  rowCornerLogo: "右上角 Logo",
  cornerLogoToggle: "全程在右上角挂上 Logo",
  cornerLogoHint: "用你默认品牌包里的 Logo，做成透明的白色图形角标，像水印一样全程挂在右上角。透明底的 PNG 效果最好；白底深色线稿也可以。",
  cornerLogoMissing: "还没有 Logo：先到「品牌」页给默认品牌包传一张（透明底 PNG 最好），这里就能勾上。",
  directorStagesHint: "AI 正在看商品图、写整条片的镜头脚本和台词，一般一到三分钟；写好会先给你看开场画面和每个镜头。",
  directorVoiceHint: "这条片由 AI 导演写镜头脚本：台词、配乐和音效都写在脚本里，由出片模型直接配。你在这里填了口播稿的话，AI 会照着你的稿子排进各个镜头。",
  rowSignoff: "片尾落款",
  signoffToggle: "最后两秒带上品牌名",
  signoffHint: "在成片最后两秒的画面上压一行品牌名和一句行动指引，不另加一帧。只对这一条生效；成片出来后也可以在成品库里加或去掉。",
  signoffBrand: "品牌名",
  signoffBrandPlaceholder: "例：NORDA",
  signoffCta: "行动指引（可选）",
  signoffCtaPlaceholder: "例：主页看更多",
  signoffRequired: "开启片尾落款要填品牌名，或者把它关掉。",
  signoffLogo: "在品牌名上方带上 Logo",
  signoffLogoHint: "用你默认品牌包里的 Logo，垫白底，和文字一起淡入。",
  summarySignoff: "落款",
  summaryDirectorAudio: "AI 配音配乐",
  summaryCornerLogo: "右上角 Logo",
  directorStepScript: "AI 写镜头脚本",
  directorStepApprove: "确认画面和脚本",
  summaryCaptions: "字幕",
  on: "开",
  off: "关",
  stepAsset: "选择产品素材（可选）",
  stepAssetHint: "最多 9 张。真实产品建议上传正面、侧面和细节图；不上传则使用纯文字生成。",
  productCount: "{count} / 9 张",
  productRequired: "先上传至少一张商品实拍图：片子里的商品照着它拍。",
  needsProductPhoto: "还差一步：先上传至少一张商品实拍图，片子里的商品是照着它拍的。",
  removeProduct: "移除产品图",
  unsupportedFile: "请选择受支持的图片或视频文件。",
  tooManyProducts: "产品图最多 9 张，多出的文件未上传。",
  uploaded: "已添加 {count} 个素材",
  uploadFailed: "素材上传未完成，请检查文件后重试。",
  quickHint: "系统自动完成镜头与质量检查",
  /// C4：能力暂停时这句说明要诚实——写作暂停 = 镜头按模板规划
  quickHintTemplateShots: "镜头先按模板规划，系统照常做质量检查",
  route: "生成线路",
  aspect: "画幅",
  duration: "时长",
  vertical: "9:16 竖屏",
  horizontal: "16:9 横屏",
  square: "1:1 方形",
  template: "创意模板",
  templateAuto: "自动匹配（推荐）",
  brandPackageStep: "结尾联系方式帧（可选）",
  brandPackageHint: "每条视频单独选择。关闭输出干净视频；开启后在片尾追加一帧品牌联系方式（logo 印在产品上，画面不再盖角标水印）。",
  cleanVideo: "只生成干净视频",
  cleanVideoHint: "不添加品牌 Logo 或尾卡",
  noBrandPackages: "当前工作区还没有可用品牌包；可先保持纯视频输出。",
  setUpBrandPackage: "去建品牌包",
  promptLabel: "描述你想生成的视频",
  promptPlaceholder: "例：婴儿纱布口水巾，三条一包。宝宝吃辅食总漏一身，戴上它，米糊落在口水巾上，衣服干干净净。",
  promptRequired: "请填写视频提示词。",
  promptPresets: ["真实 UGC 演示", "产品质感展示", "痛点到效果"],
  presetPrompts: [
    "真实 UGC 产品演示：人物在可信生活场景中自然使用产品，开头直接呈现问题，中段清楚展示使用动作与结果，产品外观与上传图片保持一致。",
    "产品质感展示：用简洁光线和近景镜头突出产品材质、结构与细节，画面高级克制，产品外观与上传图片保持一致。",
    "痛点到效果：前 3 秒呈现一个真实具体的问题，随后用产品完成一次清晰使用动作，结尾展示可信结果，不夸大产品功能。",
  ],
  charCount: "{count} / 4000",
  /// 「生成 AI 故事板」一个按钮背后是三段等待：写明现在在哪一段、哪一段最久
  stagesLabel: "生成故事板的进度",
  directorStages: ["写镜头脚本（约 1–3 分钟）", "出开场画面"],
  recentTitle: "接着拍这些商品",
  recentHint: "点一下带回商品图和上次的描述，改一改再拍。",
  recentManage: "管理商品",
  recentImages: "{count} 张图",
  productSize: "商品尺寸",
  productSizePlaceholder: "例：直径约 8 厘米，一只手能握住",
  productSizeHint: "写上实际大小，商品在画面里才不会忽大忽小。",
  cancelPlanning: "取消",
  planningCancelled: "已取消，素材和描述都保留着。",
  createStoryboard: "生成 AI 故事板",
  creatingStoryboard: "正在生成故事板…",
  cancellingStoryboardCreate: "正在取消…",
  storyboardFailed: "故事板暂时无法生成，请保留当前方案后重试。",
  editStoryboardTitle: "退出这个故事板，回去改描述？",
  editStoryboardBody: "这一轮到此结束，还在生成的画面会停下。已经生成的画面仍保留在任务记录里，商品图和描述不会丢。",
  editStoryboardConfirm: "退出故事板",
  editStoryboardStay: "留在这里",
  approveFirst: "请先确认故事板",
  generate: "生成视频",
  generating: "正在提交…",
  stickySummary: "{count} 张产品图 · {ratio} · {duration} 秒",
  readyHint: "失败任务会按系统规则处理，不会因为重复点击产生重复提交。",
  cancelRound: "取消这一轮",
  cancelRoundHint: "生成服务出问题时，可以随时取消这一轮，素材和描述会保留。",
  finishingEditableHint: "画面已经定了。口播稿、字幕、配乐、片尾落款和出片线路，在点「生成视频」之前都还能在「更多设置」里改。",
  quotaHint: "提交时预占 1 条额度，失败与取消自动返还：本月已用 {used} / {limit} 条。",
  dispatchFailed: "暂时无法提交视频，请稍后重试。",
  /// 2026-10-28 晚：创作页改成对话框优先（上线审核 §4）
  heroTitle: "今天想拍什么？",
  attachProduct: "商品图",
  helpWrite: "帮我写",
  helpPolish: "帮我润色",
  helpWriting: "正在写…",
  helpWriteHint: "AI 看商品图（和你已经写的字）写两三句「拍什么」，你可以直接改；不占视频额度。",
  helpWriteNeedsInput: "先上传商品图，或写一句想拍什么。",
  helpWriteFailed: "这次没写出来，你原来的字都还在，可以再点一次。",
  helpWriteDone: "写好了，可以直接改。",
  tryThese: "试试这些",
  hookAngles: "换个开头",
  moreSettings: "更多设置",
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
  resumeOfferGenerating: "You have a storyboard that is still being drawn.",
  resumeOfferAwaiting: "You have a finished storyboard waiting for your approval.",
  resumeOfferApproved: "You have an approved storyboard that hasn't been turned into a video yet.",
  resumeOfferFailed: "You have an unfinished storyboard: some frames failed, and the finished ones are kept.",
  resumeOfferHint: "Picking it up brings back that round's product photos and description, replacing what you've entered here.",
  resumeOfferApply: "Pick that round up",
  resumeOfferDismiss: "No thanks",
  rowCornerLogo: "Corner logo",
  cornerLogoToggle: "Keep the logo in the top-right corner",
  cornerLogoHint: "Uses the logo from your default brand package as a transparent white mark in the top-right corner for the whole video. A transparent PNG works best; dark line art on white also works.",
  cornerLogoMissing: "No logo yet: upload one to your default brand package on the Brand page (a transparent PNG works best) and you can turn this on.",
  directorStagesHint: "AI is studying your product photos and writing the full shot script and lines. This usually takes one to three minutes; you'll see the opening frame and every shot before anything is filmed.",
  directorVoiceHint: "An AI director writes the shot script for this video: lines, music and sound are written into it and voiced by the video model. If you fill in a voiceover script here, the AI fits your script into the shots.",
  rowSignoff: "Brand sign-off",
  signoffToggle: "Show the brand name for the last two seconds",
  signoffHint: "Your brand name and a call to action appear over the last two seconds of footage. No extra frame is added. It applies to this video only, and you can add or remove it later from the Library.",
  signoffBrand: "Brand name",
  signoffBrandPlaceholder: "e.g. NORDA",
  signoffCta: "Call to action (optional)",
  signoffCtaPlaceholder: "e.g. See more on our profile",
  signoffRequired: "Enter a brand name for the sign-off, or turn it off.",
  signoffLogo: "Show the logo above the brand name",
  signoffLogoHint: "Uses the logo from your default brand package on a white plate; it fades in with the text.",
  summarySignoff: "Sign-off",
  summaryDirectorAudio: "AI voice and music",
  summaryCornerLogo: "Corner logo",
  directorStepScript: "AI writes the shot script",
  directorStepApprove: "Approve frame and script",
  summaryCaptions: "Captions",
  on: "On",
  off: "Off",
  stepAsset: "Choose product assets (optional)",
  stepAssetHint: "Add up to 9 clear product images, or leave this empty for text-to-video generation.",
  productCount: "{count} / 9 images",
  productRequired: "Upload at least one real product photo first: the product in the video is filmed from it.",
  needsProductPhoto: "One more step: upload at least one real product photo. The product in the video is filmed from it.",
  removeProduct: "Remove product image",
  unsupportedFile: "Choose a supported image or video file.",
  tooManyProducts: "You can use up to 9 product images. Extra files were not uploaded.",
  uploaded: "Added {count} assets",
  uploadFailed: "The upload did not finish. Check the files and try again.",
  quickHint: "Automatic shot planning and quality checks",
  quickHintTemplateShots: "Shots are planned from templates for now; quality checks still run",
  route: "Generation route",
  aspect: "Format",
  duration: "Length",
  vertical: "9:16 vertical",
  horizontal: "16:9 horizontal",
  square: "1:1 square",
  template: "Creative template",
  templateAuto: "Auto match (recommended)",
  brandPackageStep: "Contact end frame (optional)",
  brandPackageHint: "Choose per video. Off produces a clean video; on appends one brand contact frame at the end (no corner watermark — the logo lives on the product).",
  cleanVideo: "Clean video only",
  cleanVideoHint: "No brand logo or end card",
  noBrandPackages: "This workspace has no active brand package yet. You can continue with a clean video.",
  setUpBrandPackage: "Set up a brand kit",
  promptLabel: "Describe the video you want to generate",
  promptPlaceholder: "Example: Muslin baby bibs, three in a pack. Feeding time always ends up on the shirt; with the bib on, the puree lands on the bib and the shirt stays clean.",
  promptRequired: "Write a video prompt.",
  promptPresets: ["Real UGC demo", "Material showcase", "Pain to result"],
  presetPrompts: [
    "A realistic UGC product demo in a believable everyday setting. Open with a specific problem, show one clear use action and outcome, and keep the product identical to the uploaded images.",
    "A restrained product showcase using clean light and close shots to reveal materials, construction, and details. Keep the product identical to the uploaded images.",
    "Show one real problem in the first three seconds, solve it with one clear product action, and end on a believable result without exaggerating any feature.",
  ],
  charCount: "{count} / 4000",
  stagesLabel: "Storyboard progress",
  directorStages: ["Write the shot script (about 1–3 min)", "Draw the opening frame"],
  recentTitle: "Pick up one of these products",
  recentHint: "One click brings back its photos and your last brief — tweak it and shoot again.",
  recentManage: "Manage products",
  recentImages: "{count} photos",
  productSize: "Product size",
  productSizePlaceholder: "e.g. about 8 cm across, fits in one hand",
  productSizeHint: "Give the real size so the product does not grow or shrink between shots.",
  cancelPlanning: "Cancel",
  planningCancelled: "Cancelled. Your uploads and description are kept.",
  createStoryboard: "Generate AI storyboard",
  creatingStoryboard: "Generating storyboard…",
  cancellingStoryboardCreate: "Cancelling…",
  storyboardFailed: "The storyboard could not be generated right now. Your direction is preserved; try again shortly.",
  editStoryboardTitle: "Leave this storyboard and edit the brief?",
  editStoryboardBody: "This round ends here and any frames still generating will stop. Frames already made stay in task history, and your product photos and brief are kept.",
  editStoryboardConfirm: "Leave storyboard",
  editStoryboardStay: "Stay here",
  approveFirst: "Approve the storyboard first",
  generate: "Generate video",
  generating: "Submitting…",
  stickySummary: "{count} product images · {ratio} · {duration}s",
  readyHint: "Failed jobs follow safe recovery rules, and repeated clicks cannot create duplicate submissions.",
  cancelRound: "Cancel this round",
  cancelRoundHint: "If generation is having trouble, cancel this round anytime — your uploads and direction are kept.",
  finishingEditableHint: "The shots are set. You can still change the script, captions, music, sign-off and video route under More settings until you generate the video.",
  quotaHint: "Reserves 1 video at submission, refunded automatically on failure or cancel: {used} / {limit} used this month.",
  dispatchFailed: "The video could not be submitted right now. Try again shortly.",
  heroTitle: "What will you create today?",
  attachProduct: "Product photos",
  helpWrite: "Write it for me",
  helpPolish: "Polish my words",
  helpWriting: "Writing…",
  helpWriteHint: "AI looks at your product photos (and anything you wrote) and drafts two or three sentences you can edit. It doesn't use your video allowance.",
  helpWriteNeedsInput: "Add a product photo or a few words first.",
  helpWriteFailed: "Couldn't write it this time. Your text is kept, so you can try again.",
  helpWriteDone: "Draft ready. Edit it as you like.",
  tryThese: "Try these",
  hookAngles: "Change the opening",
  moreSettings: "More settings",
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
  initialVoiceoverScript = "",
  machineTaskId = null,
  retryOfOrderId = null,
  loadedProductName = null,
  brandPackages = [],
  forceOnboarding = false,
  returningUser = false,
  capabilities = null,
  readings = null,
  contactEmail = null,
  recentSources = [],
  resumeRequested = false,
}: {
  /**
   * 明确要接着处理上一轮故事板（成品库顶部「回创作页继续」带 ?resume=1 过来）：失败的那一轮也直接带回来。
   * 不带这个参数时，失败的旧故事板不再自动把素材和描述填回表单，只给一条提示让用户自己选。
   */
  resumeRequested?: boolean;
  /** 最近拍过的商品（服务端按属主读好）：空白创作页上点一下就带回那一单的商品图和描述。 */
  /// 「接着拍」那一行：存好的商品（/app/create?product=…）和最近拍过的一单（?retry=…），去处由页面给
  recentSources?: ReadonlyArray<{ id: string; href: string; title: string; thumbnailUrl: string; imageCount: number }>;
  initialAssets?: UploadedAsset[];
  initialStyleTemplateId?: string;
  initialPrompt?: string;
  /** 成品库「重新生成」带回的原时长 / 画幅。 */
  initialDurationSec?: 15 | 30 | 60;
  initialAspectRatio?: AspectRatio;
  /** 机器任务带来的口播稿。有值时不再用模板稿覆盖。 */
  initialVoiceoverScript?: string;
  /** 机器任务 id。创作台点「生成故事板」时挂回该任务，不另开一条。 */
  machineTaskId?: string | null;
  /** 成品库「重新生成」的原订单：有值时不做故事板静默恢复，避免覆盖预填。 */
  retryOfOrderId?: string | null;
  /** 从商品档案带着商品图进来（/app/create?product=…）时那件商品的名字：只用来把「已载入」那句话说对。 */
  loadedProductName?: string | null;
  brandPackages?: WorkspaceBrandPackageView[];
  forceOnboarding?: boolean;
  /**
   * 这个账号已经出过成片：不再自动弹「5 步出第一条成片」、也不挂「第一次使用」引导条。
   * 之前只看浏览器本地记号——出过几十条片的商家换台电脑 / 清了缓存又被当成新人（2026-11-10）。
   * 顶栏问号 → 指南里的「重开新手指引」（guide=open）照旧能打开。
   */
  returningUser?: boolean;
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
  /// C4 · 能力闸门：镜头脚本要 AI 写作。
  const shotsFromTemplate = featureGate(capabilities, "scriptWriting").status === "blocked";
  const quickModeHint = shotsFromTemplate ? copy.quickHintTemplateShots : copy.quickHint;
  const initialProductAssets = initialAssets
    .filter((asset) => asset.type === "IMAGE")
    .slice(0, MAX_PRODUCT_IMAGES)
    .map((asset) => ({ ...asset, userAssignedRole: "product_image" as const }));
  const seededStyleTemplateId = isQualityTemplateId(initialStyleTemplateId)
    ? initialStyleTemplateId
    : "auto";

  /// 首屏就按「是不是出过成片」决定：原来一律先渲染成 true，出过几十条片的商家每次打开创作页
  /// 都先看到「第一次使用」提示条闪一下、等页面脚本跑完才消失，下面的内容跟着跳一下（2026-11-10）。
  const [showGuide, setShowGuide] = useState(!returningUser);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [productAssets, setProductAssets] = useState<UploadedAsset[]>(initialProductAssets);
  const [uploadingTarget, setUploadingTarget] = useState<"product" | "reference" | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [creationMode, setCreationMode] = useState<CreationMode>("quick");
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatio>(
    initialAspectRatio ?? "9:16",
  );
  const [selectedDuration, setSelectedDuration] = useState<15 | 30>(
    /// 以前做的 60 秒片「再做一条」带回来时落到 30 秒
    initialDurationSec === 60 ? 30 : initialDurationSec ?? 15,
  );
  const [styleTemplateId, setStyleTemplateId] = useState(seededStyleTemplateId);
  /// 默认出干净视频。1028 闭环轮曾改成默认选中品牌包，保温杯片尾因此冒出窗帘厂尾卡，当天撤回；
  /// 尾卡入口也已 A 级下线（BRAND_END_CARD_ENTRY_ENABLED），入口关着时这里恒为 null。
  const [selectedBrandPackageId, setSelectedBrandPackageId] = useState<string | null>(null);
  const [rawPrompt, setRawPrompt] = useState(initialPrompt);
  const [audioCaptionSettings, setAudioCaptionSettings] =
    useState<AudioCaptionControlValue>(() => ({
      /// 只放商家自己写的口播稿；空着 = AI 按描述给每个镜头写一句
      voiceoverScript: initialVoiceoverScript.trim(),
      captionsEnabled: true,
      captionStyle: "word_by_word",
      captionPosition: "bottom",
      exportSrt: true,
      bgmTrackId: "none",
      bgmVolume: 0.2,
    }));
  /// 片尾落款：默认不带。预填只取商家自己工作区的品牌包（默认的那个优先），不取全局包——
  /// 10-28 的「保温杯配窗帘厂 logo」就是别人的品牌被默认带上了。
  const ownBrandForSignoff = useMemo(() => {
    const own = brandPackages.filter((entry) => entry.scope === "workspace");
    return own.find((entry) => entry.isDefault) ?? own[0] ?? null;
  }, [brandPackages]);
  const [signoffEnabled, setSignoffEnabled] = useState(false);
  const [signoffBrand, setSignoffBrand] = useState(ownBrandForSignoff?.brandName ?? "");
  const [signoffCta, setSignoffCta] = useState(ownBrandForSignoff?.cta ?? "");
  /// Logo 只是一个开关：用哪张图由服务端在合成时按账号取（自己工作区的默认品牌包）
  const signoffLogoUrl = ownBrandForSignoff?.logoAsset?.url ?? null;
  const [signoffLogo, setSignoffLogo] = useState(false);
  /// 右上角 Logo：默认不带；图片和片尾落款的 Logo 同一个来源（自己工作区的默认品牌包）
  const [cornerLogo, setCornerLogo] = useState(false);
  const [storyboard, setStoryboard] = useState<StoryboardRunView | null>(null);
  const [storyboardFrameBusy, setStoryboardFrameBusy] = useState<string | null>(null);
  const [approvingStoryboard, setApprovingStoryboard] = useState(false);
  const [cancellingRound, setCancellingRound] = useState(false);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  /// 「生成故事板」的提交要十几秒到一分钟、服务端已经开始出第一帧，中途断不掉：商家点了取消就记下来，
  /// 提交一返回立刻让服务端真取消这一轮（铁律 #7：每一轮任务都能取消）。
  const cancelStoryboardCreateRef = useRef(false);
  const [cancellingStoryboardCreate, setCancellingStoryboardCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// 额度用完那条错误的原文：当前错误就是它时，错误框里给真实下一步（申请陪跑试点 / 联系我们）。
  /// 只按原文比对，别的错误替换掉它之后入口自然消失，不用在每个 setError 旁边清状态。
  const [quotaError, setQuotaError] = useState<string | null>(null);
  /// 「帮我写」进行中：输入框与主按钮一起锁住，免得 AI 稿盖掉刚敲的字、或拿旧描述出方案
  const [draftingPrompt, setDraftingPrompt] = useState(false);
  /// 卡下「更多设置」默认收起：默认值都替商家定好，不展开也能出片
  const [moreOpen, setMoreOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const storyboardAttemptRef = useRef<StoredAttempt | null>(null);
  const dispatchAttemptRef = useRef<StoredAttempt | null>(null);
  /// 用户一旦改动任何创作输入，挂载时的静默恢复就必须放弃，避免覆盖新意图。
  const interactedRef = useRef(false);
  /// 表单现在是不是已经有用户的内容（描述变了、有商品图 / 参考图、正在上传）。恢复请求要先跟供应商对账，
  /// 可能几十秒后才回来：回来那一刻按表单的现状判断，不只看「动没动过」的记号（11-17 线上实测：恢复晚到，把刚填的内容整个换掉了）。
  const formDirtyRef = useRef(false);
  /// 没有自动带回来的上一轮故事板：只在表单上方给一条提示，接不接着处理由用户选
  const [resumeOffer, setResumeOffer] = useState<ResumableStoryboardPayload | null>(null);
  const storyboardOnPageRef = useRef(false);

  useEffect(() => {
    try {
      setShowGuide(!returningUser && localStorage.getItem(GUIDE_STORAGE_KEY) !== "dismissed");
      setOnboardingOpen(
        forceOnboarding
          || (!returningUser && localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "dismissed"),
      );
    } catch {
      setShowGuide(!returningUser);
      setOnboardingOpen(forceOnboarding);
    }
  }, [forceOnboarding, returningUser]);

  useEffect(() => {
    /// 幂等键写入 sessionStorage：刷新后重提同一内容会命中服务端幂等回放，
    /// 而不是创建重复计费的新任务。
    storyboardAttemptRef.current = loadStoredAttempt(STORYBOARD_ATTEMPT_STORAGE_KEY);
    dispatchAttemptRef.current = loadStoredAttempt(DISPATCH_ATTEMPT_STORAGE_KEY);
  }, []);

  /// 给晚到的恢复请求看的「表单现状」：每次渲染后更新
  useEffect(() => {
    formDirtyRef.current =
      rawPrompt.trim() !== initialPrompt.trim()
      || productAssets.length !== initialProductAssets.length
      || uploadingTarget !== null;
    storyboardOnPageRef.current = storyboard !== null;
  });

  /** 把上一轮故事板和它的素材、描述带回表单（挂载时自动恢复，或用户点了「接着处理那一轮」）。 */
  const applyResume = useCallback((resume: ResumableStoryboardPayload) => {
    const { run, context } = resume;
    interactedRef.current = true;
    setResumeOffer(null);
    setStoryboard(run);
    setRawPrompt(context.prompt);
    /// 故事板恢复了，商家自己写的口播稿也要回来
    const voiceoverDraft = loadVoiceoverDraft(sessionStorage, context.prompt);
    if (voiceoverDraft !== null) {
      setAudioCaptionSettings((current) => ({ ...current, voiceoverScript: voiceoverDraft }));
    }
    if ((DURATIONS as readonly number[]).includes(context.durationSec)) {
      setSelectedDuration(context.durationSec as 15 | 30);
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
  }, [copy.storyboardFailed, english]);

  useEffect(() => {
    // Arriving with prefilled product photos (a saved product, the regenerate link in the
    // library, a machine task) expresses intent to start a new creation, so the silent
    // resume stays out of the way.
    if (initialProductAssets.length > 0 || retryOfOrderId || machineTaskId) return;
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
      const { run } = payload.resume;
      /// 带不带回来按请求回来那一刻的表单现状判断（规矩见 storyboard-resume.ts）：表单已经有内容、或那一轮早就失败了，
      /// 就只给一条提示，不动表单
      const decision = decideStoryboardResume({
        runStatus: run.status,
        formTouched: interactedRef.current || formDirtyRef.current,
        resumeRequested,
        dismissed: loadDismissedStoryboardRunIds().includes(run.id),
        storyboardOnPage: storyboardOnPageRef.current,
      });
      if (decision === "apply") applyResume(payload.resume);
      else if (decision === "offer") setResumeOffer(payload.resume);
    };
    void resume();
    return () => {
      cancelled = true;
    };
  }, [applyResume, initialProductAssets.length, machineTaskId, resumeRequested, retryOfOrderId]);

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
  /// 导演线路是唯一的出片方式（和服务端同一条判断）：要有商品实拍图、15 / 30 秒、风格在风格卡里。
  /// 现在做不了的原因（没传图等）用来把按钮说明白；界面一律按导演线路摆。
  const directorBlocker = directorLineBlocker({
    durationSec: selectedDuration,
    productImageCount: productAssets.length,
    styleTemplateId: activeStyleTemplateId === "auto" ? null : activeStyleTemplateId,
  });
  const selectedStyle = directorStyle(activeStyleTemplateId === "auto" ? null : activeStyleTemplateId);
  const {
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
    /// 导演线路只照着商品实拍图拍：创作素材就是这几张图（参考素材入口 2026-11-17 随老线路删除）
    const creativeAssets = productAssets;
    const boundedCreativeAssets = creativeAssets.slice(
      0,
      Math.max(0, MAX_ATTACHMENTS - brandPackageAssets.length),
    );
    const seen = new Set(boundedCreativeAssets.map((asset) => asset.assetId ?? asset.id));
    return [
      ...boundedCreativeAssets,
      ...brandPackageAssets.filter((asset) => !seen.has(asset.assetId ?? asset.id)),
    ];
  }, [brandPackageAssets, productAssets]);
  /// 重做单帧时可改选的参考图：只给创作台里的产品图（故事板的商家实拍就是这几张）。
  const storyboardReferenceOptions = useMemo<StoryboardReferenceOption[]>(
    () => productAssets.map((asset) => ({
      assetId: asset.assetId ?? asset.id,
      url: asset.url,
      label: asset.fileName,
    })),
    [productAssets],
  );

  /// 商家自己写的口播稿跟描述一起存进 sessionStorage，刷新后随故事板一起恢复
  useEffect(() => {
    saveVoiceoverDraft(sessionStorage, rawPrompt, voiceoverScript.trim() ? voiceoverScript : null);
  }, [rawPrompt, voiceoverScript]);

  const invalidatePlan = useCallback(() => {
    interactedRef.current = true;
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

  /// 字幕设置不改画面，派发那一刻才取值：故事板出来之后照样能改。
  /// 自己写的口播稿是给 AI 排镜头用的：故事板出来之前改它，下一次生成就按新稿子来。
  const updateAudioCaptionSettings = useCallback((next: AudioCaptionControlValue) => {
    interactedRef.current = true;
    setAudioCaptionSettings(next);
    setError(null);
  }, []);

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
      MAX_ATTACHMENTS - productAssets.length,
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

  function removeProductAsset(assetId: string) {
    if (busy !== null || storyboard) return;
    setProductAssets((current) => current.filter((asset) => asset.id !== assetId));
    invalidatePlan();
  }

  function buildRequest(): OwnedUnifiedVideoGenerationRequest {
    /// 台词由 AI 导演写进镜头脚本，服务端出片时按脚本定口播与字幕；这里只带商家自己写的那份（有才带）
    const script = voiceoverScript.trim();
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
          enabled: script.length > 0,
          voiceId: "warm-confident",
          /// P04-B：口播 / 字幕语言看稿子本身（含汉字 → zh-CN），不再拿界面 locale 代替
          language: detectScriptLanguage(script, locale),
          script,
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
      /// 没勾就不带这个键：请求与方案缓存键和之前一模一样
      ...(signoffEnabled && signoffBrand.trim()
        ? {
            signoff: {
              enabled: true,
              brandName: signoffBrand.trim(),
              cta: signoffCta.trim() || null,
              ...(signoffLogo && signoffLogoUrl ? { logo: true } : {}),
            },
          }
        : {}),
      /// 没勾就不带这个键
      ...(cornerLogo && signoffLogoUrl ? { cornerLogo: true } : {}),
    });
  }

  function validateBeforeRequest(): string | null {
    if (!rawPrompt.trim()) return copy.promptRequired;
    if (signoffEnabled && !signoffBrand.trim()) return copy.signoffRequired;
    return null;
  }

  function cancelStoryboardCreate() {
    cancelStoryboardCreateRef.current = true;
    setCancellingStoryboardCreate(true);
  }

  async function handleCreateStoryboard() {
    const validationError = validateBeforeRequest();
    if (validationError) {
      setError(validationError);
      return;
    }
    const request = buildRequest();
    setError(null);
    setBusy("storyboard");
    cancelStoryboardCreateRef.current = false;
    setCancellingStoryboardCreate(false);
    try {
      const storyboardBody = {
        prompt: request.rawPrompt,
        durationSec: request.selectedDuration,
        aspectRatio: request.selectedAspectRatio,
        sourceAssetIds: productAssets.map((asset) => asset.assetId ?? asset.id),
        approvalPolicy: "MANUAL" as const,
        purpose: "single-video-storyboard",
        /// 模板决定走不走导演线路、片种定不定成快销（服务端按同一条规则判断）
        styleTemplateId: request.styleTemplateId ?? null,
        ...(machineTaskId ? { machineTaskId } : {}),
      };
      const fingerprint = JSON.stringify(storyboardBody);
      if (storyboardAttemptRef.current?.fingerprint !== fingerprint) {
        storyboardAttemptRef.current = { fingerprint, key: crypto.randomUUID() };
      }
      persistStoredAttempt(STORYBOARD_ATTEMPT_STORAGE_KEY, storyboardAttemptRef.current);
      /// 商家自己写的口播稿交给 AI 照着排镜头；不算进提交指纹：改了稿子再点，照旧回放同一份故事板，不重出一张付费帧
      const narration = voiceoverScript.trim();
      const response = await fetch("/api/video-generation/storyboards", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": storyboardAttemptRef.current.key,
        },
        body: JSON.stringify(narration ? { ...storyboardBody, voiceoverScript: narration } : storyboardBody),
      });
      const payload = await response.json().catch(() => null) as
        | { ok: true; run: StoryboardRunView }
        | { ok: false; error?: string }
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload && "error" in payload ? payload.error : copy.storyboardFailed);
      }
      if (cancelStoryboardCreateRef.current) {
        /// 提交期间点了取消：这一轮刚建好就让服务端停掉。没取消成就把它亮出来，下面的「取消这一轮」还在。
        if (await cancelStoryboardOnServer(payload.run)) {
          markStoryboardRunDismissed(payload.run.id);
          invalidatePlan();
          toast.success(copy.planningCancelled);
          return;
        }
      }
      setStoryboard(payload.run);
      requestAnimationFrame(() => {
        document.getElementById("single-video-storyboard")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    } catch (reason) {
      /// 取消后提交自己失败了：没有东西要取消，也不用再报一次错
      if (cancelStoryboardCreateRef.current) toast.success(copy.planningCancelled);
      else setError(reason instanceof Error ? reason.message : copy.storyboardFailed);
    } finally {
      cancelStoryboardCreateRef.current = false;
      setCancellingStoryboardCreate(false);
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

  /// 「修改创作方向」：有故事板时先在站内确认框里问一句（原来是浏览器原生确认框），没有就直接回到描述。
  function requestEditStoryboardDirection() {
    if (cancellingRound) return;
    if (storyboard) setEditConfirmOpen(true);
    else void editStoryboardDirection();
  }

  async function editStoryboardDirection() {
    if (cancellingRound) return;
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
      const dispatchBody = {
        request,
        storyboardRunId: storyboard.id,
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
    && directorBlocker === null
    && busy === null
    && uploadingTarget === null
    && !draftingPrompt;
  const configurationLocked = Boolean(storyboard);
  const locked = busy !== null || configurationLocked;
  /// 不改画面的设置（口播稿、声音、字幕、配乐、片尾落款、出片线路）派发那一刻才取值：
  /// 故事板出来之后照样能改，不用为了改一句口播丢掉整套故事板重来。只在提交途中锁住。
  const finishingLocked = busy !== null;
  /// 有故事板（含刷新后恢复的）就只按故事板走，不再要求本页先有方案（1028 闭环轮 E2E #6）。
  const canGenerate = Boolean(
    canReview && storyboard?.status === "APPROVED",
  );
  const needsStoryboard = !storyboard;
  const storyboardGenerating = storyboard?.status === "GENERATING";
  const storyboardNeedsApproval = storyboard?.status === "AWAITING_APPROVAL";
  const primaryIsBusy = busy === "dispatch" || busy === "storyboard";
  /// 委托进度沿用首用提示的五步（guideSteps）：一页只有一套步骤，当前一步只有一个。
  /// 关键帧还在画时停在「生成 AI 故事板」，画完才进「确认每一帧」（不在 0/4 时标已完成）。
  const stageIndex = busy === "dispatch" || storyboard?.status === "APPROVED"
    ? 4
    : storyboard
      ? (storyboardGenerating ? 2 : 3)
      : rawPrompt.trim()
          ? 1
          : 0;
  /// 光只给正在发生的事：故事板逐帧生成或正在提交时，当前一步才带扫描光。
  const stageWorking = storyboardGenerating || busy === "storyboard" || busy === "dispatch";
  const ratioLabel = aspectRatioLabel(selectedAspectRatio, copy);
  const creatingStoryboardLabel = cancellingStoryboardCreate ? copy.cancellingStoryboardCreate : copy.creatingStoryboard;
  const activeHookAngle = detectHookAngle(rawPrompt);
  const productSize = detectProductSize(rawPrompt);
  /// 正在出故事板（AI 写镜头脚本 → 出开场画面）时为 0；没在出 → null
  const storyboardStage = busy !== "storyboard" ? null : 0;
  const storyboardStages = copy.directorStages;
  /// 空白状态（没写描述、没传图、没带回任何东西）才摆「接着拍这些商品」，开始写了就让开
  const showRecentSources =
    recentSources.length > 0 && !storyboard && busy === null && !rawPrompt.trim() && productAssets.length === 0;
  const primaryLabel = busy === "dispatch"
    ? copy.generating
    : busy === "storyboard"
      ? creatingStoryboardLabel
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
  /// 本月额度已经用完：提交前就把真实下一步摆出来，不让人做完方案和故事板才在派发时撞墙（审计 A7）。
  const quotaExhausted = Boolean(readings && readings.quotaLimit > 0 && readings.quotaUsed >= readings.quotaLimit);
  const showingQuotaError = quotaError !== null && error === quotaError;
  /// 商家的成本是「成片条数」（本月额度，失败与取消返还），不是供应商积分：
  /// 之前这里给同行线路写死「900 积分/支」——供应商价目早已换成 700 分与按秒计费，客户也从没买过积分。
  const statusHint = readings
    ? copy.quotaHint
        .replace("{used}", String(readings.quotaUsed))
        .replace("{limit}", String(readings.quotaLimit))
    : copy.readyHint;
  const attachDisabled = busy !== null || configurationLocked || uploadingTarget !== null || draftingPrompt;
  const productSlotsFull = productAssets.length >= MAX_PRODUCT_IMAGES;

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

  /// 拖到整张提示卡上也能传：只收商品实拍图
  function dropFiles(files: File[]) {
    const images = files.filter((file) => isSupportedImage(file));
    if (images.length === 0) {
      if (files.length > 0) toast.error(copy.unsupportedFile);
      return;
    }
    if (!productSlotsFull) void uploadProductImages(images);
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
    /// 风格卡（director-line-policy 的 DIRECTOR_STYLES）：「自动匹配」由 AI 导演按商品定拍法，其余每种是一套拍法要求
    ...DIRECTOR_STYLES.map((style) => ({ value: style.id, label: english ? style.en : style.zh })),
  ];
  /// 写作能力暂停时，在卡下明说镜头怎么规划（C4 · 诚实说明）
  const capabilityDegraded = shotsFromTemplate;
  /// 配音配乐随片子出，摘要里只写字幕、角标和落款
  const moreSummary = `${copy.summaryDirectorAudio} · ${copy.summaryCaptions} ${captionsEnabled ? copy.on : copy.off}${cornerLogo && signoffLogoUrl ? ` · ${copy.summaryCornerLogo}` : ""}${signoffEnabled ? ` · ${copy.summarySignoff} ${copy.on}` : ""}`;

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
      {/* 提交故事板还要十几秒到一分钟：这段也给出口（点了之后等提交返回再真取消） */}
      {busy === "storyboard" && !cancellingStoryboardCreate ? (
        <Button type="button" variant="ghost" size="sm" onClick={cancelStoryboardCreate} data-testid="cancel-storyboard-create">
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

  /// 导演线路的第 3、4 步说的是「AI 写镜头脚本」「确认画面和脚本」，不是逐帧出故事板
  const workflowSteps = copy.guideSteps.map((step, index) => (index === 2 ? copy.directorStepScript : index === 3 ? copy.directorStepApprove : step));
  /// 五步流程（与首用提示同一个来源）：一页只有一套步骤，当前一步只有一个
  const workflowRail = (
    <ol
      aria-label={copy.workflowTitle}
      className="flex flex-wrap items-center justify-center gap-1"
      data-testid="creation-workflow-rail"
    >
      {workflowSteps.map((step, index) => {
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

        {machineTaskId ? (
          <p className="text-center text-meta text-muted-foreground" data-testid="machine-task-confirmation">
            {english
              ? "This request is saved but filming has not started. Confirm the storyboard, then generate the video."
              : "任务已保存，还没有开拍。请先确认故事板，再生成视频。"}
          </p>
        ) : null}

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

        {/* 一个按钮背后三段等待：写明现在在哪一段（做完的打勾、正在做的加粗、还没到的变淡） */}
        {storyboardStage !== null ? (
          <ol
            aria-label={copy.stagesLabel}
            aria-live="polite"
            data-testid="storyboard-stages"
            data-stage={storyboardStage}
            className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-meta"
          >
            {storyboardStages.map((stage, index) => (
              <li
                key={stage}
                aria-current={index === storyboardStage ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5",
                  index < storyboardStage ? "text-success" : index === storyboardStage ? "font-medium text-foreground" : "text-tertiary",
                )}
              >
                {index > 0 ? <span aria-hidden className="mr-0.5 text-tertiary">→</span> : null}
                {index < storyboardStage ? <Check className="size-3.5" aria-hidden /> : index === storyboardStage ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                {stage}
              </li>
            ))}
          </ol>
        ) : null}
        {storyboardStage !== null ? (
          <p className="text-center text-meta text-muted-foreground" data-testid="director-stage-hint">{copy.directorStagesHint}</p>
        ) : null}
        {/* 上一轮没走完的故事板：表单已经有内容、或那一轮早就失败了，就不自动带回来，只在这里问一句（2026-11-17） */}
        {resumeOffer && !storyboard ? (
          <div
            role="status"
            data-testid="storyboard-resume-offer"
            className="x-well flex flex-wrap items-center gap-x-4 gap-y-2 rounded-(--radius-md) px-3 py-2.5 text-meta"
          >
            <p className="min-w-0 flex-1 basis-56 text-muted-foreground">
              <span className="text-foreground">
                {resumeOffer.run.status === "GENERATING"
                  ? copy.resumeOfferGenerating
                  : resumeOffer.run.status === "AWAITING_APPROVAL"
                    ? copy.resumeOfferAwaiting
                    : resumeOffer.run.status === "APPROVED"
                      ? copy.resumeOfferApproved
                      : copy.resumeOfferFailed}
              </span>{" "}
              {copy.resumeOfferHint}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null || uploadingTarget !== null}
                onClick={() => applyResume(resumeOffer)}
              >
                {copy.resumeOfferApply}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  markStoryboardRunDismissed(resumeOffer.run.id);
                  setResumeOffer(null);
                }}
              >
                {copy.resumeOfferDismiss}
              </Button>
            </div>
          </div>
        ) : null}
        {/* 写了描述却没传图：按钮点不了，在这里说清差哪一步 */}
        {directorBlocker === "no_product_photo" && rawPrompt.trim().length > 0 && !storyboard ? (
          <p role="status" className="text-center text-meta text-gold" data-testid="needs-product-photo">{copy.needsProductPhoto}</p>
        ) : null}
        {uploadError ? <p role="alert" className="text-meta text-danger">{uploadError}</p> : null}
        {loadedFromStudio.length > 0 ? (
          loadedProductName ? (
            /// 从商品档案带过来的：说清是哪件商品，并提示接下来只差「这次想怎么拍」
            <p role="status" className="text-meta text-success" data-testid="prefill-assets-notice">
              {english
                ? `Loaded ${loadedFromStudio.length} photo${loadedFromStudio.length === 1 ? "" : "s"} of “${loadedProductName}”. Now add how you want to shoot it this time.`
                : `已载入「${loadedProductName}」的 ${loadedFromStudio.length} 张商品图。接着写这次想怎么拍。`}
            </p>
          ) : retryOfOrderId || machineTaskId ? (
            /// 「重新生成 / 用同样的素材再做一条」带过来的是那条视频的商品图；不列 product-image-1 这样的占位文件名。
            <p role="status" className="text-meta text-success" data-testid="prefill-assets-notice">
              {english
                ? `Loaded ${loadedFromStudio.length} product photo${loadedFromStudio.length === 1 ? "" : "s"} from that video. Keep them, or add and remove as you like.`
                : `已载入那条视频的 ${loadedFromStudio.length} 张商品图，可以直接用，也可以增删。`}
            </p>
          ) : (
            /// 兜底（带了预填的商品图、却没有上面两种来源的名字）：只说载入了几张
            <p role="status" className="text-meta text-success" data-testid="prefill-assets-notice">
              {english
                ? `Loaded ${loadedFromStudio.length} product photo${loadedFromStudio.length === 1 ? "" : "s"}. Keep them, or add and remove as you like.`
                : `已载入 ${loadedFromStudio.length} 张商品图，可以直接用，也可以增删。`}
            </p>
          )
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
              setSelectedDuration(Number(value) as 15 | 30);
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
            hint={selectedStyle ? (english ? selectedStyle.hintEn : selectedStyle.hintZh) : quickModeHint}
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

        {/* 试试这些：一点就把描述填好（模板化的说法） */}
        {!storyboard ? (
          <div className="space-y-3">
            {/* 换个开头：描述写好之后才出现；点一下在描述末尾补一句「开头怎么拍」，再点一次取消。
                同一件商品换个开场再拍一条（成品库「用同样的素材再做一条」带过来的正是这个场景）。 */}
            {stripHookAngle(rawPrompt).length >= 8 ? (
              <div
                role="group"
                aria-label={copy.hookAngles}
                data-testid="hook-angles"
                className="flex flex-wrap items-center justify-center gap-1.5"
              >
                <span className="mr-1 text-meta text-tertiary">{copy.hookAngles}</span>
                {HOOK_ANGLES.map((angle) => {
                  const active = activeHookAngle === angle.id;
                  return (
                    <button
                      key={angle.id}
                      type="button"
                      aria-pressed={active}
                      className={cn(CHIP_CLASS, active && "border-(--accent-line) text-foreground")}
                      disabled={locked || draftingPrompt}
                      onClick={() => {
                        setRawPrompt(applyHookAngle(rawPrompt, active ? null : angle.id, english ? "en" : "zh"));
                        invalidatePlan();
                      }}
                    >
                      {angle[english ? "en" : "zh"].label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {/* 商品尺寸：描述写好之后才出现；填了就在描述最后补一行「商品实际大小：…」，清空就去掉 */}
            {stripProductSize(stripHookAngle(rawPrompt)).length >= 8 ? (
              <div className="flex flex-wrap items-center justify-center gap-1.5" data-testid="product-size">
                <label htmlFor="streamlined-product-size" className="mr-1 text-meta text-tertiary" title={copy.productSizeHint}>
                  {copy.productSize}
                </label>
                <input
                  id="streamlined-product-size"
                  type="text"
                  value={productSize ?? ""}
                  maxLength={PRODUCT_SIZE_MAX}
                  disabled={locked || draftingPrompt}
                  placeholder={copy.productSizePlaceholder}
                  title={copy.productSizeHint}
                  className="h-9 w-full max-w-xs rounded-(--radius-lg) border border-border bg-raised px-3 text-meta text-foreground outline-none placeholder:text-tertiary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
                  onChange={(event) => {
                    setRawPrompt(applyProductSize(rawPrompt, event.target.value, english ? "en" : "zh"));
                    invalidatePlan();
                  }}
                />
              </div>
            ) : null}
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
            </div>
          </div>
        ) : null}

        {/* 接着拍这些商品：回来的商家多半是给同一件商品再拍一条——点一下带回那一单的商品图和描述（走「再做一条」同一条路） */}
        {showRecentSources ? (
          <section aria-label={copy.recentTitle} data-testid="recent-sources" className="space-y-2">
            <p className="text-center text-meta text-tertiary">
              <span className="font-medium text-muted-foreground">{copy.recentTitle}</span>
              <span className="ml-2">{copy.recentHint}</span>
              <Link
                href="/app/products"
                prefetch={false}
                className="ml-2 rounded-(--radius-sm) text-muted-foreground underline underline-offset-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {copy.recentManage}
              </Link>
            </p>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {recentSources.map((source) => (
                <li key={source.id} className="min-w-0">
                  <Link
                    href={source.href}
                    className="flex min-w-0 items-center gap-3 rounded-(--radius-lg) border border-border bg-surface p-2 transition-colors duration-fast ease-out hover:border-border-strong hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={source.thumbnailUrl} alt="" loading="lazy" className="size-12 shrink-0 rounded-(--radius-md) bg-(--brand-tile) object-cover" />
                    <span className="min-w-0">
                      <span className="block truncate text-meta font-medium text-foreground">{source.title}</span>
                      <span className="block text-data tabular-nums text-tertiary">
                        {copy.recentImages.replace("{count}", String(source.imageCount))}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* 更多设置：收起时也保持挂载（线路可用性检查照常跑），只是不显示 */}
        <div
          id="streamlined-more-settings"
          hidden={!moreOpen}
          className="@container divide-y divide-border rounded-(--radius-card) border border-border bg-surface"
          data-testid="streamlined-more-settings"
        >
          <TicketRow label={copy.route}>
            <CustomerRoutePicker
              disabled={finishingLocked}
              active={moreOpen}
              english={english}
            />
          </TicketRow>
          {/* 口播 / 字幕 / 配乐：默认开口播与逐词字幕，口播稿 AI 先写、人来改 */}
          <TicketRow label={copy.rowAudio}>
            <p className="text-meta text-muted-foreground" data-testid="director-voice-hint">
              {copy.directorVoiceHint}
            </p>
            <AudioCaptionControls
              value={audioCaptionSettings}
              english={english}
              disabled={finishingLocked}
              durationSec={selectedDuration}
              onChange={updateAudioCaptionSettings}
            />
          </TicketRow>
          {/* 右上角 Logo（2026-11-17）：全程挂一个透明的图形角标，和导演线路的交付样式一样。每条单独勾、默认不带；
              用哪张图由服务端按账号取（自己工作区的默认品牌包），这里只是一个开关。 */}
          <TicketRow data-testid="streamlined-corner-logo" label={copy.rowCornerLogo} optional={copy.optional}>
            {signoffLogoUrl ? (
              <label className="flex cursor-pointer items-start justify-between gap-4 text-meta text-muted-foreground">
                <span className="flex min-w-0 items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={signoffLogoUrl} alt="" className="h-8 w-auto max-w-24 shrink-0 rounded-(--radius-sm) bg-(--brand-tile) object-contain p-1" />
                  <span className="min-w-0">
                    <span className="block text-body text-foreground">{copy.cornerLogoToggle}</span>
                    <span className="block">{copy.cornerLogoHint}</span>
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={cornerLogo}
                  disabled={finishingLocked}
                  className="mt-1 size-4 shrink-0 accent-primary"
                  onChange={(event) => setCornerLogo(event.target.checked)}
                />
              </label>
            ) : (
              <p className="text-meta text-muted-foreground">
                {copy.cornerLogoMissing}{" "}
                <Link href="/app/brands" className="text-accent underline-offset-4 hover:underline">
                  {english ? "Open Brand" : "去品牌页"}
                </Link>
              </p>
            )}
          </TicketRow>
          {/* 片尾落款（2026-11-10）：最后两秒在画面上压品牌名 + 行动指引；每条单独勾、默认不带。
              和下面已下线的尾卡不是一回事：不另加一帧，文字由合成直接烧上去。 */}
          <TicketRow data-testid="streamlined-signoff" label={copy.rowSignoff} optional={copy.optional}>
            <label className="flex cursor-pointer items-center justify-between gap-4 text-body text-foreground">
              {copy.signoffToggle}
              <input
                type="checkbox"
                checked={signoffEnabled}
                disabled={finishingLocked}
                className="size-4 accent-primary"
                onChange={(event) => setSignoffEnabled(event.target.checked)}
              />
            </label>
            <p className="text-meta text-muted-foreground">{copy.signoffHint}</p>
            {signoffEnabled ? (
              <div className="grid gap-3 @md:grid-cols-2">
                <label className="block text-meta font-medium text-muted-foreground">
                  {copy.signoffBrand}
                  <input
                    type="text"
                    value={signoffBrand}
                    maxLength={SIGNOFF_BRAND_MAX}
                    disabled={finishingLocked}
                    placeholder={copy.signoffBrandPlaceholder}
                    aria-invalid={!signoffBrand.trim()}
                    className={SIGNOFF_INPUT_CLASS}
                    onChange={(event) => setSignoffBrand(event.target.value)}
                  />
                </label>
                <label className="block text-meta font-medium text-muted-foreground">
                  {copy.signoffCta}
                  <input
                    type="text"
                    value={signoffCta}
                    maxLength={SIGNOFF_CTA_MAX}
                    disabled={finishingLocked}
                    placeholder={copy.signoffCtaPlaceholder}
                    className={SIGNOFF_INPUT_CLASS}
                    onChange={(event) => setSignoffCta(event.target.value)}
                  />
                </label>
                {signoffLogoUrl ? (
                  <label className="flex cursor-pointer items-start justify-between gap-4 text-meta text-muted-foreground @md:col-span-2" data-testid="streamlined-signoff-logo">
                    <span className="flex min-w-0 items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={signoffLogoUrl} alt="" className="h-8 w-auto max-w-24 shrink-0 rounded-(--radius-sm) bg-(--brand-tile) object-contain p-1" />
                      <span className="min-w-0">
                        <span className="block text-body text-foreground">{copy.signoffLogo}</span>
                        <span className="block">{copy.signoffLogoHint}</span>
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={signoffLogo}
                      disabled={finishingLocked}
                      className="mt-1 size-4 shrink-0 accent-primary"
                      onChange={(event) => setSignoffLogo(event.target.checked)}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
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
        </div>

        {capabilityDegraded ? (
          <p className="text-center text-meta text-gold" data-testid="create-capability-notice">{quickModeHint}</p>
        ) : null}
        {!storyboard ? (
          <p className="text-center text-meta text-tertiary">
            {statusHint}
          </p>
        ) : (
          <p className="text-center text-meta text-tertiary text-pretty" data-testid="finishing-editable-hint">
            {copy.finishingEditableHint}
          </p>
        )}
        {workflowRail}
      </section>

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
            onEditPlan={requestEditStoryboardDirection}
          />
          <ConfirmDialog
            open={editConfirmOpen}
            onOpenChange={setEditConfirmOpen}
            testId="edit-direction-confirm"
            tone="danger"
            busy={cancellingRound}
            title={copy.editStoryboardTitle}
            description={copy.editStoryboardBody}
            confirmLabel={copy.editStoryboardConfirm}
            cancelLabel={copy.editStoryboardStay}
            onConfirm={() => void editStoryboardDirection().finally(() => setEditConfirmOpen(false))}
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
          {/* 操作条浮在面板之上，用更亮一级的抬升色（bg-raised）。原来写的 bg-surface 当时在主题里没有定义，
              操作条其实是透明的，滚动时下面的镜头清单会透上来和它叠在一起（2026-11-17 线上实测） */}
          <div
            data-testid="storyboard-sticky-bar"
            className="sticky bottom-20 z-10 space-y-3 rounded-(--radius-card) border border-border-strong bg-raised p-3 shadow-(--shadow-card) md:bottom-10"
          >
            {statusNotices}
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-foreground">
                  {copy.stickySummary
                    .replace("{count}", String(productAssets.length))
                    .replace("{ratio}", ratioLabel)
                    .replace("{duration}", String(selectedDuration))}
                </p>
                <p className="mt-0.5 truncate text-meta text-muted-foreground">
                  {statusHint}
                </p>
              </div>
              {generateBar}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/// 卡下芯片与「试试这些」共用一套外观（学 Runway 模型芯片：约 38px 高、12px 圆角、二级面）
const SIGNOFF_INPUT_CLASS =
  "mt-2 h-(--control-height) w-full rounded-(--radius-md) x-well border-input px-3 text-body text-foreground outline-none placeholder:text-tertiary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50";

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

function isSupportedImage(file: File): boolean {
  return file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp";
}

function isQualityTemplateId(value: string | undefined): value is string {
  return directorStyle(value) !== null;
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
