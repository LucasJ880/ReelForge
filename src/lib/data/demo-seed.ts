/**
 * Demo 种子数据：客户打开 /demo/ai-video 第一眼看到的真实样例。
 *
 * 由 scripts/generate-demo-seed.ts 自动生成；不要手动改动。
 *
 * 生成时间：2026-04-26T18:29:46.851Z
 * 数据源：apify+llm
 * Avatar: Brandon_expressive2_public
 * Background: Seedance 豪宅内景 (mirrored to Blob)
 * HeyGen video_id 已下载并 mirrored 到 Vercel Blob，避免 7 天过期。
 */
import type {
  DemoVideoAnalysisInput,
  DemoVideoAnalysisResult,
} from "@/lib/services/demo-video-analysis-service";

export const DEMO_SEED_INPUT: DemoVideoAnalysisInput = {
  "tiktokUrl": "https://www.tiktok.com/@heider_realestate/video/7408214208195595550",
  "clientIndustry": "地产经纪 / 高端住宅经纪团队",
  "clientOffer": "为高端住宅经纪和团队，把每一套 listing 拍出来的素材，扩展为可持续获客的短视频内容资产",
  "targetAudience": "在洛杉矶、纽约等核心市场寻找下一套住宅或投资物业的高净值买家，对生活方式与品牌信任敏感",
  "tone": "premium"
};

export const DEMO_SEED_RESULT: DemoVideoAnalysisResult = {
  "source": "apify+llm",
  "reference": {
    "url": "https://www.tiktok.com/@heider_realestate/video/7408214208195595550",
    "author": "heider_realestate",
    "caption": "The perfect family compound in Charlottesville, Virginia📍- Offered for $52,600,000. #luxuryrealestate #countryside #realestate",
    "hashtags": [
      "luxuryrealestate",
      "countryside",
      "realestate"
    ],
    "music": "original sound",
    "durationSec": 19,
    "metrics": {
      "plays": 390800,
      "likes": 38800,
      "comments": 221,
      "shares": 6644,
      "engagementRate": 11.69
    },
    "coverUrl": "https://p16-common-sign.tiktokcdn-us.com/tos-useast8-p-0068-tx2/o0VDuPufEzqDQ5FAmw6ASQ0f9OrRBWEzPIECny~tplv-tiktokx-origin.image?dr=9636&x-expires=1777399200&x-signature=z55BaiiBdWSUh9Gp6jSWcigM%2Ftc%3D&t=4d5b0474&ps=13740610&shp=81f88b70&shcp=43f4a2f9&idc=useast5"
  },
  "intelligence": {
    "viralFormula": "展示奢华生活方式与情感连接，吸引高净值买家。",
    "hook": "想象一下，您和家人在这片梦幻庄园中度过的每一天。",
    "retentionMechanics": [
      "快速切换不同的房间和景观，保持视觉新鲜感。",
      "使用令人惊叹的背景音乐，增强情感共鸣。",
      "提供具体的生活场景描述，引发观众的想象力。",
      "展示房产的独特卖点，如私人游泳池、花园等。",
      "在视频中加入客户的成功故事，建立信任感。"
    ],
    "visualPattern": [
      "航拍全景，展示房产整体布局与周边环境。",
      "室内细节特写，突出高端装修与设计。",
      "生活场景再现，展示家庭聚会或休闲时光。",
      "自然光照射下的房间，营造温馨氛围。",
      "夜景灯光下的外观，展现房产的魅力。"
    ],
    "audienceTriggers": [
      "渴望拥有理想生活的情感共鸣。",
      "对奢华与舒适的向往。",
      "对高端品牌信任的心理认同。",
      "对未来生活愿景的憧憬。",
      "寻求社交认可与生活品质的期望。"
    ],
    "commentSignals": [
      "对生活梦想的表达与期待。",
      "对房产价值的好奇与讨论。",
      "对独特属性的赞美与询问。",
      "对个人故事或情感连接的共鸣。",
      "对视频内容的分享欲望。"
    ],
    "riskNotes": [
      "避免过于复杂的剪辑，影响观看体验。",
      "注意音频质量，确保背景音乐不干扰旁白。",
      "确保内容真实，避免夸大房产特色。",
      "避免使用低质量的视觉素材，影响品牌形象。"
    ]
  },
  "clientVersion": {
    "positioning": "高端住宅经纪团队专属视频，展示奢华生活方式，吸引高净值买家。",
    "title": "您梦想中的奢华家园，尽在这片庄园",
    "digitalHumanScript": "欢迎来到您理想中的家园。在这里，您不仅拥有一处住所，更是生活方式的象征。想象一下，您和家人在这个梦幻庄园中共享每一个美好瞬间。无论是晨曦中的花园，还是夜晚的星空，都会让您感受到生活的格调与品质。今天，您愿意迈出这一步，去拥抱属于您的奢华生活吗？",
    "scenePlan": [
      {
        "time": "0-3s",
        "visual": "航拍庄园全景，展示房产外观与环境",
        "narration": "欢迎来到您理想中的家园。",
        "overlay": "梦想中的家园"
      },
      {
        "time": "4-10s",
        "visual": "室内镜头，展示豪华装修与生活场景",
        "narration": "在这里，您不仅拥有一处住所，更是生活方式的象征。",
        "overlay": "奢华生活方式"
      },
      {
        "time": "11-20s",
        "visual": "夜景灯光下的外观，营造浪漫氛围",
        "narration": "今天，您愿意迈出这一步，去拥抱属于您的奢华生活吗？",
        "overlay": "拥抱奢华生活"
      }
    ],
    "captions": [
      "您梦想中的家园",
      "奢华生活方式的象征",
      "共享每一个美好瞬间",
      "今天就来体验吧",
      "无与伦比的舒适与优雅",
      "让生活更具品质",
      "您的理想家园就在这里",
      "别错过这个机会"
    ],
    "brollPrompts": [
      "航拍高端住宅的全景画面",
      "展示室内豪华装潢与细节特写",
      "家庭聚会的温馨场景",
      "夜景灯光点缀下的庄园外观",
      "自然光照下的花园与泳池"
    ],
    "cta": "立即联系我们，开启您的奢华生活之旅。"
  },
  "providerPlan": {
    "digitalHuman": "heygen-ready",
    "seedance": [
      "地产经纪 / 高端住宅经纪团队场景化 B-roll",
      "服务流程视觉补充镜头",
      "客户痛点/结果对比镜头"
    ],
    "nextKeys": [
      "HEYGEN_API_KEY",
      "HEYGEN_AVATAR_ID",
      "HEYGEN_VOICE_ID"
    ]
  }
};

export const DEMO_SEED_VIDEO_URL = "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/demo-seed/heygen-451915a8f6234006b5d012b18005399f.mp4";

export const DEMO_SEED_VIDEO_THUMBNAIL = "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/demo-seed/heygen-451915a8f6234006b5d012b18005399f.jpg";

export const DEMO_SEED_VIDEO_DURATION_SEC = 34.95;

export const DEMO_SEED_BACKGROUND_VIDEO_URL = "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/demo-seed/seedance-bg-cgt-20260427021423-dwwcc.mp4";

export const DEMO_SEED_AVATAR_ID = "Brandon_expressive2_public";
