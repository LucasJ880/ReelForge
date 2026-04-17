import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * 品牌/产品上下文 —— 用户自由填写的纯文本描述。
 * 不再耦合固定产品库。如果用户什么都不填，就走纯关键词创作模式。
 */
export interface BrandContext {
  description: string;
}

/**
 * 语气 —— 用户可显式选择创作调性。
 * "auto" = 让 AI 根据 subject 自己判断最合适的语气
 */
export type ContentTone =
  | "auto"
  | "promo"       // 带货 / 产品广告
  | "narrative"   // 故事叙述
  | "educational" // 教程 / 科普
  | "vlog"        // Vlog / 日常记录
  | "news"        // 资讯 / 新闻口播
  | "humor"       // 搞笑 / 段子
  | "cinematic"   // 电影感 / 氛围片
  | "testimonial";// 测评 / 开箱

/**
 * 语言 —— 脚本和视频中 voiceover 使用的语言。
 */
export type ContentLanguage =
  | "auto"
  | "en"  // English
  | "zh"  // 中文
  | "ja"  // 日本語
  | "ko"  // 한국어
  | "es"  // Español
  | "fr"  // Français
  | "de"; // Deutsch

export interface ContentGenerationInput {
  keyword: string;
  brandContext?: BrandContext;
  referenceVisuals?: ReferenceVisualAnalysis;
  targetDuration?: number;
  tone?: ContentTone;
  language?: ContentLanguage;
}

export interface ContentGenerationResult {
  script: string;
  videoPrompt: string;
  videoPromptPart2?: string;
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

const TONE_INSTRUCTIONS: Record<Exclude<ContentTone, "auto">, string> = {
  promo:
    "Tone: PROMOTIONAL / PRODUCT AD. Energetic, persuasive, selling-point driven. Hooks and CTAs are welcome. Fast cuts, text overlays with key features, urgent calls to action.",
  narrative:
    "Tone: NARRATIVE / STORYTELLING. A short emotional or thought-provoking story. Quiet opening is fine; build tension and end on a meaningful beat. Speak like a narrator, NOT a salesperson.",
  educational:
    "Tone: EDUCATIONAL / EXPLAINER. Clear, informative, confident. Lead with a useful insight or a question. Explain like a teacher — NO sales language, NO hype words. Facts and clarity matter more than energy.",
  vlog:
    "Tone: VLOG / CASUAL LIFESTYLE. First-person, conversational, natural pacing. Feels like you're sharing something with a friend. No marketing energy.",
  news:
    "Tone: NEWS / INFORMATIONAL. Neutral, factual, professional voiceover. Straightforward reporting structure. No slang, no sales pitch, no hype words.",
  humor:
    "Tone: HUMOROUS / COMEDIC. Witty, playful, punchline-driven. Timing matters. Can be absurdist, self-aware, or use relatable irony. Avoid heavy-handed selling.",
  cinematic:
    "Tone: CINEMATIC / ATMOSPHERIC. Poetic, mood-first, visual-forward. Slow builds, ambient sound design, sparse or contemplative narration are welcome. Prioritize atmosphere over information density.",
  testimonial:
    "Tone: TESTIMONIAL / HONEST REVIEW. First-person evaluative voice. Mix pros and cons, be authentic. Credibility > excitement.",
};

const LANGUAGE_NAMES: Record<Exclude<ContentLanguage, "auto">, string> = {
  en: "English",
  zh: "Simplified Chinese (简体中文)",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  es: "Spanish (Español)",
  fr: "French (Français)",
  de: "German (Deutsch)",
};

const CONTENT_SYSTEM_PROMPT_BASE = `You are a short-form video scriptwriter and director for platforms like TikTok, Instagram Reels, and YouTube Shorts. Your job is to produce a complete content plan for ONE short video.

You are neutral and adaptive — the TONE, STYLE, and PACING of the video should be determined by the subject, the user's creative keyword, and any explicit tone instruction provided. You are NOT a marketing copywriter by default. Do NOT inject sales language, hype words, or urgent CTAs unless the subject or tone clearly calls for it.

Output STRICT JSON with these fields:

- script: The spoken voiceover / on-screen narration for the video. Natural, flowing, and appropriate to the subject. No markdown, no stage directions (no "voiceover:", no "narrator:"), no meta commentary. Just the words to be spoken. Length should match the target duration at a normal speaking pace (roughly 2.5 words per second). DO NOT start with filler like "welcome to this video" or "in this video we will".

- videoPrompt: A detailed English director's prompt for an AI video generator (200-350 words). Describe the SHOT SEQUENCE, VISUAL STYLE, CAMERA MOVEMENT, LIGHTING, and AUDIO DIRECTION. Match the tone of the subject — a cinematic landscape short gets long lingering shots and ambient music; a comedy bit gets snappy cuts; an educational explainer gets clean compositions with text overlays; a product ad gets rapid cuts and demo shots. Adapt. DO NOT default to "fast cuts + energetic voiceover + bass drops" unless the tone calls for it.

  AUDIO DIRECTION: Always specify (a) voiceover gender/tone matching the script's mood, (b) background music direction matching the video's mood — this can be ambient, cinematic, lo-fi, upbeat, dramatic, minimal, or none at all.

  IMPORTANT: Seedance 2.0 supports native audio generation; the videoPrompt MUST include an explicit AUDIO DIRECTION section so the generated clip has synchronized sound.

- caption: A platform caption (15-40 words) in the SAME language as the script. Style matches the tone — informative for educational, punchy for promo, reflective for narrative, etc.

- hashtags: 6-10 relevant hashtags (array of strings). Mix broad discovery tags with niche topic tags. Do not force #fyp #viral style tags unless appropriate to the content.

- contentAngles: 2-3 alternative angle suggestions (array, each with "angle" and "reason" fields), in English.

- category: A short English content category label (e.g. "Education", "Storytelling", "Product Ad", "Vlog", "Lifestyle", "Travel", "Food", "Tech Review", "Pets", "Wellness", "News", "Comedy", "Cinematic").

Requirements:
1. The first 2-3 seconds should be compelling for the subject — this does NOT always mean shouting a hook; a striking visual, intriguing line, or atmospheric opening all count.
2. Adapt the density, pacing, and language to the subject. A philosophical short and a 15s product ad should NOT read the same.
3. videoPrompt is the most important field — it directly drives video quality. Be specific about composition and motion, but faithful to the chosen tone.
4. Never invent facts or claims that are not implied by the user input.
5. Output JSON only. No markdown fences, no commentary outside the JSON.`;

const BRAND_CONTEXT_ADDON = `

[BRAND / PRODUCT / SCENE CONTEXT — user-provided free-text description]
The user provided background text describing their brand, product, scene, or subject matter. Treat this as the authoritative source of truth about what's being depicted. Weave its key attributes into the script and videoPrompt naturally. Do NOT invent attributes beyond what's stated or clearly implied by it and the creative keyword.`;

const EXTENDED_DURATION_ADDON = `

[EXTENDED VIDEO — TWO-PART GENERATION]
The user wants a video longer than 15 seconds. Since the AI video generator produces up to 15s per clip, output TWO videoPrompts that form ONE continuous piece:

- videoPrompt: Part 1 (first 15 seconds) — the opening + initial development. End on a visually distinctive moment that serves as a natural transition.
- videoPromptPart2: Part 2 (seconds 15 onward) — the continuation and resolution. Start with "Continue from the previous scene..." to ensure visual continuity.

Both parts MUST share the same tone, visual style, lighting, color palette, and audio direction — the final video should feel like ONE seamless piece. Adjust the script length to match the target duration at ~2.5 words/sec.

Both videoPrompt and videoPromptPart2 must each be 200-350 words and include their own AUDIO DIRECTION section.`;

const REFERENCE_VISUALS_ADDON = `

[VISUAL REFERENCE — AI-Analyzed from uploaded reference images]
You have been given an AI vision analysis of the user's uploaded reference images (product shots, scene references, brand visuals, etc). Use these EXACT visual details in your videoPrompt:
- Describe the REAL appearance, colors, and materials as analyzed
- Reference actual brand/logo elements if visible
- Use the suggested camera angles for the shot sequence
- Highlight the visual features the analysis identified as most striking

The videoPrompt MUST feel like it was written by someone who has SEEN the actual references.`;

function buildToneAddon(tone: ContentTone | undefined): string {
  if (!tone || tone === "auto") {
    return `

[TONE]
No explicit tone was chosen by the user. Infer the most appropriate tone from the subject and keyword. If the subject is clearly a product, lean promo/testimonial. If it's a piece of information, lean educational/news. If it's a story, lean narrative/cinematic. If it's a personal moment, lean vlog. Pick ONE tone and commit to it consistently across script, videoPrompt, caption.`;
  }
  return `

[TONE — REQUIRED]
${TONE_INSTRUCTIONS[tone]}
Commit to this tone consistently across script, videoPrompt, caption, and hashtags.`;
}

function buildLanguageAddon(language: ContentLanguage | undefined): string {
  if (!language || language === "auto") {
    return `

[LANGUAGE]
No explicit output language was chosen. Infer language from the keyword / brand context (if the user writes in Chinese, output script/caption in Chinese; if in English, output in English; and so on). The videoPrompt itself must ALWAYS be written in English (it's a director prompt for the video model), but its AUDIO DIRECTION must specify voiceover in the inferred output language.`;
  }
  const name = LANGUAGE_NAMES[language];
  return `

[LANGUAGE — REQUIRED]
The script and caption MUST be written in ${name}.
The videoPrompt itself MUST be written in English (it's a director prompt for the video model), but its AUDIO DIRECTION section MUST specify the voiceover in ${name}.
Hashtags may stay in English for discoverability unless ${name} hashtags are clearly more natural for the subject.`;
}

function buildSystemPrompt(
  hasBrand: boolean,
  isExtended: boolean,
  hasVisuals: boolean,
  tone: ContentTone | undefined,
  language: ContentLanguage | undefined,
): string {
  let prompt = CONTENT_SYSTEM_PROMPT_BASE;
  prompt += buildToneAddon(tone);
  prompt += buildLanguageAddon(language);
  if (hasBrand) prompt += BRAND_CONTEXT_ADDON;
  if (hasVisuals) prompt += REFERENCE_VISUALS_ADDON;
  if (isExtended) prompt += EXTENDED_DURATION_ADDON;
  return prompt;
}

function buildUserMessage(input: ContentGenerationInput): string {
  const visualBlock = input.referenceVisuals
    ? `\n\nVisual Reference Analysis (from uploaded images):
- Appearance: ${input.referenceVisuals.productAppearance}
- Colors & Materials: ${input.referenceVisuals.colorsAndMaterials}
- Brand Elements: ${input.referenceVisuals.brandElements}
- Best Camera Angles: ${input.referenceVisuals.suggestedAngles}
- Visual Highlights: ${input.referenceVisuals.visualHighlights}`
    : "";

  if (input.brandContext?.description?.trim()) {
    return `Brand / Product / Scene Context (user-provided):
${input.brandContext.description.trim()}
${visualBlock}

Creative Direction Keyword: ${input.keyword}

Create a short video content plan using "${input.keyword}" as the creative angle. Output JSON only, no markdown code blocks.`;
  }

  return `Create a short video content plan for the following keyword/direction:

Keyword: ${input.keyword}
${visualBlock}

Output JSON only, no markdown code blocks.`;
}

export async function generateContent(
  input: ContentGenerationInput
): Promise<ContentGenerationResult> {
  const isExtended = (input.targetDuration || 15) > 15;
  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(
          !!input.brandContext?.description?.trim(),
          isExtended,
          !!input.referenceVisuals,
          input.tone,
          input.language,
        ),
      },
      { role: "user", content: buildUserMessage(input) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
    max_tokens: isExtended ? 5000 : 3500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty response");
  }

  const parsed = JSON.parse(content);

  function flattenToString(val: unknown): string {
    if (typeof val === "string") return val;
    if (val && typeof val === "object") {
      return Object.entries(val as Record<string, unknown>)
        .map(([k, v]) => `[${k}]\n${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("\n\n");
    }
    return String(val ?? "");
  }

  const rawVP = parsed.videoPrompt || parsed.video_prompt;
  const videoPrompt = flattenToString(rawVP);

  let videoPromptPart2: string | undefined;
  if (isExtended) {
    const rawVP2 = parsed.videoPromptPart2 || parsed.video_prompt_part2;
    videoPromptPart2 = rawVP2 ? flattenToString(rawVP2) : undefined;
  }

  return {
    script: parsed.script || "",
    videoPrompt,
    videoPromptPart2,
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
// Reference Image Vision Analysis (GPT-4o)
//   通用化：不再要求"产品"，任何用户上传的参考图都能分析
// ============================================================

export interface ReferenceVisualAnalysis {
  productAppearance: string;
  colorsAndMaterials: string;
  brandElements: string;
  suggestedAngles: string;
  visualHighlights: string;
}

const REFERENCE_VISION_PROMPT = `You are a visual reference analyst for short video creation (any genre — product, lifestyle, travel, education, narrative, etc.). Analyze the provided reference image(s) and extract visual details that will help an AI video generator create compelling content. Stay neutral about genre; describe what you see.

Output STRICT JSON with these fields:
- productAppearance: Detailed physical description of the main subject (shape, size impression, texture, design elements) in English, 50-100 words. If there's no clear product, describe the dominant visual element or scene.
- colorsAndMaterials: Exact colors (use descriptive color names like "deep navy blue" not just "blue"), materials, finishes, patterns visible.
- brandElements: Any visible logos, text, labels, packaging branding, tags (empty string if none).
- suggestedAngles: Best camera angles and shot types for showcasing this subject in a video (e.g. "dramatic overhead reveal", "close-up texture shot", "lifestyle flat-lay").
- visualHighlights: The most visually striking features that should be emphasized in a video (e.g. "shimmering texture catches light beautifully", "bold color contrast between two sides").`;

export async function analyzeReferenceImages(
  imageUrls: string[],
): Promise<ReferenceVisualAnalysis> {
  const visionModel = "gpt-4o";

  const imageContent = imageUrls.slice(0, 5).map((url) => ({
    type: "image_url" as const,
    image_url: { url, detail: "low" as const },
  }));

  const response = await openai.chat.completions.create({
    model: visionModel,
    messages: [
      { role: "system", content: REFERENCE_VISION_PROMPT },
      {
        role: "user",
        content: [
          ...imageContent,
          { type: "text", text: "Analyze these reference image(s) for short video creation." },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Vision analysis returned empty response");

  const parsed = JSON.parse(content);
  return {
    productAppearance: parsed.productAppearance || parsed.product_appearance || "",
    colorsAndMaterials: parsed.colorsAndMaterials || parsed.colors_and_materials || "",
    brandElements: parsed.brandElements || parsed.brand_elements || "",
    suggestedAngles: parsed.suggestedAngles || parsed.suggested_angles || "",
    visualHighlights: parsed.visualHighlights || parsed.visual_highlights || "",
  };
}
