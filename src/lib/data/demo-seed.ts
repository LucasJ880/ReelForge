/**
 * Demo 种子数据：客户打开 /demo/ai-video 第一眼看到的真实样例。
 *
 * 由 scripts/build-pet-demo-no-text.ts 自动生成；不要手动改动。
 *
 * 生成时间：2026-04-28T21:04:23.431Z
 * 数据源：pet-store-real-assets + seedance（无字幕/无旁白版）
 * Seedance jobs: s1:cgt-20260429044816-9nhm4(seedance), s2:cgt-20260429045358-4slhf(seedance), s3:cgt-20260429045852-pv9qx(seedance)
 * BGM v2: real royalty-free music — "Wholesome" by Kevin MacLeod
 *   (incompetech.com, CC BY 4.0, ISRC USUAN1900022),
 *   trimmed 4–35s, fade in 0.4s / fade out 1.2s,
 *   ffmpeg loudnorm I=-16 LUFS / TP=-1.5 / LRA=11,
 *   muxed via stream copy (video unchanged) into *_bgm_v2.mp4.
 */
/**
 * Phase 5 — `demo-video-analysis-service` was deleted as part of the wizard/demo purge.
 * The seed data file is kept (it still feeds /showcase + a handful of marketing surfaces),
 * so we inline the types it relied on here. Treat these as frozen shapes.
 */
interface DemoVideoAnalysisInput {
  tiktokUrl: string;
  clientIndustry: string;
  clientOffer: string;
  targetAudience: string;
  tone: string;
}

interface DemoVideoAnalysisResult {
  source: string;
  reference: {
    url: string;
    author: string;
    caption: string;
    hashtags: string[];
    music: string;
    durationSec: number;
    metrics: {
      plays: number;
      likes: number;
      comments: number;
      shares: number;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export const DEMO_SEED_INPUT: DemoVideoAnalysisInput = {
  tiktokUrl: "https://example.com/pet-store-no-text-demo",
  clientIndustry: "宠物店 / 宠物生活馆",
  clientOffer: "门店日常服务、宠物护理、商品零售",
  targetAudience: "附近 3-5 公里养宠家庭与年轻白领用户",
  tone: "friendly",
};

export const DEMO_SEED_RESULT: DemoVideoAnalysisResult = {
  source: "llm-only",
  reference: {
    url: "https://example.com/pet-store-no-text-demo",
    author: "pet_store_demo",
    caption: "真实素材锚点 + Seedance 宠物店主镜头，纯画面 + 治愈背景音乐。",
    hashtags: ["宠物店", "Seedance", "AI视频", "宣传片"],
    music: "warm-acoustic",
    durationSec: 31,
    metrics: {
      plays: 184000,
      likes: 14600,
      comments: 812,
      shares: 2680,
      engagementRate: 9.83,
    },
    coverUrl: "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/demo-seed/pet_store_chinese_demo_30s_no_text.jpg",
  },
  intelligence: {
    viralFormula: "真实素材锚点 + Seedance 3 个主镜头 + 治愈BGM，让客户一眼看到 AI 出片质感。",
    hook: "前 4 秒先用真实门店画面建立可信度，再切入 AI 优化镜头制造质感惊喜。",
    retentionMechanics: [
      "真实素材开场降低距离感",
      "Seedance 3 段镜头：氛围 / 商品 / 宠物可爱",
      "无字幕无配音，靠画面节奏与BGM驱动",
      "结尾自然温暖，避免广告腔",
    ],
    visualPattern: [
      "真实门店锚点",
      "AI 生成温暖室内推进",
      "AI 商品广告级展示",
      "AI 宠物可爱 + 整体氛围收尾",
    ],
    audienceTriggers: [
      "宠物可爱瞬间带来情绪连接",
      "干净商品陈列建立专业信任",
      "温暖治愈背景音乐缓解广告感",
    ],
    commentSignals: [
      "看起来真实又有质感",
      "想去门店逛逛",
      "这种短视频很适合发本地号",
    ],
    riskNotes: [
      "AI 镜头避免畸形与文字幻觉",
      "BGM 控制在中低音量，避免盖过画面",
      "不出现旁白与字幕，保持纯视觉",
    ],
  },
  clientVersion: {
    positioning: "纯画面 + 治愈背景音乐，约 31 秒，适合直接发布到社媒主页。",
    title: "约 31 秒宠物店宣传片：真实锚点 + Seedance 3 段主镜头",
    digitalHumanScript: "",
    scenePlan: [
  {
    "time": "0-4s",
    "visual": "真实门店素材开场（c5）",
    "narration": "无字幕、无旁白，仅画面建立可信度",
    "overlay": "真实素材锚点"
  },
  {
    "time": "4-11s",
    "visual": "Seedance s1 · 门店氛围镜头（基于 c5）",
    "narration": "纯画面，无字幕、无配音",
    "overlay": "AI 生成宠物店镜头"
  },
  {
    "time": "11-21s",
    "visual": "Seedance s2 · 宠物用品广告镜头（基于 c4）",
    "narration": "纯画面，无字幕、无配音",
    "overlay": "AI 生成宠物店镜头"
  },
  {
    "time": "21-31s",
    "visual": "Seedance s3 · 宠物可爱瞬间 + 温暖收尾（基于 c1）",
    "narration": "纯画面，无字幕、无配音",
    "overlay": "AI 生成宠物店镜头"
  }
],
    captions: [],
    brollPrompts: [
  "Shot 1（门店氛围）：从真实推门进入宠物店后，自然过渡到温暖明亮的店内。货架整齐，宠物用品丰富，真实手机短视频拍摄质感，轻微商业广告感。镜头缓慢推进。竖屏 9:16，避免任何文字、招牌乱码、卡通风格、豪华商场感。",
  "Shot 2（商品广告）：宠物食品、零食、玩具、护理用品货架的高质量广告展示镜头。镜头缓慢扫过货架与商品细节，干净有层次，宠物店宣传片质感。竖屏 9:16，禁止文字、漂浮商品、奇怪 logo、畸形人手。",
  "Shot 3（宠物可爱瞬间 + 温暖收尾）：宠物在店内自然互动、回头、靠近玩具或货架，最后画面收在温暖明亮的宠物店整体氛围。竖屏 9:16，宠物动作真实自然，禁止拟人化、畸形、卡通、屏幕文字、CTA、水印。"
],
    cta: "上传真实素材，Aivora 帮你快速生成可发布宣传片。",
  },
  providerPlan: {
    digitalHuman: "heygen-ready",
    seedance: [
      "Shot 1-3 已用 Seedance 真实生成（含失败时 Ken Burns 真实素材补位）",
      "可继续按行业扩展生成镜头模板",
    ],
    nextKeys: ["ARK_API_KEY", "BLOB_READ_WRITE_TOKEN"],
  },
};

export const DEMO_SEED_VIDEO_URL = "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/demo-seed/pet_store_chinese_demo_30s_no_text_bgm_v2.mp4";
export const DEMO_SEED_VIDEO_THUMBNAIL = "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/demo-seed/pet_store_chinese_demo_30s_no_text.jpg";
export const DEMO_SEED_VIDEO_DURATION_SEC = 31;
export const DEMO_SEED_VIDEO_SUBTITLE_URL = "";
export const DEMO_SEED_BACKGROUND_VIDEO_URL = "";
export const DEMO_SEED_AVATAR_ID = "";
