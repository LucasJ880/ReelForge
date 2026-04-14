import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

export interface ProductContext {
  name: string;
  productLine: string;
  color: string;
  description: string;
  features: string[];
  sizes: string[];
}

export interface ContentGenerationInput {
  keyword: string;
  productContext?: ProductContext;
}

export interface ContentGenerationResult {
  script: string;
  videoPrompt: string;
  caption: string;
  hashtags: string[];
  contentAngles: { angle: string; reason: string }[];
  category: string;
  modelUsed: string;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

export interface AnalysisInput {
  keyword: string;
  script: string;
  caption: string;
  metrics: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
  };
}

export interface AnalysisResult {
  performanceSummary: string;
  directionAdvice: string;
  optimizationTips: string[];
  overallScore: number;
  modelUsed: string;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

const CONTENT_SYSTEM_PROMPT_BASE = `你是一个专业的 TikTok 短视频内容策划专家。你的任务是根据用户给出的关键词或产品方向，生成一套完整的 TikTok 短视频内容方案。

你必须输出严格的 JSON 格式，包含以下字段：
- script: 中文短视频脚本（包含开头吸引语、正文、行动号召，总共 150-300 字）
- videoPrompt: 用于 AI 视频生成的英文提示词（描述画面内容、风格、氛围，50-100 词）
- caption: TikTok 发布时的中文标题文案（20-50 字，要有吸引力）
- hashtags: 5-8 个相关中文 hashtag（数组格式）
- contentAngles: 2-3 个内容角度建议（数组，每个包含 angle 和 reason 字段）
- category: 内容分类（从以下类别中选择最匹配的一个：美食、旅行、时尚、科技、文化、教育、生活、健康、娱乐、商业、宠物、运动、艺术、音乐、游戏。如果都不匹配可以自定义一个简短的中文分类名）

要求：
1. 脚本必须适合 15-60 秒的短视频
2. 开头 3 秒必须有吸引力（hook）
3. 内容要有实用价值或情感共鸣
4. hashtag 要包含热门标签和精准标签
5. videoPrompt 必须是英文，描述要具体可执行`;

const PRODUCT_SYSTEM_PROMPT_ADDON = `

【重要约束 - 产品导向内容】
你正在为一个具体的毛毯产品生成推广内容。所有输出必须围绕给定的产品信息：
- 脚本中必须自然地提及产品的核心卖点（材质、特性、适用场景），但不要生硬罗列
- videoPrompt 必须精确描述该毛毯的外观特征（颜色/图案、材质质感），确保 AI 生成的视频画面与实际产品一致
- caption 和 hashtags 要包含产品相关标签（如 #毛毯 #法兰绒 #居家好物）
- 创意关键词决定内容的"角度"和"场景"，产品信息决定内容的"核心主体"
- videoPrompt 中描述毛毯时要具体：比如 "a soft black and white checkered flannel blanket" 而不是泛泛的 "a blanket"`;

function buildSystemPrompt(hasProduct: boolean): string {
  if (hasProduct) {
    return CONTENT_SYSTEM_PROMPT_BASE + PRODUCT_SYSTEM_PROMPT_ADDON;
  }
  return CONTENT_SYSTEM_PROMPT_BASE;
}

function buildUserMessage(input: ContentGenerationInput): string {
  if (input.productContext) {
    const p = input.productContext;
    return `产品信息：
- 名称：${p.name}
- 产品线：${p.productLine === "sherpa" ? "Sherpa双面毛毯（法兰绒+羊羔绒）" : "法兰绒毛毯"}
- 颜色/图案：${p.color}
- 产品描述：${p.description}
- 核心特点：${p.features.join("、")}
- 可选尺寸：${p.sizes.join("、")}

创意方向关键词：${input.keyword}

请围绕以上产品，以「${input.keyword}」为创意角度，生成 TikTok 短视频内容方案。请直接输出 JSON，不要包含 markdown 代码块。`;
  }

  return `请根据以下关键词/方向生成 TikTok 短视频内容方案：\n\n关键词：${input.keyword}\n\n请直接输出 JSON，不要包含 markdown 代码块。`;
}

export async function generateContent(
  input: ContentGenerationInput
): Promise<ContentGenerationResult> {
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: buildSystemPrompt(!!input.productContext) },
      { role: "user", content: buildUserMessage(input) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
    max_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI 返回为空");
  }

  const parsed = JSON.parse(content);

  return {
    script: parsed.script || "",
    videoPrompt: parsed.videoPrompt || parsed.video_prompt || "",
    caption: parsed.caption || "",
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
    contentAngles: Array.isArray(parsed.contentAngles || parsed.content_angles)
      ? (parsed.contentAngles || parsed.content_angles)
      : [],
    category: parsed.category || "其他",
    modelUsed: model,
    tokenUsage: response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : null,
  };
}

const ANALYSIS_SYSTEM_PROMPT = `你是一个 TikTok 数据分析专家。根据视频的内容信息和表现数据，给出专业的分析报告。

你必须输出严格的 JSON 格式，包含以下字段：
- performanceSummary: 表现总结（中文，100-200字，客观评价视频表现）
- directionAdvice: 方向建议（中文，100-200字，是否值得继续做类似内容，为什么）
- optimizationTips: 优化建议列表（中文字符串数组，3-5条具体可执行的建议）
- overallScore: 综合评分（1-100 整数，综合考虑互动率、播放量等）

分析要基于数据说话，给出具体、可执行的建议。`;

export async function generateAnalysis(
  input: AnalysisInput
): Promise<AnalysisResult> {
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: `请分析以下 TikTok 视频的表现：

关键词：${input.keyword}
脚本摘要：${input.script.slice(0, 200)}
标题：${input.caption}

数据表现：
- 播放量：${input.metrics.views}
- 点赞数：${input.metrics.likes}
- 评论数：${input.metrics.comments}
- 分享数：${input.metrics.shares}
- 互动率：${(((input.metrics.likes + input.metrics.comments + input.metrics.shares) / Math.max(input.metrics.views, 1)) * 100).toFixed(2)}%

请直接输出 JSON，不要包含 markdown 代码块。`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.5,
    max_tokens: 1500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI 分析返回为空");

  const parsed = JSON.parse(content);

  return {
    performanceSummary: parsed.performanceSummary || parsed.performance_summary || "",
    directionAdvice: parsed.directionAdvice || parsed.direction_advice || "",
    optimizationTips: Array.isArray(parsed.optimizationTips || parsed.optimization_tips)
      ? (parsed.optimizationTips || parsed.optimization_tips)
      : [],
    overallScore: parsed.overallScore || parsed.overall_score || 50,
    modelUsed: model,
    tokenUsage: response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : null,
  };
}
