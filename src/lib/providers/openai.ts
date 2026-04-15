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
    cameraWork?: string;
    hookType?: string;
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

const CONTENT_SYSTEM_PROMPT_BASE = `You are an expert TikTok short-form video content strategist specializing in viral content for the North American / English-speaking market. Your task is to generate a complete TikTok video content plan based on a given keyword or product direction.

You MUST output strict JSON with these fields:
- script: English voiceover script for a 10-second TikTok video. Must include a powerful hook (first 2-3 seconds), engaging body, and a clear CTA. 40-80 words. Write in a casual, energetic, relatable tone that resonates with TikTok audiences. Use short punchy sentences.
- videoPrompt: A detailed, cinematic English video generation prompt (200-350 words) structured as follows:
  HOOK (first 2-3 seconds): An attention-grabbing opening shot — e.g. extreme close-up of fabric texture with slow pull-back, dramatic blanket toss in slow motion, satisfying unboxing reveal, or a relatable "before" moment (shivering, uncomfortable).
  SHOT SEQUENCE: Describe 5-7 distinct shots with specific camera movements (slow pan, macro close-up, overhead shot, tracking shot, pull-back reveal, dolly zoom). Include scene transitions. Specify lighting for each scene (golden hour glow, soft window light, warm lamp ambiance, candlelight).
  EMOTIONAL ARC: Build from curiosity/problem → discovery → desire → satisfaction → urgency. Include human interaction (hands touching fabric, wrapping up, expressing comfort, pet cuddling).
  VISUAL STYLE: Color grading direction (warm tones, cozy palette, cinematic look). Pacing rhythm (mix of slow satisfying reveals and quick lifestyle cuts). Aesthetic references (ASMR texture shots, lifestyle aspirational, cozy room tour, satisfying transformation).
  ENDING: A satisfying visual loop point or strong visual CTA moment.
- caption: English TikTok caption (15-40 words) with emotional hook and CTA. Must be scroll-stopping.
- hashtags: 6-10 English hashtags (array). Mix viral trending tags (#fyp #viral #cozy) with niche tags relevant to the content.
- contentAngles: 2-3 alternative content angle suggestions (array, each with "angle" and "reason" fields, in English)
- category: Content category in English (e.g. "Lifestyle", "Home & Living", "Cozy", "Pets", "Fashion", "Wellness")

Requirements:
1. Script must be optimized for a 10-second TikTok video
2. The first 2-3 seconds MUST hook the viewer — use curiosity gaps, visual shock, relatable pain points, or transformation teases
3. Content must trigger emotional response — comfort, desire, FOMO, satisfaction
4. The videoPrompt is THE MOST IMPORTANT field — it directly controls video quality. Be extremely specific and cinematic. Think like a director, not a copywriter.
5. Study what makes blanket/cozy/lifestyle TikToks go viral: satisfying textures, ASMR-like fabric shots, dramatic before/after (cold→warm), pet interactions, aesthetic room setups, slow-motion draping`;

const PRODUCT_SYSTEM_PROMPT_ADDON = `

[CRITICAL CONSTRAINT — Product-Driven Content]
You are creating promotional content for a specific blanket product. ALL outputs must revolve around the given product info:
- Script must naturally weave in the product's key selling points (material, texture, use cases) — show, don't tell
- videoPrompt MUST precisely describe the blanket's visual appearance (exact color/pattern, material texture, size impression) so the AI-generated video matches the real product. Be specific: "a luxuriously soft coconut cream flannel blanket with a velvety matte finish" NOT just "a blanket"
- Caption and hashtags must include product-relevant tags (#blanket #flannel #cozy #homedecor)
- The creative keyword sets the ANGLE and SCENE; the product info sets the HERO SUBJECT
- In the videoPrompt, the blanket must be the visual star — shown in multiple angles, textures, and lifestyle contexts`;

const TREND_SYSTEM_PROMPT_ADDON = `

[CRITICAL CONSTRAINT — Viral Style Matching]
You are referencing a viral TikTok video's style to generate content. You MUST:
- Replicate the reference video's narrative technique and pacing structure, but content must be original
- Adopt the same emotional tone and hook strategy (first 2-3 seconds)
- The videoPrompt's visual style, camera work, and energy level must closely mirror the reference analysis
- Learn from its success factors and apply them — don't copy the content, copy the FORMULA
- This is "creative inspiration" not "reposting" — final content must center on the given keyword/product`;

const MULTI_REFS_SYSTEM_PROMPT_ADDON = `

[CRITICAL CONSTRAINT — Multi-Viral Reference Fusion]
You are referencing multiple viral short videos to generate content. You MUST:
- Synthesize the common success patterns and style elements across all references
- Extract the best narrative techniques, emotional tones, hook strategies, and camera work
- The videoPrompt must fuse the most effective visual styles from the references — prioritize techniques from higher-view-count videos
- If references conflict in style, lean toward the one with more views/engagement
- This is "creative inspiration" not "reposting" — final content must be original and centered on the given keyword/product`;

function buildSystemPrompt(hasProduct: boolean, hasTrend: boolean, hasMultiRefs: boolean): string {
  let prompt = CONTENT_SYSTEM_PROMPT_BASE;
  if (hasProduct) prompt += PRODUCT_SYSTEM_PROMPT_ADDON;
  if (hasMultiRefs) prompt += MULTI_REFS_SYSTEM_PROMPT_ADDON;
  else if (hasTrend) prompt += TREND_SYSTEM_PROMPT_ADDON;
  return prompt;
}

function buildTrendBlock(t: TrendStyleContext): string {
  return `\nViral Reference Video Style Analysis:
- Original Title: ${t.originalTitle || "Unknown"}
- Narrative Technique: ${t.narrativeStyle}
- Emotional Tone: ${t.emotionalTone}
- Hook Strategy: ${t.hookStrategy}
- Content Structure: ${t.contentStructure}
- Visual Style: ${t.visualStyle}

Replicate this viral formula in your content — match the energy, pacing, and visual approach.`;
}

function buildMultiRefsBlock(refs: TrendReferenceContext[]): string {
  const blocks = refs.map((ref, i) => {
    const parts: string[] = [`Reference Video ${i + 1}${ref.platform ? ` (${ref.platform})` : ""}${ref.viewCount ? ` — ${ref.viewCount.toLocaleString()} views` : ""}:`];
    if (ref.title) parts.push(`  Title: ${ref.title}`);
    if (ref.styleAnalysis) {
      const s = ref.styleAnalysis;
      parts.push(`  Narrative Technique: ${s.narrativeStyle}`);
      parts.push(`  Emotional Tone: ${s.emotionalTone}`);
      parts.push(`  Hook Strategy: ${s.hookStrategy}`);
      parts.push(`  Content Structure: ${s.contentStructure}`);
      parts.push(`  Visual Style: ${s.visualStyle}`);
      if (s.cameraWork) parts.push(`  Camera Work & Editing: ${s.cameraWork}`);
      if (s.hookType) parts.push(`  Hook Type: ${s.hookType}`);
    }
    if (ref.visualAnalysis) {
      const v = ref.visualAnalysis;
      parts.push(`  Color Palette: ${v.colorPalette}`);
      parts.push(`  Overall Mood: ${v.overallMood}`);
      if (v.sceneType) parts.push(`  Scene Type: ${v.sceneType}`);
      if (v.lightingStyle) parts.push(`  Lighting: ${v.lightingStyle}`);
      parts.push(`  Suggested Video Style: ${v.suggestedVideoStyle}`);
    }
    return parts.join("\n");
  });

  return `\n\nViral Video Reference Analysis (${refs.length} video${refs.length > 1 ? "s" : ""}):\n${blocks.join("\n\n")}\n\nSynthesize the winning formula from these viral references into your content. Match their energy, visual techniques, and pacing.`;
}

function buildUserMessage(input: ContentGenerationInput): string {
  const trendBlock = input.trendReferences?.length
    ? buildMultiRefsBlock(input.trendReferences)
    : input.trendStyle
      ? buildTrendBlock(input.trendStyle)
      : "";

  if (input.productContext) {
    const p = input.productContext;
    const productLine = p.productLine === "sherpa"
      ? "Sherpa Reversible Blanket (flannel + sherpa fleece)"
      : "Flannel Blanket";
    return `Product Information:
- Name: ${p.name}
- Product Line: ${productLine}
- Color/Pattern: ${p.color}
- Description: ${p.description}
- Key Features: ${p.features.join(", ")}
- Available Sizes: ${p.sizes.join(", ")}
${trendBlock}
Creative Direction Keyword: ${input.keyword}

Create a TikTok video content plan for this product using "${input.keyword}" as the creative angle. Target audience: English-speaking North American TikTok users. Output JSON only, no markdown code blocks.`;
  }

  return `Create a TikTok video content plan for the following keyword/direction:\n\nKeyword: ${input.keyword}${trendBlock}\n\nTarget audience: English-speaking North American TikTok users. Output JSON only, no markdown code blocks.`;
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
    max_tokens: 3500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty response");
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
    category: parsed.category || "Other",
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
  cameraWork: string;
  hookType: string;
  successFactors: string[];
  modelUsed: string;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

const VIRAL_ANALYSIS_SYSTEM_PROMPT = `You are an expert viral TikTok content analyst. Your task is to deeply analyze a viral video's success factors and content style based on its metadata (title, description, hashtags, engagement metrics).

You MUST output strict JSON with these fields:
- narrativeStyle: Narrative technique analysis (English, 50-100 words. e.g. "First-person experience sharing with rapid scene transitions", "Product reveal with lifestyle context switching")
- emotionalTone: Emotional tone (English, 30-50 words. e.g. "Warm and cozy with FOMO undertone", "Playful humor building to satisfying reveal", "Urgency-driven with aspirational lifestyle")
- hookStrategy: Opening hook strategy (English, 50-80 words. Analyze the first 2-3 seconds — what technique grabs attention? Visual shock? Curiosity gap? Relatable pain point? Satisfying texture?)
- contentStructure: Content structure (English, 50-80 words. e.g. "Pain point → Discovery → Product showcase with texture close-ups → Lifestyle transformation → CTA")
- visualStyle: Visual style description (English, 100-150 words. Describe the video's likely visual approach: camera movements, color grading, lighting style, shot composition, pacing rhythm, transition types, aesthetic category. Be extremely specific and actionable for AI video generation.)
- cameraWork: Camera work and editing analysis (English, 50-80 words. Describe likely camera movements — close-ups, slow pans, overhead shots, tracking shots, zoom transitions, slow motion moments, cut rhythm, and overall editing pace)
- hookType: Hook classification — pick ONE primary type: "curiosity_gap" | "visual_shock" | "relatable_pain_point" | "transformation_tease" | "satisfying_texture" | "emotional_trigger" | "trend_riding"
- successFactors: Success factor list (English string array, 3-5 items analyzing why this video likely went viral)

Base your analysis on the title, hashtags, and engagement data to infer content style. Provide professional, actionable insights.`;

export async function analyzeViralStyle(
  input: ViralAnalysisInput
): Promise<ViralStyleResult> {
  const metricsBlock = (input.viewCount || input.likeCount)
    ? `\nEngagement Metrics:
- Views: ${input.viewCount?.toLocaleString() ?? "unknown"}
- Likes: ${input.likeCount?.toLocaleString() ?? "unknown"}
- Comments: ${input.commentCount?.toLocaleString() ?? "unknown"}
- Shares: ${input.shareCount?.toLocaleString() ?? "unknown"}`
    : "";

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: VIRAL_ANALYSIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Analyze the following viral TikTok video's content style:

Title: ${input.title || "No title"}
Description: ${input.description || "No description"}
Hashtags: ${input.hashtags.length ? input.hashtags.join(" ") : "None"}
Author: ${input.authorName || "Unknown"}${metricsBlock}

Output JSON only, no markdown code blocks.`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.6,
    max_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI viral analysis returned empty");

  const parsed = JSON.parse(content);

  return {
    narrativeStyle: parsed.narrativeStyle || parsed.narrative_style || "",
    emotionalTone: parsed.emotionalTone || parsed.emotional_tone || "",
    hookStrategy: parsed.hookStrategy || parsed.hook_strategy || "",
    contentStructure: parsed.contentStructure || parsed.content_structure || "",
    visualStyle: parsed.visualStyle || parsed.visual_style || "",
    cameraWork: parsed.cameraWork || parsed.camera_work || "",
    hookType: parsed.hookType || parsed.hook_type || "",
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
