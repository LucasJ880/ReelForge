/**
 * Aivora AI Video Workflow —— Demo Page mock data。
 *
 * 这是 /demo/real-footage-ads 主体验页用的 sample / mock 数据。
 * 字段命名尽量对齐 Phase 1/2/3 的概念（CreativeEvidenceCard / ScriptOutput /
 * StoryboardOutput / AssetQA / WizardRender），但这里不引入 Prisma 类型，
 * 也不强行通过 zod parse —— demo page 第一版直接渲染。
 *
 * 合规边界（必须遵守）：
 * - 所有指标都是 sample data，禁止把它们写得像“某品牌某月真实数据”；
 * - referenceUrl 只能是占位/外链，禁止保存第三方视频本地路径；
 * - 严禁出现 “remove watermark / clone exact video / copy script /
 *   scrape and download / rehost third-party video” 这类危险措辞；
 * - 任何 mock 视频 URL 都允许是 null（让 UI 自己降级），不能因为缺 mp4 崩溃。
 *
 * 由 CTO Brief（CEO 重做主 Demo Page）于 2026-05 编写，请勿手动改成真实
 * 客户案例叙事；如果要替换，必须替换为另一个真实有授权的客户。
 */

import { DEMO_SEED_VIDEO_THUMBNAIL, DEMO_SEED_VIDEO_URL } from "@/lib/data/demo-seed";

/** 统一的 sample 标签，组件里直接使用这个文案 */
export const SAMPLE_DATA_BADGE_LABEL = "示例数据";
export const SAMPLE_DATA_DISCLAIMER =
  "页面上的所有数据、脚本与分镜均为示例（sample data），不代表任何真实客户账号或在售房源。";

/** 默认选中的 card slug —— 与 storyboard / script demo 完全对齐 */
export const SELECTED_CARD_DEFAULT_SLUG =
  "real-estate-price-contrast-tour" as const;

/** Walkthrough 60s mp4 —— 已存在于 public/generated/。null 时 UI 走占位。 */
export const PRODUCT_WALKTHROUGH_VIDEO_URL =
  "/generated/aivora-real-footage-ads-walkthrough-60s-16x9.mp4";

/* ------------------------------------------------------------------ */
/* Customer Input Panel                                                */
/* ------------------------------------------------------------------ */

export interface DemoProjectInput {
  industry: "real_estate" | "pet_business" | "local_service";
  industryLabel: string;
  goal: string;
  goalLabel: string;
  city: string;
  platforms: ReadonlyArray<{ key: string; label: string }>;
  hasFootage: boolean;
  humanOnCamera: "agent" | "ai_avatar" | "voiceover_only";
  humanOnCameraLabel: string;
  videoLengthSec: 15 | 30 | 45 | 60;
  brandTone:
    | "professional"
    | "warm"
    | "luxury"
    | "playful"
    | "educational"
    | "direct_response";
  brandToneLabel: string;
  businessName: string;
  keyMessage: string;
}

export const demoProject: DemoProjectInput = {
  industry: "real_estate",
  industryLabel: "地产 · Real Estate",
  goal: "promote_listing",
  goalLabel: "推广 North York 公寓房源",
  city: "多伦多 · North York",
  platforms: [
    { key: "tiktok", label: "TikTok" },
    { key: "instagram_reels", label: "Instagram Reels" },
    { key: "youtube_shorts", label: "YouTube Shorts" },
  ],
  hasFootage: true,
  humanOnCamera: "agent",
  humanOnCameraLabel: "经纪人本人出镜（AI 数字人可选）",
  videoLengthSec: 30,
  brandTone: "warm",
  brandToneLabel: "温暖、有信任感",
  businessName: "示例地产 · North York",
  keyMessage: "这个预算在 North York 还能买到什么？",
};

/* ------------------------------------------------------------------ */
/* Creative Evidence Cards                                             */
/* ------------------------------------------------------------------ */

export interface CreativeEvidenceCardDemo {
  slug: string;
  title: string;
  industry: DemoProjectInput["industry"];
  platform: "tiktok" | "instagram_reels" | "youtube_shorts" | "mixed";
  objective: "promote_listing" | "get_leads" | "increase_bookings";
  recommendationScore: number;
  hookPattern: {
    pattern: string;
    openingSeconds: number;
    hookType:
      | "POV"
      | "Curiosity"
      | "Stat"
      | "Reveal"
      | "Question"
      | "Authority"
      | "Demo";
    whyItStops: string;
  };
  publicMetrics: {
    observedAt: string;
    references: number;
    averageViews?: number;
    highestViews?: number;
    engagementRate?: number;
  };
  whyItWorks: string;
  visualStyle: string;
  suggestedUseCase: string;
  shootingDifficulty: "Low" | "Medium" | "High";
  conversionPotential: "Low" | "Medium" | "High";
  trustFactor: "Low" | "Medium" | "High";
  clientPreviewSummary: string;
  riskNotes?: string;
  tags: string[];
}

export const creativeEvidenceCards: ReadonlyArray<CreativeEvidenceCardDemo> = [
  {
    slug: "real-estate-comment-reply-listing",
    title: "评论回复式房源推荐",
    industry: "real_estate",
    platform: "tiktok",
    objective: "promote_listing",
    recommendationScore: 91,
    hookPattern: {
      pattern: "“评论区有人问 X，今天直接给你看一套”",
      openingSeconds: 3,
      hookType: "Question",
      whyItStops:
        "把评论问题前置当 hook，让带着同样问题的潜在买家停下滑动并代入。",
    },
    publicMetrics: {
      observedAt: "示例 · 2026 Q1",
      references: 18,
      averageViews: 312_000,
      engagementRate: 5.4,
    },
    whyItWorks:
      "评论区当成需求池，让“你问我答”代替广告腔，原生感最高、信任度也最高。",
    visualStyle: "竖屏 9:16，自然光，经纪人口播 + 房源 B-roll",
    suggestedUseCase:
      "已挂牌 7-30 天的房源；在原帖评论区或新内容中回应购房问题。",
    shootingDifficulty: "Low",
    conversionPotential: "High",
    trustFactor: "High",
    clientPreviewSummary:
      "经纪人针对真实评论问题（如“这个预算还能买什么”）给出实地走房答案。",
    riskNotes:
      "地产行业需附 Fair Housing 与挂牌 disclaimer，不要承诺投资回报。",
    tags: ["口播开场", "评论钩子", "走房 tour"],
  },
  {
    slug: "real-estate-price-contrast-tour",
    title: "价格反差型房源展示",
    industry: "real_estate",
    platform: "tiktok",
    objective: "promote_listing",
    recommendationScore: 87,
    hookPattern: {
      pattern: "“这个预算在 North York 还能买到什么？”",
      openingSeconds: 3,
      hookType: "Curiosity",
      whyItStops:
        "把买家最在意的“预算 vs 实物”落差直接挑明，自然激发继续看完的好奇心。",
    },
    publicMetrics: {
      observedAt: "示例 · 2026 Q1",
      references: 24,
      highestViews: 1_100_000,
      engagementRate: 6.1,
    },
    whyItWorks:
      "价格 + 城市的对比 hook 是首次购房者最容易转发的格式，转发即新流量入口。",
    visualStyle: "竖屏 9:16，门口锚定 + 客厅推进 + 厨房横移 + 主卧/社区收尾",
    suggestedUseCase:
      "首套房友好的中端公寓；预算定位明确（如 60-90 万 CAD）。",
    shootingDifficulty: "Low",
    conversionPotential: "High",
    trustFactor: "High",
    clientPreviewSummary:
      "把房源走一圈，重点放在“同价位在这个城市能拿到什么”。本次默认方向。",
    riskNotes:
      "价格不能误导，建议用挂牌价区间表达；附必要 disclaimer。",
    tags: ["价格反差", "首套房", "城市钩子"],
  },
  {
    slug: "real-estate-agent-voice-broll",
    title: "经纪人口播 + 房源 B-roll",
    industry: "real_estate",
    platform: "instagram_reels",
    objective: "get_leads",
    recommendationScore: 84,
    hookPattern: {
      pattern: "“在我做经纪人这 X 年里，这是我最常被问到的一种户型”",
      openingSeconds: 3,
      hookType: "Authority",
      whyItStops:
        "经纪人用第一人称专业建议口播，AI 痕迹最低，对个人 IP 友好。",
    },
    publicMetrics: {
      observedAt: "示例 · 2026 Q1",
      references: 12,
      averageViews: 184_000,
      engagementRate: 4.8,
    },
    whyItWorks:
      "口播 + 房源 B-roll 是个人 IP 经纪人最稳定的获客格式，转化路径短。",
    visualStyle: "口播开场 + 房源 4-6 段 B-roll 拼接，强调真人质感",
    suggestedUseCase:
      "经纪人个人账号长期经营 / 房源广告投放素材。",
    shootingDifficulty: "Medium",
    conversionPotential: "High",
    trustFactor: "High",
    clientPreviewSummary:
      "适合已经有个人账号的经纪人，把口播专业建议 + 房源镜头组合为获客视频。",
    riskNotes: "需要经纪人本人或经授权的 AI 头像；声音克隆必须显式同意。",
    tags: ["真人口播", "经纪人 IP", "B-roll"],
  },
] as const;

export type CreativeEvidenceCardSlug =
  (typeof creativeEvidenceCards)[number]["slug"];

/* ------------------------------------------------------------------ */
/* Reference Video Previews                                            */
/* ------------------------------------------------------------------ */

export interface ReferencePreviewDemo {
  cardSlug: CreativeEvidenceCardSlug;
  platform: "TikTok" | "Instagram Reels" | "YouTube Shorts";
  /// 仅外链占位，禁止保存任何第三方视频本地文件路径
  externalUrl: string | null;
  /// 是否禁用「View original」按钮（true = 不可点击，仅作占位）
  externalUrlDisabled: boolean;
  thumbnailPlaceholderLabel: string;
  caption: string;
  metrics: {
    observedAt: string;
    views?: number;
    likes?: number;
    shares?: number;
    engagementRate?: number;
  };
  takeaways: string[];
}

export const referencePreviews: ReadonlyArray<ReferencePreviewDemo> = [
  {
    cardSlug: "real-estate-price-contrast-tour",
    platform: "TikTok",
    externalUrl: null,
    externalUrlDisabled: true,
    thumbnailPlaceholderLabel: "TikTok · 价格反差走房",
    caption:
      "示例参考：「这个预算在多伦多还能买到什么」类内容的结构 + 节奏参考。",
    metrics: {
      observedAt: "示例 · 2026 Q1",
      views: 1_100_000,
      likes: 84_300,
      shares: 6_200,
      engagementRate: 8.6,
    },
    takeaways: [
      "前 3 秒用预算 + 城市直接挑明 hook",
      "镜头按外观 → 客厅 → 厨房 → 卧室节奏推进",
      "结尾用 CTA 引导评论 / 私信",
    ],
  },
  {
    cardSlug: "real-estate-comment-reply-listing",
    platform: "TikTok",
    externalUrl: null,
    externalUrlDisabled: true,
    thumbnailPlaceholderLabel: "TikTok · 评论回复式走房",
    caption:
      "示例参考：评论区追问后，经纪人直接走一套房源回应。",
    metrics: {
      observedAt: "示例 · 2026 Q1",
      views: 312_000,
      likes: 21_800,
      shares: 1_410,
      engagementRate: 5.4,
    },
    takeaways: [
      "把评论问题截图当 hook",
      "口播 + B-roll 节奏交替",
      "结尾邀请新评论形成下一条素材",
    ],
  },
  {
    cardSlug: "real-estate-agent-voice-broll",
    platform: "Instagram Reels",
    externalUrl: null,
    externalUrlDisabled: true,
    thumbnailPlaceholderLabel: "Reels · 经纪人口播",
    caption:
      "示例参考：经纪人口播 + 4 段房源 B-roll 拼接，IP 风格强烈。",
    metrics: {
      observedAt: "示例 · 2026 Q1",
      views: 184_000,
      likes: 9_700,
      shares: 612,
      engagementRate: 4.8,
    },
    takeaways: [
      "第一句话先建立行业权威",
      "B-roll 配合口播节奏切换",
      "CTA 引导私信或保存",
    ],
  },
] as const;

/**
 * Reference 区域永远展示的合规说明（与 ComplianceNote 重复展示，强调一次）。
 * 中文版同时保留英文兜底，方便海外合作方与法务复核。
 */
export const REFERENCE_COMPLIANCE_TEXT =
  "我们只参考公开内容的结构与表现信号，不会下载、自托管、去水印或复制任何第三方视频。";
export const REFERENCE_COMPLIANCE_TEXT_EN =
  "We reference structure and performance signals only. We do not copy or rehost third-party videos.";

/* ------------------------------------------------------------------ */
/* AI Script                                                           */
/* ------------------------------------------------------------------ */

export interface ScriptCaptionDemo {
  sceneIndex: number;
  text: string;
  startSec?: number;
  endSec?: number;
}

export interface GeneratedScriptDemo {
  forCardSlug: CreativeEvidenceCardSlug;
  language: "zh-CN" | "en-CA" | "en-US";
  title: string;
  hook: string;
  voiceover: string;
  captions: ReadonlyArray<ScriptCaptionDemo>;
  cta: string;
  platformNotes: ReadonlyArray<{ platform: string; note: string }>;
  complianceNotes: ReadonlyArray<string>;
  copiedFromReference: false;
}

export const generatedScript: GeneratedScriptDemo = {
  forCardSlug: "real-estate-price-contrast-tour",
  language: "zh-CN",
  title: "这个预算在 North York 还能买到什么？",
  hook:
    "很多人以为现在 North York 买房至少要 150 万，其实这个预算还有选择。",
  voiceover:
    "很多人以为现在 North York 买房至少要 150 万，其实这个预算还有选择。今天我带你实地看一套，门口先看小区位置，进门看采光和户型，再到厨房和主卧细节，最后讲讲社区生活。如果你也在看这个价位的房子，留言告诉我你最在意什么，我下一条直接接着拍。",
  captions: [
    {
      sceneIndex: 1,
      text: "North York 这个预算还有选择？",
      startSec: 0,
      endSec: 4,
    },
    { sceneIndex: 2, text: "先看一眼楼盘外观", startSec: 4, endSec: 8 },
    { sceneIndex: 3, text: "客厅采光直接决定居住感", startSec: 8, endSec: 13 },
    {
      sceneIndex: 4,
      text: "厨房 = 日常生活密度",
      startSec: 13,
      endSec: 17,
    },
    {
      sceneIndex: 5,
      text: "主卧 + 社区是真正的“住起来”",
      startSec: 17,
      endSec: 23,
    },
    { sceneIndex: 6, text: "私信我，发你完整清单", startSec: 23, endSec: 30 },
  ],
  cta: "想看这个价位还能买到哪些房源，私信我发你清单。",
  platformNotes: [
    {
      platform: "TikTok",
      note: "用本地化口语；前 3 秒强 hook；caption 短句。",
    },
    {
      platform: "Instagram Reels",
      note: "可加配色一致的 caption 卡；保留品牌色与小 logo。",
    },
    {
      platform: "YouTube Shorts",
      note: "结尾给出更长 CTA + 频道名露出，便于关注转化。",
    },
  ],
  complianceNotes: [
    "Real estate 行业必须遵守当地 Fair Housing 与 disclosure 规则，禁止价格误导。",
    "脚本为客户原创版本，未复制任何 reference video 的字幕、配音或镜头脚本。",
    "若使用 AI 头像或克隆声音，需经纪人本人显式签署同意书。",
  ],
  copiedFromReference: false,
};

/* ------------------------------------------------------------------ */
/* Storyboard / Shooting Guide                                         */
/* ------------------------------------------------------------------ */

export interface StoryboardShotDemo {
  sceneIndex: number;
  durationSec: number;
  shotType:
    | "talking_head"
    | "establishing"
    | "wide"
    | "medium"
    | "close_up"
    | "detail"
    | "b_roll";
  shotTypeLabel: string;
  whatToFilm: string;
  cameraInstruction: string;
  composition: string;
  cameraMovement: string;
  orientation: "portrait" | "landscape" | "square";
  requiredFlag: boolean;
  humanRequired: boolean;
  requiredProps: ReadonlyArray<string>;
  captionText?: string;
  voiceoverSegment?: string;
  shootingRequirements: ReadonlyArray<string>;
  commonMistakes: ReadonlyArray<string>;
  visualPlaceholder: {
    /// Tailwind gradient class（用作 storyboard 卡的占位色）
    gradient: string;
    accentLabel: string;
    iconKey:
      | "agent"
      | "exterior"
      | "living"
      | "kitchen"
      | "bedroom"
      | "cta";
  };
}

export const storyboardShots: ReadonlyArray<StoryboardShotDemo> = [
  {
    sceneIndex: 1,
    durationSec: 4,
    shotType: "talking_head",
    shotTypeLabel: "经纪人开场 · 真人口播",
    whatToFilm:
      "经纪人站在房源大门外，半身入镜，背景能看到楼盘标识或大堂。",
    cameraInstruction:
      "竖屏手持，胸口高度，距离 1.2-1.5 米；自然光 + 反光板补脸；镜头静止。",
    composition: "centered",
    cameraMovement: "static",
    orientation: "portrait",
    requiredFlag: true,
    humanRequired: true,
    requiredProps: ["经纪人本人或授权 AI avatar", "房源 lobby 背景"],
    captionText: "North York 这个预算还有选择？",
    voiceoverSegment:
      "很多人以为现在 North York 买房至少要 150 万，其实这个预算还有选择。",
    shootingRequirements: [
      "面部清晰、嘴型可读",
      "背景能识别房源所在楼盘",
      "环境噪音低于一般街道车流",
    ],
    commonMistakes: ["逆光导致脸部黑掉", "经纪人离镜头过远", "背景里有路人脸需打码"],
    visualPlaceholder: {
      gradient: "from-emerald-400/30 via-emerald-500/15 to-transparent",
      accentLabel: "镜头 01 · 经纪人开场",
      iconKey: "agent",
    },
  },
  {
    sceneIndex: 2,
    durationSec: 4,
    shotType: "establishing",
    shotTypeLabel: "楼盘外观 · 建立镜头",
    whatToFilm:
      "房源建筑外观或入口大堂，竖屏稳定拍摄。",
    cameraInstruction:
      "竖屏 + 三脚架或稳定器；保持镜头水平；不要扫太快。",
    composition: "rule_of_thirds",
    cameraMovement: "static",
    orientation: "portrait",
    requiredFlag: true,
    humanRequired: false,
    requiredProps: ["楼盘外观", "门口 / 大堂入口"],
    captionText: "先看一眼楼盘外观",
    voiceoverSegment: "今天我带你实地看一套",
    shootingRequirements: [
      "光线明亮（建议中午或下午）",
      "避免逆光或晃动",
      "镜头 framing 显示楼盘体量",
    ],
    commonMistakes: ["镜头扫太快", "晃得像 vlog", "构图偏低只拍到地面"],
    visualPlaceholder: {
      gradient: "from-sky-400/30 via-sky-500/15 to-transparent",
      accentLabel: "镜头 02 · 楼盘外观",
      iconKey: "exterior",
    },
  },
  {
    sceneIndex: 3,
    durationSec: 5,
    shotType: "wide",
    shotTypeLabel: "客厅推进",
    whatToFilm:
      "客厅推进，竖屏慢慢往前走，展示采光和空间感。",
    cameraInstruction:
      "竖屏镜头匀速推进；保持手机垂直；步速放慢；从门口走向窗边。",
    composition: "leading_lines",
    cameraMovement: "push_in",
    orientation: "portrait",
    requiredFlag: true,
    humanRequired: false,
    requiredProps: ["客厅", "窗户 / 自然光"],
    captionText: "客厅采光直接决定居住感",
    voiceoverSegment: "进门看采光和户型",
    shootingRequirements: [
      "采光明显，能看到自然光照进客厅",
      "无杂物或租客遗留物",
      "窗外画面不出现敏感隐私",
    ],
    commonMistakes: [
      "推得太快导致画面模糊",
      "拿横屏出现黑边",
      "曝光忽明忽暗",
    ],
    visualPlaceholder: {
      gradient: "from-indigo-400/30 via-indigo-500/15 to-transparent",
      accentLabel: "镜头 03 · 客厅",
      iconKey: "living",
    },
  },
  {
    sceneIndex: 4,
    durationSec: 4,
    shotType: "detail",
    shotTypeLabel: "厨房横移",
    whatToFilm:
      "厨房横移，展示台面、炉灶、采光。",
    cameraInstruction:
      "竖屏 + 慢速横移；保持距离一致；避免反光。",
    composition: "rule_of_thirds",
    cameraMovement: "pan",
    orientation: "portrait",
    requiredFlag: true,
    humanRequired: false,
    requiredProps: ["厨房台面", "炉灶 / 抽油烟机", "自然光或厨房灯"],
    captionText: "厨房 = 日常生活密度",
    voiceoverSegment: "再到厨房和主卧细节",
    shootingRequirements: [
      "台面清空、整洁可读",
      "镜头距离 0.6-0.8 米",
      "横移速度匀速、不要扫到反光严重的不锈钢",
    ],
    commonMistakes: [
      "横移太快导致画面模糊",
      "炉具不干净直接成画面焦点",
      "镜头反射到拍摄人本身",
    ],
    visualPlaceholder: {
      gradient: "from-amber-400/30 via-amber-500/15 to-transparent",
      accentLabel: "镜头 04 · 厨房",
      iconKey: "kitchen",
    },
  },
  {
    sceneIndex: 5,
    durationSec: 6,
    shotType: "medium",
    shotTypeLabel: "主卧 + 社区氛围",
    whatToFilm:
      "主卧 + 社区生活感（窗外视野、附近便利设施）。",
    cameraInstruction:
      "主卧静态镜头 3s + 窗外或社区 B-roll 3s；保持竖屏。",
    composition: "frame_within_frame",
    cameraMovement: "static",
    orientation: "portrait",
    requiredFlag: true,
    humanRequired: false,
    requiredProps: ["主卧整洁画面", "窗外视野或附近便利设施 B-roll"],
    captionText: "主卧 + 社区是真正的“住起来”",
    voiceoverSegment: "最后讲讲社区生活",
    shootingRequirements: [
      "床铺整理、无个人物品",
      "窗外景观尽量包含社区/绿化/便利设施",
      "B-roll 与主卧镜头节奏一致",
    ],
    commonMistakes: [
      "拍到床上私人物品",
      "B-roll 抖动严重",
      "窗外暴露车牌或他人脸",
    ],
    visualPlaceholder: {
      gradient: "from-rose-400/30 via-rose-500/15 to-transparent",
      accentLabel: "镜头 05 · 主卧 + 社区",
      iconKey: "bedroom",
    },
  },
  {
    sceneIndex: 6,
    durationSec: 5,
    shotType: "talking_head",
    shotTypeLabel: "经纪人收尾 · CTA 口播",
    whatToFilm:
      "经纪人或数字人出镜口播 CTA；可在房源客厅或户外阳台。",
    cameraInstruction:
      "竖屏静态；上半身入镜；眼神看镜头；语速放慢。",
    composition: "centered",
    cameraMovement: "static",
    orientation: "portrait",
    requiredFlag: true,
    humanRequired: true,
    requiredProps: ["经纪人本人或授权 AI 数字人"],
    captionText: "私信我，发你完整清单",
    voiceoverSegment:
      "想看这个价位还能买到哪些房源，私信我发你清单。",
    shootingRequirements: [
      "面部清晰",
      "环境光稳定，不要忽明忽暗",
      "声音清晰，不抢背景音",
    ],
    commonMistakes: [
      "嘴型与口播不同步",
      "结尾过快导致 CTA 被裁",
      "数字人表情僵硬",
    ],
    visualPlaceholder: {
      gradient: "from-violet-400/30 via-violet-500/15 to-transparent",
      accentLabel: "镜头 06 · 经纪人收尾",
      iconKey: "cta",
    },
  },
] as const;

/* ------------------------------------------------------------------ */
/* Asset QA Mock                                                       */
/* ------------------------------------------------------------------ */

export interface AssetQAResultDemo {
  assetName: string;
  assetType:
    | "exterior"
    | "living_room"
    | "kitchen"
    | "bedroom"
    | "agent_cta"
    | "cover_candidate";
  matchedSceneIndex: number | null;
  status: "USABLE" | "BARELY_USABLE" | "RETAKE_RECOMMENDED" | "MISSING";
  statusLabel: string;
  scores: {
    /// 0-100，越高越好
    clarity: number;
    /// 0-100，越高越好
    lighting: number;
    /// 0-100，越高越稳（与 schema 中 shake severity 反向以便 UI 展示更直观）
    stability: number;
  };
  orientation: "portrait" | "landscape" | "square" | "unknown";
  reasons: ReadonlyArray<string>;
  retakeSuggestion?: string;
  isCoverCandidate?: boolean;
}

export const assetQAResults: ReadonlyArray<AssetQAResultDemo> = [
  {
    assetName: "exterior_clip_001.mp4",
    assetType: "exterior",
    matchedSceneIndex: 2,
    status: "USABLE",
    statusLabel: "可用 · 候选封面",
    scores: { clarity: 88, lighting: 84, stability: 90 },
    orientation: "portrait",
    reasons: ["对焦清晰", "光线明亮", "竖屏方向匹配"],
    isCoverCandidate: true,
  },
  {
    assetName: "living_room_walkthrough_002.mp4",
    assetType: "living_room",
    matchedSceneIndex: 3,
    status: "USABLE",
    statusLabel: "可用",
    scores: { clarity: 82, lighting: 86, stability: 78 },
    orientation: "portrait",
    reasons: [
      "采光好，能看到自然光",
      "推进节奏稳定",
      "构图未出现私人物品",
    ],
  },
  {
    assetName: "kitchen_pan_003.mp4",
    assetType: "kitchen",
    matchedSceneIndex: 4,
    status: "RETAKE_RECOMMENDED",
    statusLabel: "建议重拍",
    scores: { clarity: 64, lighting: 72, stability: 48 },
    orientation: "portrait",
    reasons: ["相机横移过快", "出现轻微画面模糊"],
    retakeSuggestion:
      "重拍：横移速度放慢一倍，建议从台面左侧匀速横移到炉灶右侧，全程 4 秒。",
  },
  {
    assetName: "bedroom_clip_004.mp4",
    assetType: "bedroom",
    matchedSceneIndex: 5,
    status: "BARELY_USABLE",
    statusLabel: "勉强可用",
    scores: { clarity: 70, lighting: 64, stability: 72 },
    orientation: "portrait",
    reasons: ["主卧光线略偏暗", "窗外画面构图可优化"],
    retakeSuggestion:
      "建议补一段窗外社区 B-roll，主卧静态镜头可保留作为前 3 秒。",
  },
  {
    assetName: "agent_cta.mp4",
    assetType: "agent_cta",
    matchedSceneIndex: 6,
    status: "MISSING",
    statusLabel: "缺失 · 必拍",
    scores: { clarity: 0, lighting: 0, stability: 0 },
    orientation: "unknown",
    reasons: ["客户尚未上传经纪人收尾镜头"],
    retakeSuggestion:
      "必须补拍：经纪人静态上半身 5 秒，台词为脚本结尾的 CTA 句。",
  },
] as const;

/* ------------------------------------------------------------------ */
/* Final Outputs                                                       */
/* ------------------------------------------------------------------ */

export interface FinalOutputDemo {
  variant:
    | "main_30s"
    | "ad_15s"
    | "cover"
    | "tiktok_caption"
    | "reels_caption"
    | "shorts_caption";
  title: string;
  description: string;
  durationSec?: number;
  aspectRatio: "9:16" | "1:1" | "16:9";
  videoUrl: string | null;
  posterUrl: string | null;
  notes: ReadonlyArray<string>;
  badge: string;
  isPlaceholder: boolean;
}

export const finalOutputs: ReadonlyArray<FinalOutputDemo> = [
  {
    variant: "main_30s",
    title: "30 秒主版本视频",
    description:
      "按选定方向的 6 个分镜串联生成的 30 秒主版本；竖屏 9:16，可直接用于 TikTok / Reels / Shorts 主帖。",
    durationSec: 30,
    aspectRatio: "9:16",
    videoUrl: null,
    posterUrl: null,
    notes: [
      "脚本 + 分镜 + 客户素材自动拼接",
      "首帧 = 经纪人开场 / Hook 字幕",
      "尾帧 = CTA 字幕 + 联系方式",
    ],
    badge: "示例预览",
    isPlaceholder: true,
  },
  {
    variant: "ad_15s",
    title: "15 秒广告版（投流剪辑）",
    description:
      "广告版本：删掉社区 B-roll，前置 hook 与房源关键卖点；竖屏 9:16，适合付费投流。",
    durationSec: 15,
    aspectRatio: "9:16",
    videoUrl: null,
    posterUrl: null,
    notes: [
      "保留镜头 01 / 03 / 04 / 06",
      "把 CTA 提前 2 秒",
      "字幕加大、字距加宽，便于无声播放",
    ],
    badge: "示例预览",
    isPlaceholder: true,
  },
  {
    variant: "cover",
    title: "封面图 · 竖屏 9:16",
    description:
      "封面图自动从可用的外观 / 客厅镜头中选取最稳一帧；支持手动替换。",
    aspectRatio: "9:16",
    videoUrl: null,
    posterUrl: null,
    notes: [
      "默认从镜头 02 选第 1.2 秒静帧",
      "标题文字使用脚本 hook 句",
      "支持手动指定其它候选封面",
    ],
    badge: "示例占位",
    isPlaceholder: true,
  },
  {
    variant: "tiktok_caption",
    title: "TikTok 文案 + 话题标签",
    description:
      "TikTok 主帖文案 + 话题标签提示，30 秒主版本配套发布建议。",
    aspectRatio: "9:16",
    videoUrl: null,
    posterUrl: null,
    notes: [
      "文案：这个预算在 North York 还能买到什么？评论区告诉我你最在意什么。",
      "话题：#NorthYork #多伦多买房 #公寓 #首套房",
      "建议发布时段：本地工作日 19:00-21:30",
    ],
    badge: "发布建议",
    isPlaceholder: true,
  },
  {
    variant: "reels_caption",
    title: "Instagram Reels 文案",
    description:
      "Reels 主帖文案 + 品牌色字幕卡建议；可挂经纪人个人账号。",
    aspectRatio: "9:16",
    videoUrl: null,
    posterUrl: null,
    notes: [
      "文案保留 hook 句 + 房源简介 + 私信 CTA",
      "建议添加地点标签提升本地曝光",
      "前 3 秒字幕卡用品牌色块强调",
    ],
    badge: "发布建议",
    isPlaceholder: true,
  },
  {
    variant: "shorts_caption",
    title: "YouTube Shorts 文案",
    description:
      "Shorts 文案 + 频道关注引导，便于做长期个人 IP 沉淀。",
    aspectRatio: "9:16",
    videoUrl: null,
    posterUrl: null,
    notes: [
      "标题：这个预算在 North York 还能买到什么？（North York Condo Tour）",
      "结尾 CTA 带频道名 + 关注引导",
      "描述区附挂牌信息 disclaimer 链接",
    ],
    badge: "发布建议",
    isPlaceholder: true,
  },
] as const;

/* ------------------------------------------------------------------ */
/* Pet Grooming Extension Sample                                       */
/* ------------------------------------------------------------------ */

export interface PetGroomingBeat {
  time: string;
  label: string;
  visual: string;
  caption?: string;
}

export interface PetGroomingSampleDemo {
  industryLabel: string;
  durationSec: number;
  aspectRatio: "9:16";
  beats: ReadonlyArray<PetGroomingBeat>;
  /// 复用 demo-seed 里宠物店真实样片（合规、自有、已存在）
  videoUrl: string | null;
  thumbnailUrl: string | null;
  cta: string;
  isPlaceholder: boolean;
}

export const petGroomingSample: PetGroomingSampleDemo = {
  industryLabel: "宠物美容 · 洗护前后",
  durationSec: 20,
  aspectRatio: "9:16",
  beats: [
    {
      time: "0-3s",
      label: "洗护前",
      visual: "宠物洗护前的真实毛发状态，竖屏静态特写。",
      caption: "今天的小客人是不是有点凌乱？",
    },
    {
      time: "3-12s",
      label: "洗护流程",
      visual: "洗澡 / 吹毛 / 修剪过程，3 段快剪。",
      caption: "店家手法专业、流程稳定。",
    },
    {
      time: "12-17s",
      label: "洗护后揭晓",
      visual: "洗护后反差对比，宠物精神状态明显改善。",
      caption: "前后对比就是最好的广告。",
    },
    {
      time: "17-20s",
      label: "预约 CTA",
      visual: "门店外观 + 联系方式 + 预约引导。",
      caption: "周末约我们，给毛孩子一次清爽。",
    },
  ],
  videoUrl: DEMO_SEED_VIDEO_URL || null,
  thumbnailUrl: DEMO_SEED_VIDEO_THUMBNAIL || null,
  cta: "宠物店 / 本地服务行业也能用同一套生产工作流。",
  isPlaceholder: false,
};

/* ------------------------------------------------------------------ */
/* Compliance / Forbidden wording                                      */
/* ------------------------------------------------------------------ */

/**
 * 合规边界文案，组件直接渲染。
 *
 * 注意：以「我们不…」的否定形式提到 forbidden 动作（如 rehost / watermark）
 * 是合规的，测试也允许这种否定句式。
 */
export const COMPLIANCE_NOTES: ReadonlyArray<string> = [
  "我们只参考公开视频的结构与表现信号，不会复制原视频内容。",
  "我们不会下载、自托管、去水印或拷贝任何第三方视频。",
  "脚本与分镜均为客户原创版本，绝不照搬参考视频的字幕、配音或镜头。",
  "客户必须对上传素材拥有版权或合法使用权。",
  "AI 数字人或声音克隆必须经出镜者本人显式书面同意。",
];

/**
 * 不允许出现在 demo data / UI 文案里的危险措辞。
 * 测试会用这个清单扫描所有 demo data 字符串。
 */
export const FORBIDDEN_DEMO_PHRASES: ReadonlyArray<string> = [
  "remove watermark",
  "clone exact video",
  "copy script",
  "scrape and download",
  "rehost third-party video",
];
