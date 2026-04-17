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

export interface ContentGenerationInput {
  keyword: string;
  brandContext?: BrandContext;
  referenceVisuals?: ReferenceVisualAnalysis;
  targetDuration?: number;
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

const CONTENT_SYSTEM_PROMPT_BASE = `You are an expert short-form video content strategist specializing in viral content for TikTok / Reels / Shorts. Your task is to generate a complete short video content plan optimized for high engagement, completion rate, and virality.

You MUST output strict JSON with these fields:
- script: English voiceover script for a 15-second short video. Energetic, fast-paced, and hook-driven. Open with a bold hook ("Stop scrolling!", "You NEED to see this!", "Wait until the end!"), pack in rapid-fire value or a compelling narrative, and end with an urgent CTA ("Follow for more!", "Save this!", "Link in bio!"). 60-100 words. Short punchy sentences. Power words allowed: "insane", "obsessed", "game-changer", "you won't believe".
- videoPrompt: A high-energy, fast-paced English video prompt (200-350 words). The video should feel like a viral short — whether it's product, lifestyle, educational, or narrative. Include the following:

  AUDIO DIRECTION: Specify energetic English voiceover style matching the script's tone and pace. Include background music direction (upbeat, trending beats, bass drops on key beats).

  HOOK (first 2-3 seconds): Immediate visual impact — dramatic reveal, visual shock, curiosity gap, or bold text overlay. NO slow builds. Grab attention INSTANTLY.

  SHOT SEQUENCE (5-8 rapid shots, average 1.5-2 seconds each):
  - Use FAST cuts, quick transitions
  - Mix wide lifestyle shots, close-ups, hands-on demos, dramatic reveals, before/after
  - Camera movements: quick zooms, snap transitions, whip pans, dynamic angles
  - Each shot conveys ONE idea in under 2 seconds

  ENERGY & PACING: Fast, punchy, rhythmic. Cut on the beat. No lingering shots. Build toward the CTA.

  VISUAL STYLE: High contrast, vibrant, clean. Mix polished shots with real-life scenes. Use text overlays for key points. Modern short-form aesthetic.

  ENDING: Urgent CTA, payoff moment, or satisfying compilation.

  IMPORTANT: Seedance 2.0 supports native audio generation. Your videoPrompt MUST include audio direction: specify "energetic male/female English voiceover" narrating the script, and "upbeat trending background music with bass drops on transitions".

- caption: English caption (15-40 words) with emotional hook and CTA. Scroll-stopping. Urgency/FOMO welcome.
- hashtags: 6-10 English hashtags (array). Mix viral tags (#fyp #viral #trending) with niche tags relevant to the content.
- contentAngles: 2-3 alternative content angle suggestions (array, each with "angle" and "reason" fields, in English)
- category: Content category in English (e.g. "Product Ad", "Home & Living", "Lifestyle", "Pets", "Fashion", "Wellness", "Education", "Storytelling")

Requirements:
1. Script must be optimized for a 15-second short video
2. The first 2-3 seconds MUST hook the viewer — curiosity gaps, visual shock, relatable pain points, or transformation teases
3. Content must trigger curiosity, desire, or emotional response
4. videoPrompt is THE MOST IMPORTANT field — it directly controls video quality. Be extremely specific about shot sequence, camera movement, pacing, and audio. Think like a director shooting a 15-second commercial.
5. Study what makes shorts go viral: fast cuts, energetic voiceover, dramatic reveals, before/after, rapid-fire points, beat-synced transitions, text overlay callouts, urgent CTAs.`;

const BRAND_CONTEXT_ADDON = `

[BRAND / PRODUCT CONTEXT — user-provided description]
The user provided free-form text describing their brand, product, or scene context. Use this information to:
- Ensure the script and videoPrompt revolve around what they're actually promoting or showcasing
- Weave the key attributes described by the user into the visual direction naturally
- Make the video feel tailored to their specific brand/product/scene, not generic

Treat the description as the authoritative source of truth. Do NOT invent attributes that are not implied by either the description or the creative keyword.`;

const EXTENDED_DURATION_ADDON = `

[EXTENDED VIDEO — TWO-PART GENERATION]
The user wants a 30-second video. Since the AI video generator can only produce 15 seconds at a time, you MUST output TWO separate videoPrompts that form one continuous narrative:

- videoPrompt: Part 1 (first 15 seconds) — the HOOK + initial showcase + rapid selling points. End on a visually distinctive moment that can serve as a transition point.
- videoPromptPart2: Part 2 (seconds 15-30) — continuation with lifestyle demos, before/after, social proof, and the big CTA finale. Start by describing "Continue from the previous scene..." to ensure visual continuity.

Both parts MUST share the same audio direction, visual style, and energy level. The 30-second ad should feel like ONE seamless video.

Script should be 120-200 words (for 30 seconds of voiceover).

IMPORTANT: Both videoPrompt and videoPromptPart2 must each be 200-350 words and include their own AUDIO DIRECTION section.`;

const REFERENCE_VISUALS_ADDON = `

[VISUAL REFERENCE — AI-Analyzed from uploaded reference images]
You have been given an AI vision analysis of the user's uploaded reference images (product shots, scene references, brand visuals, etc). Use these EXACT visual details in your videoPrompt:
- Describe the REAL appearance, colors, and materials as analyzed
- Reference actual brand/logo elements if visible
- Use the suggested camera angles for the shot sequence
- Highlight the visual features the analysis identified as most striking

The videoPrompt MUST feel like it was written by someone who has SEEN the actual references.`;

function buildSystemPrompt(hasBrand: boolean, isExtended: boolean, hasVisuals: boolean): string {
  let prompt = CONTENT_SYSTEM_PROMPT_BASE;
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

const REFERENCE_VISION_PROMPT = `You are a visual reference analyst for short-video ad creation. Analyze the provided reference image(s) — which may include product shots, scene references, brand visuals, or lifestyle images — and extract visual details that will help an AI video generator create compelling content.

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
