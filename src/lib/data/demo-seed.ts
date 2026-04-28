/**
 * Demo 种子数据：客户打开 /demo/ai-video 第一眼看到的真实样例。
 *
 * 由 scripts/build-pet-demo-seed.ts 自动生成；不要手动改动。
 *
 * 生成时间：2026-04-28T01:04:26.026Z
 * 数据源：pet-store-real-assets + seedance + openai
 * Seedance jobs: s1:cgt-20260428084426-278wc, s2:cgt-20260428084721-x6md5, s3:cgt-20260428085213-pfrmw, s4:cgt-20260428085813-fxcr2
 */
import type {
  DemoVideoAnalysisInput,
  DemoVideoAnalysisResult,
} from "@/lib/services/demo-video-analysis-service";

export const DEMO_SEED_INPUT: DemoVideoAnalysisInput = {
  tiktokUrl: "https://example.com/pet-store-demo-reference",
  clientIndustry: "宠物店 / 宠物生活馆",
  clientOffer: "门店日常服务、宠物护理、商品零售与会员服务",
  targetAudience: "附近 3-5 公里养宠家庭与年轻白领用户",
  tone: "friendly",
};

export const DEMO_SEED_RESULT: DemoVideoAnalysisResult = {
  source: "llm-only",
  reference: {
    url: "https://example.com/pet-store-demo-reference",
    author: "pet_store_demo",
    caption: "真实宠物店素材 + Seedance AI 镜头，生成可发布中文宣传片。",
    hashtags: ["宠物店", "猫咪", "Seedance", "AI视频"],
    music: "ambient",
    durationSec: 60.03,
    metrics: {
      plays: 162000,
      likes: 12400,
      comments: 728,
      shares: 2430,
      engagementRate: 9.58,
    },
    coverUrl: "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/demo-seed/pet_store_chinese_demo_video.jpg",
  },
  intelligence: {
    viralFormula: "真实门店镜头负责信任，Seedance AI 镜头负责高级质感，组合后更容易转化。",
    hook: "开场先给猫咪和店内氛围，再快速拉到AI质感镜头，3秒内建立兴趣。",
    retentionMechanics: [
      "真实镜头和 AI 镜头交替，节奏更有层次",
      "每屏一句短字幕，手机端一眼可读",
      "口语化旁白降低广告感，提升亲和度",
      "结尾 CTA 明确，便于客户理解产品价值",
    ],
    visualPattern: [
      "猫咪特写 + 门店环境",
      "商品/服务区信息镜头",
      "Seedance 生成的电影感补充镜头",
      "温暖色调与轻快节奏统一",
    ],
    audienceTriggers: [
      "宠物可爱瞬间带来的情绪连接",
      "真实门店画面带来的信任感",
      "AI 质感画面带来的专业感",
    ],
    commentSignals: [
      "看起来真实又高级",
      "门店靠谱，愿意到店体验",
      "这种视频很适合发社媒",
    ],
    riskNotes: [
      "AI 镜头占比不宜过高，避免失真感",
      "旁白避免官腔，保持口语化",
      "字幕继续控制短句，防止信息过载",
    ],
  },
  clientVersion: {
    positioning: "基于真实素材+Seedance生成镜头，快速输出适合中文社媒发布的宠物店宣传片。",
    title: "真实素材 + Seedance AI 镜头，一分钟生成宠物店宣传片",
    digitalHumanScript: "嘿，你看看这只小猫，真的是太有趣了，特别喜欢窗外的世界！在猫爬架上探索，真是它的乐趣啊，每个角落都想去看看！你看窗户反射着外面的景色，家里也被装饰得温馨又好看，真不错！这只猫咪坐在窗边，眼神超专注，仿佛在思考人生呢！有这样的小伙伴，每天都充满乐趣，生活变得更有意思了！这条视频包含Seedance生成镜头，带给你不一样的体验，快来看看吧！",
    scenePlan: [
      { time: "0-10s", visual: "Seedance猫咪氛围镜头", narration: "先抓情绪", overlay: "真实感开场" },
      { time: "10-20s", visual: "Seedance门店生活感镜头", narration: "建立空间信任", overlay: "温暖门店氛围" },
      { time: "20-30s", visual: "Seedance商品与服务镜头", narration: "传达可消费信息", overlay: "服务价值可视化" },
      { time: "30-40s", visual: "真实门店猫咪镜头", narration: "强化真实可信", overlay: "真实素材承接" },
      { time: "40-50s", visual: "Seedance高级质感镜头", narration: "提升整体质感", overlay: "AI镜头增强记忆" },
      { time: "50-60s", visual: "真实素材收尾", narration: "明确行动引导", overlay: "上传素材即可出片" },
    ],
    captions: [
  "这条视频真可爱！",
  "猫咪真是好奇宝宝！",
  "窗外的风景太美了！",
  "猫咪的专注力真强！",
  "和猫咪一起享受生活！",
  "快来一起分享吧！"
],
    brollPrompts: [
  "Vertical 9:16 cinematic shot inside a cozy pet store. A playful cat walks toward camera then pauses near the glass window. Warm afternoon sunlight, soft film texture, realistic style, lively but natural.",
  "Vertical 9:16 close-up sequence of cat climbing a wooden cat tree and looking at the lens. Smooth handheld motion, warm home-like lighting, premium pet store atmosphere, realistic details.",
  "Vertical 9:16 dynamic shot of pet products shelf and service area in a modern pet shop. Subtle camera push-in, clean composition, warm colors, realistic commercial quality, no text watermark.",
  "Vertical 9:16 emotional hero shot: a cute cat near the storefront with soft evening light, slight slow motion feeling, gentle bokeh, heartwarming and trustworthy tone, highly realistic."
],
    cta: "上传真实素材，Aivora 帮你快速生成可发布宣传片。",
  },
  providerPlan: {
    digitalHuman: "heygen-ready",
    seedance: [
      "Seedance 4段 AI 主镜头已实拍融合",
      "可继续按行业扩展生成镜头模板",
    ],
    nextKeys: ["ARK_API_KEY", "OPENAI_API_KEY", "BLOB_READ_WRITE_TOKEN"],
  },
};

export const DEMO_SEED_VIDEO_URL = "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/demo-seed/pet_store_chinese_demo_video.mp4";
export const DEMO_SEED_VIDEO_THUMBNAIL = "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/demo-seed/pet_store_chinese_demo_video.jpg";
export const DEMO_SEED_VIDEO_DURATION_SEC = 60.03;
export const DEMO_SEED_VIDEO_SUBTITLE_URL = "/demo/pet-store/pet_store_subtitles.vtt";
export const DEMO_SEED_BACKGROUND_VIDEO_URL = "";
export const DEMO_SEED_AVATAR_ID = "";
