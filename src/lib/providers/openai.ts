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

export interface TrendStyleContext {
  narrativeStyle: string;
  emotionalTone: string;
  hookStrategy: string;
  contentStructure: string;
  visualStyle: string;
  originalTitle?: string;
}

export interface TrendReferenceContext {
  styleAnalysis?: {
    narrativeStyle: string;
    emotionalTone: string;
    hookStrategy: string;
    contentStructure: string;
    visualStyle: string;
  };
  visualAnalysis?: {
    colorPalette: string;
    overallMood: string;
    suggestedVideoStyle: string;
    sceneType?: string;
    lightingStyle?: string;
  };
  title?: string;
  platform?: string;
  viewCount?: number;
}

export interface ContentGenerationInput {
  keyword: string;
  productContext?: ProductContext;
  trendStyle?: TrendStyleContext;
  trendReferences?: TrendReferenceContext[];
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

const TREND_SYSTEM_PROMPT_ADDON = `

【重要约束 - 对标爆款风格】
你正在参考一个 TikTok 爆款视频的风格来生成内容。你必须：
- 模仿参考视频的叙事手法和节奏结构，但内容必须是原创的
- 采用相似的情感基调和开头策略（hook）
- videoPrompt 的画面风格要参考分析中的视觉描述
- 不要直接照搬原视频内容，而是学习其成功要素并融合到新内容中
- 这是"灵感参考"而非"搬运"，最终内容必须围绕给定的关键词/产品`;

const MULTI_REFS_SYSTEM_PROMPT_ADDON = `

【重要约束 - 多爆款参考融合】
你正在参考多个爆款短视频的风格来生成内容。你必须：
- 综合分析所有参考视频的共同成功要素和风格特点
- 从中提取最佳的叙事手法、情感基调、钩子策略
- videoPrompt 要融合参考视频中最有效的视觉风格
- 如果不同参考之间有冲突，优先选择播放量更高的视频风格
- 这是"灵感参考"而非"搬运"，最终内容必须原创且围绕给定的关键词/产品`;

function buildSystemPrompt(hasProduct: boolean, hasTrend: boolean, hasMultiRefs: boolean): string {
  let prompt = CONTENT_SYSTEM_PROMPT_BASE;
  if (hasProduct) prompt += PRODUCT_SYSTEM_PROMPT_ADDON;
  if (hasMultiRefs) prompt += MULTI_REFS_SYSTEM_PROMPT_ADDON;
  else if (hasTrend) prompt += TREND_SYSTEM_PROMPT_ADDON;
  return prompt;
}

function buildTrendBlock(t: TrendStyleContext): string {
  return `\n参考爆款视频风格分析：
- 原视频标题：${t.originalTitle || "未知"}
- 叙事手法：${t.narrativeStyle}
- 情感基调：${t.emotionalTone}
- 开头策略：${t.hookStrategy}
- 内容结构：${t.contentStructure}
- 画面风格：${t.visualStyle}

请模仿以上爆款风格来创作内容。`;
}

function buildMultiRefsBlock(refs: TrendReferenceContext[]): string {
  const blocks = refs.map((ref, i) => {
    const parts: string[] = [`参考视频 ${i + 1}${ref.platform ? ` (${ref.platform})` : ""}${ref.viewCount ? ` — 播放量 ${ref.viewCount.toLocaleString()}` : ""}:`];
    if (ref.title) parts.push(`  标题：${ref.title}`);
    if (ref.styleAnalysis) {
      const s = ref.styleAnalysis;
      parts.push(`  叙事手法：${s.narrativeStyle}`);
      parts.push(`  情感基调：${s.emotionalTone}`);
      parts.push(`  开头策略：${s.hookStrategy}`);
      parts.push(`  内容结构：${s.contentStructure}`);
      parts.push(`  画面风格：${s.visualStyle}`);
    }
    if (ref.visualAnalysis) {
      const v = ref.visualAnalysis;
      parts.push(`  视觉色调：${v.colorPalette}`);
      parts.push(`  整体氛围：${v.overallMood}`);
      if (v.sceneType) parts.push(`  场景类型：${v.sceneType}`);
      if (v.lightingStyle) parts.push(`  光线风格：${v.lightingStyle}`);
      parts.push(`  推荐视频风格（英文）：${v.suggestedVideoStyle}`);
    }
    return parts.join("\n");
  });

  return `\n\n爆款视频参考分析（共 ${refs.length} 个）：\n${blocks.join("\n\n")}\n\n请综合以上爆款参考的风格来创作内容。`;
}

function buildUserMessage(input: ContentGenerationInput): string {
  const trendBlock = input.trendReferences?.length
    ? buildMultiRefsBlock(input.trendReferences)
    : input.trendStyle
      ? buildTrendBlock(input.trendStyle)
      : "";

  if (input.productContext) {
    const p = input.productContext;
    return `产品信息：
- 名称：${p.name}
- 产品线：${p.productLine === "sherpa" ? "Sherpa双面毛毯（法兰绒+羊羔绒）" : "法兰绒毛毯"}
- 颜色/图案：${p.color}
- 产品描述：${p.description}
- 核心特点：${p.features.join("、")}
- 可选尺寸：${p.sizes.join("、")}
${trendBlock}
创意方向关键词：${input.keyword}

请围绕以上产品，以「${input.keyword}」为创意角度，生成 TikTok 短视频内容方案。请直接输出 JSON，不要包含 markdown 代码块。`;
  }

  return `请根据以下关键词/方向生成 TikTok 短视频内容方案：\n\n关键词：${input.keyword}${trendBlock}\n\n请直接输出 JSON，不要包含 markdown 代码块。`;
}

export async function generateContent(
  input: ContentGenerationInput
): Promise<ContentGenerationResult> {
  const hasMultiRefs = !!input.trendReferences?.length;
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: buildSystemPrompt(!!input.productContext, !!input.trendStyle, hasMultiRefs) },
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

// ============================================================
// 爆款视频风格分析
// ============================================================

export interface ViralAnalysisInput {
  title: string | null;
  description: string | null;
  hashtags: string[];
  authorName: string | null;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  shareCount?: number | null;
}

export interface ViralStyleResult {
  narrativeStyle: string;
  emotionalTone: string;
  hookStrategy: string;
  contentStructure: string;
  visualStyle: string;
  successFactors: string[];
  modelUsed: string;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

const VIRAL_ANALYSIS_SYSTEM_PROMPT = `你是一个 TikTok 爆款内容分析专家。你的任务是根据一个 TikTok 视频的元数据（标题、描述、标签、数据指标），深度分析该视频的成功要素和内容风格。

你必须输出严格的 JSON 格式，包含以下字段：
- narrativeStyle: 叙事手法分析（中文，50-100字，如"第一人称体验分享"、"产品展示+使用场景切换"等）
- emotionalTone: 情感基调（中文，30-50字，如"温馨治愈"、"搞笑幽默"、"紧迫感营造"等）
- hookStrategy: 开头吸引策略（中文，50-80字，分析视频可能使用的前3秒吸引技巧）
- contentStructure: 内容结构（中文，50-80字，如"痛点引入→解决方案→产品展示→行动号召"）
- visualStyle: 画面风格描述（英文，50-80词，描述视频可能的画面风格、色调、拍摄手法，用于AI视频生成参考）
- successFactors: 成功要素列表（中文字符串数组，3-5条，分析该视频可能爆款的原因）

分析要基于标题和标签推断视频内容，给出专业、可操作的洞察。`;

export async function analyzeViralStyle(
  input: ViralAnalysisInput
): Promise<ViralStyleResult> {
  const metricsBlock = (input.viewCount || input.likeCount)
    ? `\n数据指标：
- 播放量：${input.viewCount ?? "未知"}
- 点赞数：${input.likeCount ?? "未知"}
- 评论数：${input.commentCount ?? "未知"}
- 分享数：${input.shareCount ?? "未知"}`
    : "";

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: VIRAL_ANALYSIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: `请分析以下 TikTok 爆款视频的内容风格：

标题：${input.title || "无标题"}
描述：${input.description || "无描述"}
标签：${input.hashtags.length ? input.hashtags.join(" ") : "无标签"}
作者：${input.authorName || "未知"}${metricsBlock}

请直接输出 JSON，不要包含 markdown 代码块。`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.6,
    max_tokens: 1500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI 爆款分析返回为空");

  const parsed = JSON.parse(content);

  return {
    narrativeStyle: parsed.narrativeStyle || parsed.narrative_style || "",
    emotionalTone: parsed.emotionalTone || parsed.emotional_tone || "",
    hookStrategy: parsed.hookStrategy || parsed.hook_strategy || "",
    contentStructure: parsed.contentStructure || parsed.content_structure || "",
    visualStyle: parsed.visualStyle || parsed.visual_style || "",
    successFactors: Array.isArray(parsed.successFactors || parsed.success_factors)
      ? (parsed.successFactors || parsed.success_factors)
      : [],
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

// ============================================================
// 缩略图视觉分析 (GPT-4o Vision)
// ============================================================

export interface ThumbnailAnalysisResult {
  colorPalette: string;
  lightingStyle: string;
  sceneType: string;
  overallMood: string;
  productPresentation: string;
  suggestedVideoStyle: string;
}

const THUMBNAIL_ANALYSIS_PROMPT = `You are a visual content analyst specializing in viral short-form video aesthetics. Analyze the provided thumbnail image from a social media short video and output a JSON object with:

- colorPalette: Dominant colors and color scheme (e.g. "warm earth tones with soft beige and brown", "high contrast black and white with orange accents")
- lightingStyle: Lighting description (e.g. "soft natural window light", "warm golden hour glow", "studio ring light")
- sceneType: Scene category (e.g. "cozy indoor bedroom", "outdoor lifestyle", "product close-up", "pet interaction")
- overallMood: Emotional mood (e.g. "warm and cozy", "energetic and playful", "minimalist and clean")
- productPresentation: How any product is shown, or "no product visible" (e.g. "blanket draped over sofa as hero element", "held by person showing texture")
- suggestedVideoStyle: A concise English video generation prompt that captures this visual style (50-80 words, directly usable for AI video generation)

Output ONLY valid JSON. No markdown code blocks.`;

export async function analyzeThumbnail(
  thumbnailUrl: string,
  metadata?: { title?: string; platform?: string }
): Promise<ThumbnailAnalysisResult> {
  const contextHint = metadata?.title
    ? `\nContext: This thumbnail is from a ${metadata.platform || "social media"} video titled "${metadata.title}".`
    : "";

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: THUMBNAIL_ANALYSIS_PROMPT + contextHint },
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze this video thumbnail:" },
          { type: "image_url", image_url: { url: thumbnailUrl, detail: "high" } },
        ],
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: 800,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("GPT-4o Vision 缩略图分析返回为空");

  const parsed = JSON.parse(content);

  return {
    colorPalette: parsed.colorPalette || parsed.color_palette || "",
    lightingStyle: parsed.lightingStyle || parsed.lighting_style || "",
    sceneType: parsed.sceneType || parsed.scene_type || "",
    overallMood: parsed.overallMood || parsed.overall_mood || "",
    productPresentation: parsed.productPresentation || parsed.product_presentation || "",
    suggestedVideoStyle: parsed.suggestedVideoStyle || parsed.suggested_video_style || "",
  };
}

// ============================================================
// 数据分析
// ============================================================

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
