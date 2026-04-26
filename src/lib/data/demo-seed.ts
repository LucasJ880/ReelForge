/**
 * Demo 种子数据：客户打开 /demo/ai-video 第一眼看到的真实样例。
 *
 * 由 scripts/generate-demo-seed.ts 自动生成；不要手动改动。
 *
 * 生成时间：2026-04-26T17:24:47.826Z
 * 数据源：apify+llm
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
    "coverUrl": "https://p16-common-sign.tiktokcdn-us.com/tos-useast8-p-0068-tx2/o0VDuPufEzqDQ5FAmw6ASQ0f9OrRBWEzPIECny~tplv-tiktokx-origin.image?dr=9636&x-expires=1777395600&x-signature=E1RzzZf9KZx1t%2BjO8xwfjXl94DQ%3D&t=4d5b0474&ps=13740610&shp=81f88b70&shcp=43f4a2f9&idc=useast5"
  },
  "intelligence": {
    "viralFormula": "展示高端住宅的独特魅力与梦想生活方式，引发高净值买家共鸣。",
    "hook": "前 3 秒展示绝美外观和引人入胜的问句：'想象一下，这里就是您的梦想家园。'",
    "retentionMechanics": [
      "使用快速切换的镜头展示不同房间和景观",
      "增加与环境互动的镜头，比如在花园中散步",
      "在关键时刻使用情感充沛的背景音乐"
    ],
    "visualPattern": [
      "从空中俯瞰整个物业的美丽画面",
      "细致展示室内设计和装潢",
      "展示周边自然环境的宁静与优雅"
    ],
    "audienceTriggers": [
      "对奢华生活方式的向往",
      "渴望拥有一个完美的家庭聚会场所",
      "对投资高端房地产的兴趣与好奇"
    ],
    "commentSignals": [
      "观众对价格的震惊与幽默反应",
      "对物业用途（如婚礼场地）的询问",
      "对梦幻生活的表达与赞叹"
    ],
    "riskNotes": [
      "避免过于奢华的表现导致观众疏离",
      "确保信息传达清晰，避免复杂的价格或功能说明",
      "注意视频时长，保持在20-30秒之间"
    ]
  },
  "clientVersion": {
    "positioning": "展现高端住宅的生活方式和投资价值，吸引高净值客户的注意。",
    "title": "您的梦幻家园，豪华生活的完美选择",
    "digitalHumanScript": "欢迎来到这个令人惊叹的豪华住宅，坐落在宁静的自然环境中。这里是您理想中的家，不仅是一个住所，更是生活的艺术。想象一下，您和家人在这片美丽的土地上共享生活的每一个瞬间。现在就来体验这一切吧。",
    "scenePlan": [
      {
        "time": "0-3s",
        "visual": "空中俯瞰房产全景",
        "narration": "想象一下，这里就是您的梦想家园。",
        "overlay": "您的梦想家园"
      },
      {
        "time": "4-10s",
        "visual": "展示豪华客厅的细节",
        "narration": "宽敞的客厅，完美的社交空间。",
        "overlay": "完美的社交空间"
      },
      {
        "time": "11-20s",
        "visual": "展示花园和周边自然环境",
        "narration": "在这里，您可以尽享宁静与美好。",
        "overlay": "享受宁静与美好"
      },
      {
        "time": "21-30s",
        "visual": "展示物业外观与周围设施",
        "narration": "这不仅是家，更是生活的艺术。",
        "overlay": "生活的艺术"
      }
    ],
    "captions": [
      "梦想家园，尽在眼前",
      "奢华与宁静的完美结合",
      "为生活增添一抹色彩",
      "在这里，生活是一种享受",
      "与家人共享美好的时光",
      "您的投资之选，未来的希望",
      "每个角落都散发着优雅",
      "让梦想成为现实"
    ],
    "brollPrompts": [
      "展示豪华住宅的外观与庭院",
      "拍摄室内装饰与家居风格",
      "捕捉自然环境中的宁静时光"
    ],
    "cta": "立即联系我们，开启您的豪华生活之旅。"
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

export const DEMO_SEED_VIDEO_URL = "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/demo-seed/heygen-d0e0c3c6680d473daa7bb01bc33a4145.mp4";

export const DEMO_SEED_VIDEO_THUMBNAIL = "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/demo-seed/heygen-d0e0c3c6680d473daa7bb01bc33a4145.jpg";

export const DEMO_SEED_VIDEO_DURATION_SEC = 23.72;
