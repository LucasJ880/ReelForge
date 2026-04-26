import { chatJson, isLLMAvailable } from "@/lib/providers/openai";
import {
  fetchTikTokPostSignals,
  isApifyAvailable,
  type TikTokCommentSample,
  type TikTokVideoSample,
} from "@/lib/providers/apify-tiktok";

export interface DemoVideoAnalysisInput {
  tiktokUrl: string;
  clientIndustry: string;
  clientOffer: string;
  targetAudience: string;
  tone: "premium" | "friendly" | "expert" | "bold";
}

export interface DemoVideoAnalysisResult {
  source: "apify+llm" | "llm-only" | "mock";
  reference: {
    url: string;
    author?: string;
    caption: string;
    hashtags: string[];
    music?: string;
    durationSec?: number;
    metrics: {
      plays: number;
      likes: number;
      comments: number;
      shares: number;
      engagementRate: number;
    };
    coverUrl?: string;
    downloadUrl?: string;
  };
  intelligence: {
    viralFormula: string;
    hook: string;
    retentionMechanics: string[];
    visualPattern: string[];
    audienceTriggers: string[];
    commentSignals: string[];
    riskNotes: string[];
  };
  clientVersion: {
    positioning: string;
    title: string;
    digitalHumanScript: string;
    scenePlan: {
      time: string;
      visual: string;
      narration: string;
      overlay: string;
    }[];
    captions: string[];
    brollPrompts: string[];
    cta: string;
  };
  providerPlan: {
    digitalHuman: "mock" | "heygen-ready";
    seedance: string[];
    nextKeys: string[];
  };
}

interface LLMOutput {
  viral_formula: string;
  hook: string;
  retention_mechanics: string[];
  visual_pattern: string[];
  audience_triggers: string[];
  comment_signals: string[];
  risk_notes: string[];
  positioning: string;
  title: string;
  digital_human_script: string;
  scene_plan: {
    time: string;
    visual: string;
    narration: string;
    overlay: string;
  }[];
  captions: string[];
  broll_prompts: string[];
  cta: string;
}

const SYSTEM_PROMPT = `你是 Aivora 的短视频增长策略总监，专门把 TikTok 爆款拆解成客户可复用的视频方案。

你必须输出 JSON，不输出 markdown。
输出要像给高净值客户看的专业增长报告：清晰、克制、有洞察，不要像普通 AI 文案。

重点：
- 不是抄袭原视频，而是提炼可迁移的结构：hook、节奏、情绪触发、信任机制、CTA。
- 所有文案统一称呼为“客户”，不要写“经纪人”。
- 数字人脚本要适合客户本人或客户品牌的虚拟形象讲出来。
- 对 TikTok 评论要做抽象归纳，不要复制脏话、emoji 或无意义感叹。

JSON 字段：
{
  "viral_formula": "一句话说明这个视频为什么可能火",
  "hook": "前 3 秒 hook 的结构",
  "retention_mechanics": ["3-5 条留存机制"],
  "visual_pattern": ["3-5 条镜头/视觉模式"],
  "audience_triggers": ["3-5 条观众心理触发"],
  "comment_signals": ["3-5 条从评论归纳的信号"],
  "risk_notes": ["2-4 条复刻时要规避的风险"],
  "positioning": "客户版视频定位",
  "title": "客户版视频标题",
  "digital_human_script": "20-35 秒中文数字人旁白，必须自然、有高级感",
  "scene_plan": [
    { "time": "0-3s", "visual": "画面", "narration": "旁白", "overlay": "屏幕字幕" }
  ],
  "captions": ["5-8 条短字幕"],
  "broll_prompts": ["3-5 条可用 Seedance 生成的 B-roll prompt，中文"],
  "cta": "最后 CTA"
}`;

export async function analyzeDemoReferenceVideo(
  input: DemoVideoAnalysisInput,
): Promise<DemoVideoAnalysisResult> {
  const signals =
    isApifyAvailable() && isTikTokUrl(input.tiktokUrl)
      ? await fetchTikTokPostSignals(input.tiktokUrl, { maxComments: 60 })
      : { videos: [], comments: [], source: "none" as const };

  const video = signals.videos[0] ?? mockVideo(input.tiktokUrl);
  const reference = toReference(video, input.tiktokUrl);
  const source =
    signals.source === "apify" && isLLMAvailable() ? "apify+llm" : isLLMAvailable() ? "llm-only" : "mock";

  if (!isLLMAvailable()) {
    return mockAnalysis(input, reference, source);
  }

  try {
    const { data } = await chatJson<LLMOutput>({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(input, video, signals.comments),
      temperature: 0.65,
      maxTokens: 2600,
    });
    return mapLLMOutput(input, reference, data, source);
  } catch (err) {
    console.warn("[demo-analysis] llm failed:", (err as Error).message);
    return mockAnalysis(input, reference, signals.source === "apify" ? "apify+llm" : "mock");
  }
}

function buildUserPrompt(
  input: DemoVideoAnalysisInput,
  video: TikTokVideoSample,
  comments: TikTokCommentSample[],
) {
  return `参考 TikTok 视频：
${JSON.stringify(
  {
    url: video.url || input.tiktokUrl,
    author: video.authorName,
    caption: video.caption,
    hashtags: video.hashtags,
    music: video.musicName,
    durationSec: video.durationSec,
    metrics: {
      playCount: video.playCount,
      likeCount: video.likeCount,
      commentCount: video.commentCount,
      shareCount: video.shareCount,
    },
  },
  null,
  2,
)}

Top comments（按抓取顺序）：
${JSON.stringify(
  comments.slice(0, 40).map((c) => ({
    text: c.text,
    likeCount: c.likeCount,
  })),
  null,
  2,
)}

客户业务：
${JSON.stringify(
  {
    industry: input.clientIndustry,
    offer: input.clientOffer,
    targetAudience: input.targetAudience,
    tone: input.tone,
  },
  null,
  2,
)}

请把参考视频的爆款结构迁移为客户专属数字人视频方案。`;
}

function mapLLMOutput(
  input: DemoVideoAnalysisInput,
  reference: DemoVideoAnalysisResult["reference"],
  data: LLMOutput,
  source: DemoVideoAnalysisResult["source"],
): DemoVideoAnalysisResult {
  return {
    source,
    reference,
    intelligence: {
      viralFormula: data.viral_formula,
      hook: data.hook,
      retentionMechanics: data.retention_mechanics ?? [],
      visualPattern: data.visual_pattern ?? [],
      audienceTriggers: data.audience_triggers ?? [],
      commentSignals: data.comment_signals ?? [],
      riskNotes: data.risk_notes ?? [],
    },
    clientVersion: {
      positioning: data.positioning,
      title: data.title,
      digitalHumanScript: data.digital_human_script,
      scenePlan: data.scene_plan ?? [],
      captions: data.captions ?? [],
      brollPrompts: data.broll_prompts ?? [],
      cta: data.cta,
    },
    providerPlan: providerPlan(input),
  };
}

function mockAnalysis(
  input: DemoVideoAnalysisInput,
  reference: DemoVideoAnalysisResult["reference"],
  source: DemoVideoAnalysisResult["source"],
): DemoVideoAnalysisResult {
  return {
    source,
    reference,
    intelligence: {
      viralFormula:
        "用一个强情境开场制造代入感，再用快速反差和具体结果让观众愿意停留。",
      hook: "先抛出客户正在经历的痛点，再马上展示一个更轻松的解决方式。",
      retentionMechanics: [
        "3 秒内给出明确冲突：现在做法很累，替代方案更省心。",
        "每 4-5 秒切一次信息点，避免单一口播疲劳。",
        "用评论区真实疑问作为下一段内容的转场。",
        "结尾不给泛泛口号，而给一个具体下一步动作。",
      ],
      visualPattern: [
        "开头用真实场景建立可信度。",
        "中段叠加数字人讲解，减少真人反复出镜成本。",
        "用近景文字卡强调关键数字和承诺。",
        "结尾给品牌化 CTA 和联系入口。",
      ],
      audienceTriggers: [
        "想节省时间但又担心质量下降。",
        "希望服务方看起来更专业、更现代。",
        "对真人重复拍摄成本敏感。",
        "被同类爆款吸引，但不知道怎么迁移到自己的业务。",
      ],
      commentSignals: [
        "观众会追问具体怎么做到。",
        "对真实案例和前后对比更有反应。",
        "对过度 AI 感会谨慎，需要保留真人可信度。",
      ],
      riskNotes: [
        "不要直接复制原视频脚本和镜头，避免侵权与平台同质化。",
        "数字人必须服务客户信任感，不要做成廉价虚拟主播。",
        "视频里要明确这是客户业务的方案，而不是泛泛 AI 炫技。",
      ],
    },
    clientVersion: {
      positioning: `${input.clientIndustry || "客户业务"} 的高信任 AI 视频获客样片`,
      title: "把一次拍摄变成一套持续获客的视频资产",
      digitalHumanScript:
        `如果你的客户正在比较不同方案，第一眼看到的内容就决定了他们是否愿意继续了解。Aivora 会先分析一条已经验证过的爆款视频结构，再把它改写成适合${input.clientOffer || "你当前服务"}的数字人讲解。你只需要准备真实素材和客户形象，我们负责脚本、节奏、字幕和可发布版本。`,
      scenePlan: [
        {
          time: "0-3s",
          visual: "真实业务场景或客户案例画面快速出现",
          narration: "客户为什么会停下来，往往发生在前三秒。",
          overlay: "3 秒决定是否继续看",
        },
        {
          time: "4-12s",
          visual: "数字人出现在画面侧边，解释核心痛点",
          narration: "我们不是复制爆款，而是拆解它背后的成交逻辑。",
          overlay: "Hook / Trust / CTA",
        },
        {
          time: "13-24s",
          visual: "B-roll 展示服务流程、成果、客户场景",
          narration: "再把这套逻辑重建成适合你客户的视频资产。",
          overlay: "一套素材，多条视频",
        },
        {
          time: "25-30s",
          visual: "品牌收束 + 联系方式 + 下一步行动",
          narration: "这就是 Aivora 帮客户规模化生成视频的方式。",
          overlay: "Book a demo",
        },
      ],
      captions: [
        "不是复制爆款，是复制增长结构",
        "真实素材 + 数字人 + AI 脚本",
        "客户不用反复出镜",
        "一套素材生成多条内容",
        "让视频看起来更专业、更可信",
      ],
      brollPrompts: [
        "高端服务顾问在现代办公室与客户沟通，竖屏，真实商业纪录片风格",
        "手机上播放专业短视频数据看板，柔和霓虹光，浅景深",
        "客户案例素材被 AI 自动拆成镜头卡片，premium SaaS interface",
      ],
      cta: "把你喜欢的爆款链接发给我们，我们现场拆给你看。",
    },
    providerPlan: providerPlan(input),
  };
}

function toReference(video: TikTokVideoSample, fallbackUrl: string) {
  const plays = video.playCount || 0;
  const likes = video.likeCount || 0;
  const comments = video.commentCount || 0;
  const shares = video.shareCount || 0;
  const engagementRate = plays > 0 ? Number((((likes + comments + shares) / plays) * 100).toFixed(2)) : 0;
  return {
    url: video.url || fallbackUrl,
    author: video.authorName,
    caption: video.caption || "TikTok reference video",
    hashtags: video.hashtags || [],
    music: video.musicName,
    durationSec: video.durationSec,
    metrics: {
      plays,
      likes,
      comments,
      shares,
      engagementRate,
    },
    coverUrl: video.coverUrl,
    downloadUrl: video.downloadUrl,
  };
}

function providerPlan(input: DemoVideoAnalysisInput): DemoVideoAnalysisResult["providerPlan"] {
  return {
    digitalHuman:
      process.env.DIGITAL_HUMAN_PROVIDER?.toLowerCase() === "heygen"
        ? "heygen-ready"
        : "mock",
    seedance: [
      `${input.clientIndustry || "客户业务"}场景化 B-roll`,
      "服务流程视觉补充镜头",
      "客户痛点/结果对比镜头",
    ],
    nextKeys: [
      "HEYGEN_API_KEY",
      "HEYGEN_AVATAR_ID",
      "HEYGEN_VOICE_ID",
    ],
  };
}

function mockVideo(url: string): TikTokVideoSample {
  return {
    id: "mock_reference",
    url,
    caption:
      "POV: you found a smarter way to turn one client story into a full video campaign.",
    hashtags: ["aivideo", "digitalhuman", "clientgrowth"],
    playCount: 1240000,
    likeCount: 86400,
    commentCount: 2300,
    shareCount: 9800,
    authorName: "reference.creator",
    musicName: "Original sound",
    durationSec: 28,
  };
}

function isTikTokUrl(url: string) {
  try {
    const host = new URL(url).hostname;
    return host.includes("tiktok.com");
  } catch {
    return false;
  }
}
