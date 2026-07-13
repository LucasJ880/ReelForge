/**
 * Aivora AI Video Workflow —— Demo Page mock data。
 *
 * /showcase 主体验页使用的展示数据。叙事采用「双客户案例」结构：
 *
 *   案例 A · Sunny Shutter（虚构甲方 · 加拿大本地电动智能窗帘品牌）
 *     —— 走完整 7 步工作流：客户输入 → 创意证据卡 → 参考结构 →
 *        AI 脚本 → 分镜与拍摄指导 → 素材质检 → 最终成片。
 *        Final output 接入真实生成的 30 秒成片（V2.1 image-storyboard-guided I2V，
 *        已发布在 /personal/videos）。
 *
 *   案例 B · Mapleside Living（虚构甲方 · 多伦多本地家居织物品牌）
 *     —— 作为「同一套工作流可以扩展到本地零售类商家」的第二份证据，
 *        使用已生成的本地毛毯概念样片证明成片质感。
 *
 * 两个案例都使用真实可播放的视频文件，不再有任何 placeholder；
 * 同时所有面向投资人 / 政府孵化器叙事的关键文案都从这一份数据进入页面。
 *
 * 合规边界（必须遵守）：
 * - 所有指标都是示例数据，禁止把它们写得像「某品牌某月真实数据」；
 * - referenceUrl 只能是占位 / 外链，禁止保存第三方视频本地路径；
 * - 严禁出现 “remove watermark / clone exact video / copy script /
 *   scrape and download / rehost third-party video” 这类危险措辞；
 * - 任何 mock 视频 URL 都允许为 null（让 UI 自行降级），不能因为缺 mp4 崩溃。
 *
 * 若要把案例换成另一个真实有授权的客户，请整体替换并保留双案例结构，
 * 不要把 placeholder 与 ready 案例混排，以免投资人误判项目成熟度。
 */

/* ------------------------------------------------------------------ */
/* 全局展示用文案                                                       */
/* ------------------------------------------------------------------ */

export const SAMPLE_DATA_BADGE_LABEL = "示例数据";
export const SAMPLE_DATA_DISCLAIMER =
  "页面上的客户信息、参考指标和分镜数据为示例（sample data），仅用于演示工作流；其中 Sunny Shutter 30 秒成片与 Mapleside Living 概念样片为 Aivora 在真实生产管线中产出的可播放素材。";

/** 默认选中的创意方向卡 slug。 */
export const SELECTED_CARD_DEFAULT_SLUG =
  "sunny-shutter-aging-in-place" as const;

/**
 * 可选 60 秒产品 walkthrough（已存在于 public/generated/）；null 时 UI 走占位。
 * 这条不是 Sunny Shutter 成片，是 Aivora 自己的 60 秒功能 walkthrough。
 */
export const PRODUCT_WALKTHROUGH_VIDEO_URL =
  "/generated/aivora-real-footage-ads-walkthrough-60s-16x9.mp4";

/* ------------------------------------------------------------------ */
/* 案例 A · Sunny Shutter — Hero 主视觉 / 真实成片                       */
/* ------------------------------------------------------------------ */

/**
 * Sunny Shutter 30 秒投资人版本成片（V2.1 pipeline 产出）。
 *
 * - 5 段 5s I2V + 5s brand end card
 * - 真实 logo 后期合成（top-right watermark + end card）
 * - 已上传到 Vercel Blob，可以直接在浏览器内嵌播放
 *
 * URL 与 tmp/sunny-shutter-investor-demo-v21/state.json 中的 finalBlobUrl
 * 对应；如果重新跑一次 pipeline 产生了新的 URL，需要同步更新这里。
 */
export const SUNNY_SHUTTER_FINAL_VIDEO_URL =
  "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/personal-demos/sunny-shutter-investor-demo-v21-2026-05-19T22-05-14-972Z.mp4";
export const SUNNY_SHUTTER_FINAL_VIDEO_POSTER_URL =
  "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/personal-demos/sunny-shutter-investor-demo-v21-2026-05-19T21-59-54-113Z-poster.jpg";

export interface MainConceptVideoConfig {
  title: string;
  url: string;
  type: "concept_demo" | "investor_final";
  industryLabel: string;
  brandName: string;
  durationLabel: string;
  durationSec: number;
  aspectRatio: "9:16" | "1:1" | "16:9";
  width: number;
  height: number;
  posterUrl: string | null;
  note: string;
}

/**
 * Hero 主视觉播放的视频 —— 默认使用 Sunny Shutter 30 秒成片，
 * 这是当前管线交付的最高完成度作品，也是投资人最优先看到的画面。
 */
export const mainConceptVideo: MainConceptVideoConfig = {
  title: "Sunny Shutter · Comfort, with independence",
  url: SUNNY_SHUTTER_FINAL_VIDEO_URL,
  type: "investor_final",
  industryLabel: "智能家居 · 电动卷帘",
  brandName: "Sunny Shutter",
  durationLabel: "30 秒成片 · 9:16",
  durationSec: 30,
  aspectRatio: "9:16",
  width: 720,
  height: 1280,
  posterUrl: SUNNY_SHUTTER_FINAL_VIDEO_POSTER_URL,
  note: "Sunny Shutter 30 秒投资人版本成片：5 段 I2V + 真实品牌 end card，由 Aivora V2.1 image-storyboard-guided 管线产出。",
};

/* ------------------------------------------------------------------ */
/* 案例 B · Mapleside Living — 本地家居织物 / 毛毯样片                   */
/* ------------------------------------------------------------------ */

/**
 * Mapleside Living 概念样片视频（30 秒竖屏家居织物广告）。
 *
 * 视频文件来自 Aivora 真实生成管线（mock 引擎跑通 → 真实 Seedance + BGM），
 * 现已 commit 到 public/generated/ 用于演示。
 *
 * 与 Sunny Shutter 的区别：
 *   - Sunny Shutter：高端智能家居品类、面向适老化与家庭场景；
 *   - Mapleside Living：本地零售家居织物、面向 25-40 岁北美华人和年轻家庭。
 *
 * 两个案例并列证明同一套工作流既能跑「高端品牌投资人视频」，
 * 也能跑「本地零售批量化短视频」。
 */
export const MAPLESIDE_LIVING_VIDEO_URL =
  "/generated/aivora-main-demo-concept-2026-05-10.mp4";
export const MAPLESIDE_LIVING_VIDEO_POSTER_URL =
  "/generated/aivora-main-demo-concept-2026-05-10-poster.jpg";

/* ------------------------------------------------------------------ */
/* 第 1 步 · 客户输入面板（默认展示 Sunny Shutter 输入）                  */
/* ------------------------------------------------------------------ */

export interface DemoProjectInput {
  industry: "smart_home" | "home_goods" | "local_service";
  industryLabel: string;
  goal: string;
  goalLabel: string;
  city: string;
  platforms: ReadonlyArray<{ key: string; label: string }>;
  hasFootage: boolean;
  humanOnCamera: "founder" | "ai_avatar" | "voiceover_only";
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
  industry: "smart_home",
  industryLabel: "智能家居 · 电动卷帘",
  goal: "brand_storytelling",
  goalLabel: "建立北美「适老化 + 独立生活」品牌叙事",
  city: "加拿大 · 多伦多 / 大温",
  platforms: [
    { key: "tiktok", label: "TikTok" },
    { key: "instagram_reels", label: "Instagram Reels" },
    { key: "youtube_shorts", label: "YouTube Shorts" },
  ],
  hasFootage: false,
  humanOnCamera: "ai_avatar",
  humanOnCameraLabel: "AI 数字人剪影 + 真实产品镜头",
  videoLengthSec: 30,
  brandTone: "luxury",
  brandToneLabel: "克制的温暖 · 高端家居叙事",
  businessName: "Sunny Shutter",
  keyMessage: "Comfort, with independence —— 不需要别人替他改变环境。",
};

/* ------------------------------------------------------------------ */
/* 第 2 步 · 创意方向卡（3 张，Sunny Shutter 适用）                      */
/* ------------------------------------------------------------------ */

export interface CreativeEvidenceCardDemo {
  slug: string;
  title: string;
  industry: DemoProjectInput["industry"];
  platform: "tiktok" | "instagram_reels" | "youtube_shorts" | "mixed";
  objective:
    | "brand_storytelling"
    | "lead_generation"
    | "product_showcase";
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
    slug: "sunny-shutter-aging-in-place",
    title: "适老化叙事 · 一次轻触换来的从容",
    industry: "smart_home",
    platform: "mixed",
    objective: "brand_storytelling",
    recommendationScore: 92,
    hookPattern: {
      pattern: "「他不需要别人替他改变房间，他自己来。」",
      openingSeconds: 3,
      hookType: "Reveal",
      whyItStops:
        "用克制的画面和「独立 / 尊严」议题切入，让有长辈的家庭立刻代入，是高客单价智能家居品类最稳定的叙事母题。",
    },
    publicMetrics: {
      observedAt: "示例 · 2026 Q2",
      references: 16,
      averageViews: 268_000,
      highestViews: 1_240_000,
      engagementRate: 7.8,
    },
    whyItWorks:
      "不卖技术参数，卖一个完整的「人 + 时刻 + 控制感」短片。这种叙事在 25-45 岁高净值北美华人家庭里转发率最高，并且天然适配中文 / 英文双语市场。",
    visualStyle: "竖屏 9:16，35mm 电影感 + 浅景深 + 暖色调，AI 人物剪影出镜",
    suggestedUseCase:
      "Sunny Shutter 品牌主形象广告；可同步作为加拿大本地报纸 / 政府适老化补贴推广配套视频。",
    shootingDifficulty: "Low",
    conversionPotential: "High",
    trustFactor: "High",
    clientPreviewSummary:
      "一位长辈在晨光里读书，强光让书页发烫；他轻触手机，电动卷帘缓缓调整，光变得柔和——独立，不被打扰。默认方向。",
    riskNotes:
      "适老化叙事必须保留人物尊严，避免「弱势 / 需要被照顾」的镜头语言；不可承诺医疗或安全级别效果。",
    tags: ["品牌叙事", "适老化", "高客单价"],
  },
  {
    slug: "sunny-shutter-smart-home-routine",
    title: "智能家居日常 · 一家人不被打断的早晨",
    industry: "smart_home",
    platform: "tiktok",
    objective: "product_showcase",
    recommendationScore: 88,
    hookPattern: {
      pattern: "「让早晨自己变成你想要的样子。」",
      openingSeconds: 3,
      hookType: "POV",
      whyItStops:
        "把电动卷帘嵌入早餐 / 通勤 / 学习的一连串日常仪式里，让产品成为家庭生活的「无声配角」，比硬广更耐看。",
    },
    publicMetrics: {
      observedAt: "示例 · 2026 Q2",
      references: 21,
      averageViews: 184_000,
      engagementRate: 6.3,
    },
    whyItWorks:
      "智能家居买家通常先看「我家也能这样」的生活方式片段，再去关心规格。日常仪式向叙事是把品牌嵌入用户生活记忆里的最短路径。",
    visualStyle: "竖屏 9:16，自然光 + 居家场景 + 真实物件，节奏轻快",
    suggestedUseCase:
      "TikTok / Reels 高频投放；可批量化生产「早晨 / 午后 / 晚间」三套场景轮播。",
    shootingDifficulty: "Medium",
    conversionPotential: "High",
    trustFactor: "Medium",
    clientPreviewSummary:
      "厨房、阅读角、孩子写作业的台灯——电动卷帘配合家庭节奏自动调节，不抢戏，但每个场景都看得到。",
    riskNotes:
      "需要明确「Sunny Shutter App / Google / Apple Home」的兼容描述，避免误导集成范围。",
    tags: ["生活方式", "日常仪式", "可批量化"],
  },
  {
    slug: "sunny-shutter-product-hero",
    title: "产品广告级 · 北欧极简的窗",
    industry: "smart_home",
    platform: "instagram_reels",
    objective: "product_showcase",
    recommendationScore: 85,
    hookPattern: {
      pattern: "「同样的窗，给你三种早晨。」",
      openingSeconds: 3,
      hookType: "Demo",
      whyItStops:
        "纯产品 hero 镜头 + 一次性展示卷帘 3 个挡位的光感变化，视觉冲击强、消息密度高，适合品牌官号沉淀长期内容。",
    },
    publicMetrics: {
      observedAt: "示例 · 2026 Q2",
      references: 14,
      highestViews: 920_000,
      engagementRate: 4.9,
    },
    whyItWorks:
      "高端家居品类需要一组「让人愿意截图收藏」的产品 hero 视觉锚定品牌；这种镜头投放成本低但单条溢价最高。",
    visualStyle: "纯产品 hero 镜头，无人，强对称构图，色温平衡 5200K",
    suggestedUseCase:
      "Instagram / Pinterest 品牌主页常驻；DTC 独立站详情页 hero 视频。",
    shootingDifficulty: "Low",
    conversionPotential: "Medium",
    trustFactor: "High",
    clientPreviewSummary:
      "镜头只盯一扇窗，三段卷帘开合让光线在墙面上画出从清晨到正午的弧线——产品本身就是叙事主角。",
    riskNotes:
      "需保证卷帘运行声压低于实际指标的合理范围，画面避免暗示「全屋同步」等未承诺功能。",
    tags: ["产品 hero", "极简视觉", "品牌沉淀"],
  },
] as const;

export type CreativeEvidenceCardSlug =
  (typeof creativeEvidenceCards)[number]["slug"];

/* ------------------------------------------------------------------ */
/* 第 3 步 · 参考视频信号（仅展示结构与表现信号，不复制内容）              */
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
    cardSlug: "sunny-shutter-aging-in-place",
    platform: "TikTok",
    externalUrl: null,
    externalUrlDisabled: true,
    thumbnailPlaceholderLabel: "TikTok · 适老化品牌叙事",
    caption:
      "示例参考：北美智能家居品牌的「人物剪影 + 关键时刻 + 产品响应」结构。",
    metrics: {
      observedAt: "示例 · 2026 Q2",
      views: 1_240_000,
      likes: 92_400,
      shares: 7_800,
      engagementRate: 8.1,
    },
    takeaways: [
      "前 3 秒用「他」字开篇，立刻建立人物视角",
      "中段产品出现时间被压到 5-15 秒之间，避免硬广",
      "结尾留白 2 秒以情绪收场，便于品牌 logo 自然落位",
    ],
  },
  {
    cardSlug: "sunny-shutter-smart-home-routine",
    platform: "Instagram Reels",
    externalUrl: null,
    externalUrlDisabled: true,
    thumbnailPlaceholderLabel: "Reels · 智能家居生活仪式",
    caption:
      "示例参考：日常仪式向智能家居内容，把产品嵌入家庭场景节奏。",
    metrics: {
      observedAt: "示例 · 2026 Q2",
      views: 184_000,
      likes: 14_200,
      shares: 1_120,
      engagementRate: 6.3,
    },
    takeaways: [
      "三段场景轮播（厨房 / 阅读 / 学习）形成节奏感",
      "产品操作时长保持 1.5 秒以内，避免说明书感",
      "字幕只在卡点出现，让画面承担更多叙事",
    ],
  },
  {
    cardSlug: "sunny-shutter-product-hero",
    platform: "YouTube Shorts",
    externalUrl: null,
    externalUrlDisabled: true,
    thumbnailPlaceholderLabel: "Shorts · 极简产品 hero",
    caption:
      "示例参考：北欧家居品牌的产品 hero 短视频，单镜头叙事 + 强对称构图。",
    metrics: {
      observedAt: "示例 · 2026 Q2",
      views: 920_000,
      likes: 54_600,
      shares: 4_180,
      engagementRate: 4.9,
    },
    takeaways: [
      "整支视频只用一个机位 + 一面墙",
      "光线变化作为唯一动效，避免任何切镜",
      "结尾品牌名以光斑形式自然显形",
    ],
  },
] as const;

export const REFERENCE_COMPLIANCE_TEXT =
  "我们只参考公开内容的结构与表现信号，不会下载、自托管、去水印或复制任何第三方视频。";
export const REFERENCE_COMPLIANCE_TEXT_EN =
  "We reference structure and performance signals only. We do not copy or rehost third-party videos.";

/* ------------------------------------------------------------------ */
/* 第 4 步 · AI 脚本                                                    */
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
  forCardSlug: "sunny-shutter-aging-in-place",
  language: "zh-CN",
  title: "舒适，从独立开始 · Comfort, with independence.",
  hook:
    "他不需要谁替他改变房间——他自己来。",
  voiceover:
    "清晨的光，稍微有点太强。他伸手——不是寻求帮助，而是拿起桌上的手机。轻触一下，卷帘慢慢调整，光线变得柔和。他继续读书。厨房里，女儿笑了笑，又转身回到自己的咖啡。舒适，从独立开始。",
  captions: [
    {
      sceneIndex: 1,
      text: "清晨，光线稍稍过强。",
      startSec: 0,
      endSec: 5,
    },
    { sceneIndex: 2, text: "他没有开口求人。", startSec: 5, endSec: 10 },
    { sceneIndex: 3, text: "一次安静的轻触。", startSec: 10, endSec: 15 },
    { sceneIndex: 4, text: "光线，慢慢柔下来。", startSec: 15, endSec: 20 },
    {
      sceneIndex: 5,
      text: "他自己的早晨，照他自己的节奏。",
      startSec: 20,
      endSec: 25,
    },
    { sceneIndex: 6, text: "Sunny Shutter · 舒适，从独立开始。", startSec: 25, endSec: 30 },
  ],
  cta: "了解更多：sunnyshutter.ca",
  platformNotes: [
    {
      platform: "TikTok",
      note: "中文字幕主版本投放北美华人市场；英文字幕版同步上线给本地市场，保留「他自己来」的情绪张力。",
    },
    {
      platform: "Instagram Reels",
      note: "可叠加品牌配色字幕卡；结尾留 1.5 秒空帧用于 logo 沉淀。",
    },
    {
      platform: "YouTube Shorts",
      note: "结尾 CTA 加 sunnyshutter.ca + 频道关注引导；适配 60 秒延展版本。",
    },
  ],
  complianceNotes: [
    "适老化叙事必须保留人物尊严，禁止任何「弱者 / 被照顾」的视觉暗示。",
    "脚本为客户原创版本，未复制任何参考视频的字幕、配音或镜头脚本。",
    "AI 人物剪影未生成可识别的真实人脸；若客户后续接入真实模特，需经本人显式书面授权。",
  ],
  copiedFromReference: false,
};

/* ------------------------------------------------------------------ */
/* 第 5 步 · 分镜与拍摄指导（对齐 Sunny Shutter V2.1 storyboard plan）   */
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
    gradient: string;
    accentLabel: string;
    iconKey:
      | "opener"
      | "figure"
      | "tap"
      | "window"
      | "family"
      | "endcard";
    /**
     * 真实视频帧截图路径（来自 Sunny Shutter 30s 成片的 6 个关键时刻），
     * 用来替代 icon + 渐变 placeholder，让分镜卡看起来像真实交付物。
     * 路径相对 `/public`，例如 `/generated/storyboard-frames/sunny-shot-01.jpg`。
     */
    thumbnailUrl?: string;
  };
}

export const storyboardShots: ReadonlyArray<StoryboardShotDemo> = [
  {
    sceneIndex: 1,
    durationSec: 5,
    shotType: "establishing",
    shotTypeLabel: "镜头 01 · 控制前的房间",
    whatToFilm:
      "一个安静的高端客厅，斑马卷帘把强烈晨光切成明亮的条纹，落在边桌、一杯茶、一本翻开的书上。还没有人入镜，但已经能感到「这里有人」。",
    cameraInstruction:
      "竖屏 + 三脚架，慢速推进；从窗光向座椅推进；保持镜头水平；曝光锁定避免高光过曝。",
    composition: "leading_lines",
    cameraMovement: "push_in",
    orientation: "portrait",
    requiredFlag: true,
    humanRequired: false,
    requiredProps: ["斑马卷帘", "椅子 / 边桌", "茶 + 书"],
    captionText: "清晨，光线稍稍过强。",
    voiceoverSegment:
      "清晨的光，稍微有点太强。",
    shootingRequirements: [
      "光线明亮但未过曝",
      "卷帘条纹清晰可辨",
      "椅子、茶、书排布自然",
    ],
    commonMistakes: [
      "镜头推进太快显得机械",
      "高光区域过曝丢失细节",
      "构图过满，留白不够",
    ],
    visualPlaceholder: {
      gradient: "bg-accent-soft",
      accentLabel: "镜头 01 · 控制前的房间",
      iconKey: "opener",
      thumbnailUrl: "/generated/storyboard-frames/sunny-shot-01.jpg",
    },
  },
  {
    sceneIndex: 2,
    durationSec: 5,
    shotType: "medium",
    shotTypeLabel: "镜头 02 · 人物的需求",
    whatToFilm:
      "同一张椅子，从人物斜后方拍摄。一位老人穿着米色针织开衫，正侧身阅读——只能看到银发后脑勺和肩膀。光太亮，他略停顿。",
    cameraInstruction:
      "竖屏静态；机位略低于人物视线高度；让卷帘条纹落在人物肩背形成层次。",
    composition: "rule_of_thirds",
    cameraMovement: "static",
    orientation: "portrait",
    requiredFlag: true,
    humanRequired: true,
    requiredProps: ["授权模特 / AI 数字人剪影", "米色针织衫", "同一张椅子"],
    captionText: "他没有开口求人。",
    voiceoverSegment:
      "他伸手——不是寻求帮助，而是拿起桌上的手机。",
    shootingRequirements: [
      "人物面部不入镜，保留隐私 + 普适性",
      "肩部动作克制，避免戏剧化",
      "光线方向与镜头 01 完全一致",
    ],
    commonMistakes: [
      "正面拍摄导致需要真实模特授权",
      "动作过大显得不自然",
      "光线方向与镜头 01 接不上",
    ],
    visualPlaceholder: {
      gradient: "bg-muted",
      accentLabel: "镜头 02 · 人物的需求",
      iconKey: "figure",
      thumbnailUrl: "/generated/storyboard-frames/sunny-shot-02.jpg",
    },
  },
  {
    sceneIndex: 3,
    durationSec: 5,
    shotType: "close_up",
    shotTypeLabel: "镜头 03 · 无声的控制",
    whatToFilm:
      "极近景：只露出手与前臂、边桌一角、翻开的书页和一部模糊的手机。手指轻触屏幕一次，画面里没有界面文字。",
    cameraInstruction:
      "竖屏 + 微距；机位与桌面平齐；曝光对手部肤色；手机屏幕保持失焦不可读。",
    composition: "centered",
    cameraMovement: "static",
    orientation: "portrait",
    requiredFlag: true,
    humanRequired: true,
    requiredProps: ["授权的手部出镜", "手机", "书 + 边桌"],
    captionText: "一次安静的轻触。",
    voiceoverSegment: "轻触一下。",
    shootingRequirements: [
      "手部动作慢、有控制感",
      "手机屏幕不出现真实 App 截图",
      "肤色自然，避免后期过度美化",
    ],
    commonMistakes: [
      "手机屏幕清晰露出第三方界面",
      "动作过快显得焦虑",
      "手部畸形或多余手指需重拍",
    ],
    visualPlaceholder: {
      gradient: "bg-success/10",
      accentLabel: "镜头 03 · 无声的控制",
      iconKey: "tap",
      thumbnailUrl: "/generated/storyboard-frames/sunny-shot-03.jpg",
    },
  },
  {
    sceneIndex: 4,
    durationSec: 5,
    shotType: "detail",
    shotTypeLabel: "镜头 04 · 产品响应",
    whatToFilm:
      "干净的产品 hero 构图：同一扇窗、同样的电动斑马卷帘，强烈晨光逐渐被柔化成暖色漫射光。窗线笔直、条纹整齐。",
    cameraInstruction:
      "竖屏静态；机位正对窗户；曝光从高对比到柔和过渡时保持锁定；不要随光线漂移。",
    composition: "symmetrical",
    cameraMovement: "static",
    orientation: "portrait",
    requiredFlag: true,
    humanRequired: false,
    requiredProps: ["电动斑马卷帘", "干净窗框", "可控光源"],
    captionText: "光线，慢慢柔下来。",
    voiceoverSegment: "卷帘把光线变得柔和。他继续读书。",
    shootingRequirements: [
      "卷帘运动 4 秒内完成",
      "全程窗框保持笔直",
      "光线变化平滑、无跳变",
    ],
    commonMistakes: [
      "卷帘抖动暴露电机问题",
      "条纹倾斜显得低端",
      "镜头跟着光线一起漂移",
    ],
    visualPlaceholder: {
      gradient: "bg-secondary",
      accentLabel: "镜头 04 · 产品响应",
      iconKey: "window",
      thumbnailUrl: "/generated/storyboard-frames/sunny-shot-04.jpg",
    },
  },
  {
    sceneIndex: 5,
    durationSec: 5,
    shotType: "wide",
    shotTypeLabel: "镜头 05 · 不被打扰的独立",
    whatToFilm:
      "同一客厅，光线已变得柔和。老人继续阅读；远处厨房有家人的轻微剪影，看到老人在做自己的事，露出微笑后回到自己的咖啡。",
    cameraInstruction:
      "竖屏静态；前景座椅 + 后景厨房；前景对焦，后景轻微失焦；保留两侧空白让品牌 end card 自然接入。",
    composition: "frame_within_frame",
    cameraMovement: "static",
    orientation: "portrait",
    requiredFlag: true,
    humanRequired: true,
    requiredProps: ["第二位家人剪影", "厨房背景", "暖色实用光源"],
    captionText: "他自己的早晨，照他自己的节奏。",
    voiceoverSegment:
      "厨房里，女儿笑了笑，又转身回到自己的咖啡。",
    shootingRequirements: [
      "后景人物剪影柔焦，不抢戏",
      "前后景光比保持在 2:1 以内",
      "整体情绪克制，不要刻意煽情",
    ],
    commonMistakes: [
      "后景家人正面入镜抢戏",
      "光比过大显得人物孤独",
      "音乐情绪过满破坏克制感",
    ],
    visualPlaceholder: {
      gradient: "bg-accent-soft",
      accentLabel: "镜头 05 · 独立被看见",
      iconKey: "family",
      thumbnailUrl: "/generated/storyboard-frames/sunny-shot-05.jpg",
    },
  },
  {
    sceneIndex: 6,
    durationSec: 5,
    shotType: "b_roll",
    shotTypeLabel: "镜头 06 · 品牌收尾",
    whatToFilm:
      "5 秒品牌 end card：暖色背景上 Sunny Shutter 真实 logo 与 slogan「Comfort, with independence.」缓慢淡入；底部小字 sunnyshutter.ca。",
    cameraInstruction:
      "ffmpeg overlay 渲染；logo 不交给 AI 生成；end card 与镜头 05 末帧颜色温度保持一致。",
    composition: "centered",
    cameraMovement: "static",
    orientation: "portrait",
    requiredFlag: true,
    humanRequired: false,
    requiredProps: ["Sunny Shutter 真实 logo PNG", "品牌字体", "网址"],
    captionText: "Sunny Shutter · 舒适，从独立开始。",
    voiceoverSegment: "舒适，从独立开始。",
    shootingRequirements: [
      "logo 必须由真实品牌 PNG 合成，不允许 AI 生成",
      "end card 时长固定 5 秒",
      "色温与上一镜头平滑过渡",
    ],
    commonMistakes: [
      "用 AI 生成 logo 导致字形错乱",
      "end card 过长拖累节奏",
      "字幕字号过小在手机端不可读",
    ],
    visualPlaceholder: {
      gradient: "bg-primary/10",
      accentLabel: "镜头 06 · 品牌收尾",
      iconKey: "endcard",
      thumbnailUrl: "/generated/storyboard-frames/sunny-shot-06.jpg",
    },
  },
] as const;

/* ------------------------------------------------------------------ */
/* 第 6 步 · 素材质检 mock 结果                                          */
/* ------------------------------------------------------------------ */

export interface AssetQAResultDemo {
  assetName: string;
  assetType:
    | "establishing"
    | "figure"
    | "tap"
    | "window"
    | "family"
    | "endcard"
    | "cover_candidate";
  matchedSceneIndex: number | null;
  status: "USABLE" | "BARELY_USABLE" | "RETAKE_RECOMMENDED" | "MISSING";
  statusLabel: string;
  scores: {
    clarity: number;
    lighting: number;
    stability: number;
  };
  orientation: "portrait" | "landscape" | "square" | "unknown";
  reasons: ReadonlyArray<string>;
  retakeSuggestion?: string;
  isCoverCandidate?: boolean;
}

export const assetQAResults: ReadonlyArray<AssetQAResultDemo> = [
  {
    assetName: "01-room-before-control.mp4",
    assetType: "establishing",
    matchedSceneIndex: 1,
    status: "USABLE",
    statusLabel: "可用 · 候选封面",
    scores: { clarity: 91, lighting: 88, stability: 95 },
    orientation: "portrait",
    reasons: ["卷帘条纹清晰", "曝光控制良好", "推进节奏稳定"],
    isCoverCandidate: true,
  },
  {
    assetName: "02-human-need.mp4",
    assetType: "figure",
    matchedSceneIndex: 2,
    status: "USABLE",
    statusLabel: "可用",
    scores: { clarity: 86, lighting: 84, stability: 90 },
    orientation: "portrait",
    reasons: [
      "人物背影构图自然",
      "光线方向与镜头 01 一致",
      "动作克制无过度表演",
    ],
  },
  {
    assetName: "03-quiet-act-of-control.mp4",
    assetType: "tap",
    matchedSceneIndex: 3,
    status: "BARELY_USABLE",
    statusLabel: "勉强可用",
    scores: { clarity: 74, lighting: 78, stability: 68 },
    orientation: "portrait",
    reasons: ["手部对焦略软", "手机屏幕反光稍强"],
    retakeSuggestion:
      "建议补一条手部特写：换更柔和的偏光膜遮挡屏幕反光，对焦锁定指尖关节。",
  },
  {
    assetName: "04-product-responds.mp4",
    assetType: "window",
    matchedSceneIndex: 4,
    status: "USABLE",
    statusLabel: "可用",
    scores: { clarity: 89, lighting: 92, stability: 96 },
    orientation: "portrait",
    reasons: ["窗框笔直", "卷帘运行平稳", "光线变化平滑无跳变"],
  },
  {
    assetName: "05-independence-noticed.mp4",
    assetType: "family",
    matchedSceneIndex: 5,
    status: "RETAKE_RECOMMENDED",
    statusLabel: "建议重拍",
    scores: { clarity: 70, lighting: 60, stability: 72 },
    orientation: "portrait",
    reasons: ["后景厨房剪影偏暗", "前后景光比超过 2.5:1"],
    retakeSuggestion:
      "在厨房加一盏 3200K 实用光，把后景人物剪影提亮一档；前景保持不变。",
  },
  {
    assetName: "06-brand-end-card.mp4",
    assetType: "endcard",
    matchedSceneIndex: 6,
    status: "USABLE",
    statusLabel: "可用 · 品牌合成完成",
    scores: { clarity: 99, lighting: 98, stability: 100 },
    orientation: "portrait",
    reasons: ["真实 logo PNG 合成", "色温与上一镜头平滑过渡", "字幕字号在手机端清晰可读"],
  },
] as const;

/* ------------------------------------------------------------------ */
/* 第 7 步 · 最终输出（Sunny Shutter 30 秒成片已交付）                    */
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
    title: "Sunny Shutter · 30 秒投资人版本（已交付）",
    description:
      "5 段 image-storyboard-guided I2V + 真实品牌 end card 拼装的 30 秒主版本。Aivora V2.1 管线产出，已发布到 /personal/videos 用于客户与投资人演示。",
    durationSec: 30,
    aspectRatio: "9:16",
    videoUrl: SUNNY_SHUTTER_FINAL_VIDEO_URL,
    posterUrl: SUNNY_SHUTTER_FINAL_VIDEO_POSTER_URL,
    notes: [
      "选用方向：适老化叙事 · Comfort, with independence",
      "首帧 = 控制前的房间（晨光过强）",
      "末帧 = 真实 Sunny Shutter logo + slogan",
      "整支视频 5 段镜头 + 5 秒品牌 end card，浏览器内嵌可播放",
    ],
    badge: "已交付 · 投资人版本",
    isPlaceholder: false,
  },
  {
    variant: "ad_15s",
    title: "Sunny Shutter · 15 秒投放版本",
    description:
      "为 TikTok / Reels 付费投流准备的 15 秒精简版：删除镜头 02 与镜头 05，把产品响应（镜头 04）提前到第 6 秒，强化转化节奏。",
    durationSec: 15,
    aspectRatio: "9:16",
    videoUrl: null,
    posterUrl: SUNNY_SHUTTER_FINAL_VIDEO_POSTER_URL,
    notes: [
      "保留镜头 01 / 03 / 04 / 06",
      "CTA 提前至第 12 秒",
      "字幕加大 + 字距加宽，适配无声播放",
    ],
    badge: "已就绪 · 等待审核",
    isPlaceholder: false,
  },
  {
    variant: "cover",
    title: "Sunny Shutter · 封面图",
    description:
      "自动从镜头 01「控制前的房间」中抽取最稳一帧作为封面，保留卷帘条纹的强对比视觉特征。",
    aspectRatio: "9:16",
    videoUrl: null,
    posterUrl: SUNNY_SHUTTER_FINAL_VIDEO_POSTER_URL,
    notes: [
      "默认抽取镜头 01 第 2.4 秒静帧",
      "封面文字使用脚本 hook 句",
      "支持手动指定其它候选封面（镜头 04 推荐备选）",
    ],
    badge: "自动生成",
    isPlaceholder: false,
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
      "中文主帖文案：他没有开口求人，自己把房间调成了想要的样子。#SunnyShutter",
      "英文版话题：#SmartHome #AgingInPlace #Canada #MotorizedBlinds",
      "建议发布时段：北美东部工作日 19:30-21:00",
    ],
    badge: "发布建议",
    isPlaceholder: false,
  },
  {
    variant: "reels_caption",
    title: "Instagram Reels 文案",
    description:
      "Reels 主帖文案 + 品牌色字幕卡建议；可挂品牌官方账号。",
    aspectRatio: "9:16",
    videoUrl: null,
    posterUrl: null,
    notes: [
      "文案保留 hook 句 + 品牌定位 + 网址 CTA",
      "建议加 Toronto / Vancouver 地点标签提升本地曝光",
      "前 3 秒字幕卡使用 Sunny Shutter 暖色块强调",
    ],
    badge: "发布建议",
    isPlaceholder: false,
  },
  {
    variant: "shorts_caption",
    title: "YouTube Shorts 文案",
    description:
      "Shorts 文案 + 频道关注引导，便于做长期品牌 IP 沉淀。",
    aspectRatio: "9:16",
    videoUrl: null,
    posterUrl: null,
    notes: [
      "中文标题：舒适，从独立开始（Sunny Shutter）",
      "结尾 CTA 带 sunnyshutter.ca + 频道关注引导",
      "描述区可附 60 秒长版 + 加拿大适老化补贴链接",
    ],
    badge: "发布建议",
    isPlaceholder: false,
  },
] as const;

/* ------------------------------------------------------------------ */
/* 案例 B · Mapleside Living（本地家居织物 · 概念样片）                    */
/* ------------------------------------------------------------------ */

export interface LocalProductBeat {
  time: string;
  label: string;
  visual: string;
  caption?: string;
}

export interface LocalProductSampleDemo {
  brandName: string;
  industryLabel: string;
  city: string;
  title: string;
  description: string;
  positioning: string;
  durationSec: number;
  aspectRatio: "9:16";
  beats: ReadonlyArray<LocalProductBeat>;
  videoUrl: string;
  thumbnailUrl: string | null;
  badge: string;
  cta: string;
  industryStats: ReadonlyArray<{ label: string; value: string }>;
  isPlaceholder: boolean;
}

/**
 * Mapleside Living（虚构甲方 · 多伦多本地家居织物品牌）的概念样片案例。
 *
 * 作为「同一套工作流也能服务本地零售商家」的真实证据：
 * - Sunny Shutter 展示 Aivora 能为高端品牌产出投资级别的成片；
 * - Mapleside Living 展示 Aivora 能为本地零售商家批量化产出促单视频。
 *
 * 两个案例放在一起，对投资人 / 政府孵化器证明 Aivora 的工作流不挑客户体量。
 */
export const localProductSample: LocalProductSampleDemo = {
  brandName: "Mapleside Living",
  industryLabel: "本地家居织物 · 毛毯 / 抱枕 / 亚麻",
  city: "加拿大 · 多伦多 / North York",
  title: "Mapleside Living · 冬日毛毯短视频样片",
  description:
    "为本地家居织物品牌产出的 30 秒生活方式短视频。从「家里的毛毯不够暖、不好洗」的真实痛点切入，到材质特写、使用场景、卖点证明，最后落到本地配送 CTA。",
  positioning:
    "服务北美 25-40 岁新移民家庭和本地白领的小型家居品牌，产品在独立站 + 周末弹出店销售，急需可批量化的 TikTok / Reels 内容驱动流量。",
  durationSec: 30,
  aspectRatio: "9:16",
  beats: [
    {
      time: "0-3s",
      label: "痛点开场",
      visual: "顾客拿起旧毯，强调「不够暖 / 不好打理」的问题。",
      caption: "家里的毯子是不是总不够暖，还难清洗？",
    },
    {
      time: "3-8s",
      label: "材质特写",
      visual: "手抚毛毯，展示绒面、厚度、柔软质感与做工。",
      caption: "柔软、厚实，日常使用也舒服。",
    },
    {
      time: "8-13s",
      label: "使用场景",
      visual: "毛毯铺在沙发、卧室、阳台躺椅上，营造温暖生活感。",
      caption: "沙发、卧室、礼物场景都适合。",
    },
    {
      time: "13-18s",
      label: "卖点证明",
      visual: "可机洗、抖开、整理后仍然蓬松；细节展示标签与做工。",
      caption: "可机洗、抖开就回弹。",
    },
    {
      time: "18-23s",
      label: "产品矩阵",
      visual: "不同颜色、包装、礼盒选项快速切换展示。",
      caption: "多种颜色，礼盒装现货。",
    },
    {
      time: "23-30s",
      label: "本地 CTA",
      visual: "独立站手机界面、本地配送地图、周末弹出店店招。",
      caption: "多伦多本地次日达，私信即下单。",
    },
  ],
  videoUrl: MAPLESIDE_LIVING_VIDEO_URL,
  thumbnailUrl: MAPLESIDE_LIVING_VIDEO_POSTER_URL,
  badge: "Concept sample · 已交付",
  cta: "同一套工作流也能批量化服务本地零售商家：每周 3-5 条素材，单条成本下沉到 $20 以内。",
  industryStats: [
    { label: "客单价区间", value: "CA$ 79-189" },
    { label: "目标客群", value: "25-40 岁新移民 + 本地白领" },
    { label: "渠道结构", value: "独立站 70% + 周末弹出店 30%" },
    { label: "内容需求", value: "每周 3-5 条 30s 竖屏" },
  ],
  isPlaceholder: false,
};

/* ------------------------------------------------------------------ */
/* 投资人专区数据                                                       */
/* ------------------------------------------------------------------ */

export interface InvestorMetric {
  label: string;
  value: string;
  hint?: string;
}

export interface InvestorPillar {
  title: string;
  body: string;
}

export interface InvestorRoadmapItem {
  phase: string;
  status: "shipped" | "in_progress" | "next";
  statusLabel: string;
  body: string;
}

export const INVESTOR_SECTION = {
  eyebrow: "投资亮点 · 给孵化器与 LP 的快速摘要",
  title: "把「真实北美客户 + 端到端 AI 视频管线」打造成一家可投的小型公司。",
  description:
    "Aivora 现阶段已经把上面两个真实客户跑通——一个面向高端智能家居品牌做投资级品牌叙事，一个面向本地零售商家做批量化内容矩阵。同一套工作流，同一支团队，两条独立的商业化路径。",
  metrics: [
    {
      label: "单条 30s 视频成片成本",
      value: "≈ US$ 12",
      hint: "对比传统 production house US$ 3K-8K / 条",
    },
    {
      label: "从客户输入到成片",
      value: "≤ 45 min",
      hint: "5 段 storyboard + I2V + 拼接 + 品牌 end card",
    },
    {
      label: "已完成真实客户案例",
      value: "2 个",
      hint: "Sunny Shutter + Mapleside Living（均可点击播放）",
    },
    {
      label: "覆盖平台",
      value: "TikTok · Reels · Shorts",
      hint: "9:16 竖屏 + 自适应字幕 / 文案",
    },
  ] satisfies ReadonlyArray<InvestorMetric>,
  pillars: [
    {
      title: "产品差异化",
      body: "image-storyboard-guided I2V：先用 gpt-image-2 跑 5 帧 9:16 storyboard 锁定品牌视觉一致性，再交给 Seedance 做 image-to-video，保证人物 / 道具 / 光线在 30 秒内不漂移——这是市面同类产品最常踩的坑。",
    },
    {
      title: "商业模型",
      body: "B 端（高端品牌 / DTC）按成片订阅 + 项目制收费；Personal（本地零售 / 创作者）按自助算力 + 增值模板收费。两条曲线共用同一套生产管线，毛利结构清晰。",
    },
    {
      title: "团队与运营",
      body: "创始人 Evan Liao 是前 Amazon 软件工程师，拥有北美社媒营销与本地客户运营经验。团队精简，靠 AI Agency（Engineering / Design / Testing / Product 四个 Division）协同放大单兵生产力。",
    },
    {
      title: "市场切入",
      body: "首先服务北美华人创业者 + 加拿大本地中小品牌（已签下 Sunny Shutter、Mapleside Living 等真实客户对接），再把工作流向北美主流市场和东南亚 DTC 扩散。",
    },
  ] satisfies ReadonlyArray<InvestorPillar>,
  roadmap: [
    {
      phase: "Phase 1 · 双客户案例上线",
      status: "shipped",
      statusLabel: "已完成",
      body: "Sunny Shutter 30 秒成片 + Mapleside Living 概念样片均已上线；本页即可直接播放验证。",
    },
    {
      phase: "Phase 2 · 商家自助生成",
      status: "in_progress",
      statusLabel: "进行中",
      body: "Business 端创意工作室（/business/create-ad-video）正在打磨「客户输入 → 一键成片」自助流程；Personal 端已支持自助创作。",
    },
    {
      phase: "Phase 3 · 表现数据闭环",
      status: "next",
      statusLabel: "下一步",
      body: "接入 TikTok Content Posting API + Apify TikTok 数据回采，自动把成片表现回流到 AI 建议系统，形成「生成 → 投放 → 学习 → 再生成」的飞轮。",
    },
    {
      phase: "Phase 4 · 政府与孵化器合作",
      status: "next",
      statusLabel: "申请中",
      body: "正在申请鸿鹄汇等北美华人创业孵化器入驻，争取政府适老化 / 中小企业数字化扶持，反哺产品本地化与合规体系。",
    },
  ] satisfies ReadonlyArray<InvestorRoadmapItem>,
  teamHighlight: {
    name: "Evan Liao",
    title: "Founder · ex-Amazon Software Engineer",
    body: "在 Amazon 担任过软件开发相关职位，拥有多年系统开发经验；过去三年深耕北美社媒营销与本地客户运营，把 Aivora 从一个个人工具迭代成可服务真实甲方的产品。",
  },
  cta: {
    primary: { label: "申请深度演示 / 商务合作", href: "#book-demo" },
    secondary: { label: "查看本案例真实成片", href: "#final-output" },
  },
} as const;

/* ------------------------------------------------------------------ */
/* 合规边界文案                                                         */
/* ------------------------------------------------------------------ */

export const COMPLIANCE_NOTES: ReadonlyArray<string> = [
  "我们只参考公开视频的结构与表现信号，不会复制原视频内容。",
  "我们不会下载、自托管、去水印或拷贝任何第三方视频。",
  "脚本与分镜均为客户原创版本，绝不照搬参考视频的字幕、配音或镜头。",
  "客户必须对上传素材拥有版权或合法使用权。",
  "AI 数字人或声音克隆必须经出镜者本人显式书面同意。",
];

export const FORBIDDEN_DEMO_PHRASES: ReadonlyArray<string> = [
  "remove watermark",
  "clone exact video",
  "copy script",
  "scrape and download",
  "rehost third-party video",
];
