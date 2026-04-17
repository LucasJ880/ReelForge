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
  productVisuals?: ProductVisualAnalysis;
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

const CONTENT_SYSTEM_PROMPT_BASE = `You are an expert short-form video content strategist specializing in viral PRODUCT ADVERTISEMENT content for the North American / English-speaking market. Your task is to generate a complete short video content plan that feels like a high-energy viral product ad.

You MUST output strict JSON with these fields:
- script: English voiceover script for a 15-second product ad. MUST sound like an enthusiastic product pitch — energetic, fast-paced, persuasive. Include a bold hook ("You NEED this!", "Stop scrolling!", "This blanket broke the internet!"), rapid-fire selling points, and an urgent CTA ("Link in bio!", "Don't miss out!"). 60-100 words. Think: live shopping seller energy. Short punchy exclamations. Use power words: "insane", "obsessed", "game-changer", "you won't believe", "sold out 3 times".
- videoPrompt: A high-energy, fast-paced English product advertisement video prompt (200-350 words). The video MUST feel like a viral product ad — think "as seen on TV" energy meets short video style. Include the following:

  AUDIO DIRECTION: Specify energetic English voiceover narration style — enthusiastic, fast-talking product pitch voice (like a live shopping seller). The narration should match the script's energy and timing. Include background music direction (upbeat, trending beats, bass drops on key moments).

  HOOK (first 2-3 seconds): Immediate visual impact — dramatic product reveal, eye-catching transformation, or a bold text overlay with shocking claim. NO slow builds. Grab attention INSTANTLY.

  SHOT SEQUENCE (5-8 rapid shots, average 1.5-2 seconds each):
  - Use FAST cuts, NOT slow pans. Quick transitions between scenes.
  - Alternate between: extreme close-ups (texture/detail), wide lifestyle shots, hands-on demos, dramatic reveals, before/after comparisons
  - Camera movements: quick zooms, snap transitions, whip pans, dynamic angles (low angle hero shots, top-down product displays)
  - Each shot should convey ONE selling point in under 2 seconds

  ENERGY & PACING: Fast, punchy, rhythmic. Cut on the beat. No lingering shots longer than 2 seconds. Build momentum toward the CTA. Think: infomercial energy + short video speed + Instagram Reel polish.

  VISUAL STYLE: High contrast, vibrant colors, clean product shots. Mix studio-quality product close-ups with real-life lifestyle scenes. Use text overlays for key selling points. Bold, modern aesthetic.

  ENDING: Urgent CTA — "Link in bio!", price flash, limited time offer vibe, or satisfying product compilation montage.

  IMPORTANT: Seedance 2.0 supports native audio generation. Your videoPrompt MUST include audio direction: specify "energetic male/female English voiceover" narrating the product pitch, and "upbeat trending background music with bass drops on transitions". The AI will generate audio synchronized with the video.

- caption: English caption (15-40 words) with emotional hook and CTA. Must be scroll-stopping. Use urgency and FOMO.
- hashtags: 6-10 English hashtags (array). Mix viral trending tags (#fyp #viral #tiktokmademebuyit) with niche tags relevant to the content.
- contentAngles: 2-3 alternative content angle suggestions (array, each with "angle" and "reason" fields, in English)
- category: Content category in English (e.g. "Product Ad", "Home & Living", "Lifestyle", "Pets", "Fashion", "Wellness")

Requirements:
1. Script must be optimized for a 15-second short video
2. The first 2-3 seconds MUST hook the viewer — use curiosity gaps, visual shock, relatable pain points, or transformation teases
3. Content must trigger FOMO, desire, and urgency — this is a PRODUCT AD, not a mood video
4. The videoPrompt is THE MOST IMPORTANT field — it directly controls video quality. Be extremely specific about shot sequence, camera movement, pacing, and audio. Think like an ad director shooting a 15-second commercial.
5. Study what makes product short videos go viral: fast cuts, energetic voiceover, dramatic reveals, before/after transformations, rapid-fire selling points, "as seen on TV" energy, live-selling style, beat-synced transitions, text overlay callouts ("50% OFF!", "SOLD OUT 3X!"), and urgent CTAs`;

const PRODUCT_SYSTEM_PROMPT_ADDON = `

[CRITICAL CONSTRAINT — Product-Driven Content]
You are creating promotional content for a specific product. ALL outputs must revolve around the given product info:
- Script must naturally weave in the product's key selling points (material, texture, use cases) — show, don't tell
- videoPrompt MUST precisely describe the product's visual appearance (exact color/pattern, material texture, size impression) so the AI-generated video matches the real product. Be specific: "a luxuriously soft coconut cream flannel blanket with a velvety matte finish" NOT just "a blanket"
- Caption and hashtags must include product-relevant tags
- The creative keyword sets the ANGLE and SCENE; the product info sets the HERO SUBJECT
- In the videoPrompt, the product must be the visual star — shown in multiple angles, textures, and lifestyle contexts`;

const EXTENDED_DURATION_ADDON = `

[EXTENDED VIDEO — TWO-PART GENERATION]
The user wants a 30-second video. Since the AI video generator can only produce 15 seconds at a time, you MUST output TWO separate videoPrompts that form one continuous narrative:

- videoPrompt: Part 1 (first 15 seconds) — the HOOK + initial product showcase + rapid selling points. End on a visually distinctive moment that can serve as a transition point.
- videoPromptPart2: Part 2 (seconds 15-30) — continuation with lifestyle demos, before/after, social proof, and the big CTA finale. Start by describing "Continue from the previous scene..." to ensure visual continuity.

Both parts MUST share the same audio direction, visual style, and energy level. The 30-second ad should feel like ONE seamless video.

Script should be 120-200 words (for 30 seconds of voiceover).

IMPORTANT: Both videoPrompt and videoPromptPart2 must each be 200-350 words and include their own AUDIO DIRECTION section.`;

const PRODUCT_VISUALS_ADDON = `

[PRODUCT VISUAL REFERENCE — AI-Analyzed from uploaded product photos]
You have been given an AI vision analysis of the actual product photos. Use these EXACT visual details in your videoPrompt:
- Describe the product's REAL appearance, colors, and materials as analyzed
- Reference the actual brand elements visible on the product
- Use the suggested camera angles for the shot sequence
- Highlight the visual features that the analysis identified as most striking

The videoPrompt MUST feel like it was written by someone who has SEEN the actual product, not a generic description.`;

function buildSystemPrompt(hasProduct: boolean, isExtended: boolean, hasVisuals: boolean): string {
  let prompt = CONTENT_SYSTEM_PROMPT_BASE;
  if (hasProduct) prompt += PRODUCT_SYSTEM_PROMPT_ADDON;
  if (hasVisuals) prompt += PRODUCT_VISUALS_ADDON;
  if (isExtended) prompt += EXTENDED_DURATION_ADDON;
  return prompt;
}

function buildUserMessage(input: ContentGenerationInput): string {
  const visualBlock = input.productVisuals
    ? `\n\nProduct Visual Analysis (from uploaded product photos):
- Appearance: ${input.productVisuals.productAppearance}
- Colors & Materials: ${input.productVisuals.colorsAndMaterials}
- Brand Elements: ${input.productVisuals.brandElements}
- Best Camera Angles: ${input.productVisuals.suggestedAngles}
- Visual Highlights: ${input.productVisuals.visualHighlights}`
    : "";

  if (input.productContext) {
    const p = input.productContext;
    return `Product Information:
- Name: ${p.name}
- Product Line: ${p.productLine}
- Color/Pattern: ${p.color}
- Description: ${p.description}
- Key Features: ${p.features.join(", ")}
- Available Sizes: ${p.sizes.join(", ")}
${visualBlock}
Creative Direction Keyword: ${input.keyword}

Create a short video content plan for this product using "${input.keyword}" as the creative angle. Output JSON only, no markdown code blocks.`;
  }

  return `Create a short video content plan for the following keyword/direction:\n\nKeyword: ${input.keyword}\n\nOutput JSON only, no markdown code blocks.`;
}

export async function generateContent(
  input: ContentGenerationInput
): Promise<ContentGenerationResult> {
  const isExtended = (input.targetDuration || 15) > 15;
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: buildSystemPrompt(!!input.productContext, isExtended, !!input.productVisuals) },
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
// Product Image Vision Analysis (GPT-4o)
// ============================================================

export interface ProductVisualAnalysis {
  productAppearance: string;
  colorsAndMaterials: string;
  brandElements: string;
  suggestedAngles: string;
  visualHighlights: string;
}

const PRODUCT_VISION_PROMPT = `You are a product photography analyst for e-commerce video ads. Analyze the provided product image(s) and extract visual details that will help an AI video generator create compelling product advertisement videos.

Output STRICT JSON with these fields:
- productAppearance: Detailed physical description of the product (shape, size impression, texture, design elements) in English, 50-100 words
- colorsAndMaterials: Exact colors (use descriptive color names like "deep navy blue" not just "blue"), materials, finishes, patterns visible
- brandElements: Any visible logos, text, labels, packaging branding, tags
- suggestedAngles: Best camera angles and shot types for showcasing this product in a video ad (e.g. "dramatic overhead reveal", "close-up texture shot", "lifestyle flat-lay")
- visualHighlights: The most visually striking features that should be emphasized in a video ad (e.g. "the shimmering sherpa texture catches light beautifully", "bold color contrast between the two reversible sides")`;

export async function analyzeProductImages(
  imageUrls: string[],
): Promise<ProductVisualAnalysis> {
  const visionModel = "gpt-4o";

  const imageContent = imageUrls.slice(0, 5).map((url) => ({
    type: "image_url" as const,
    image_url: { url, detail: "low" as const },
  }));

  const response = await openai.chat.completions.create({
    model: visionModel,
    messages: [
      { role: "system", content: PRODUCT_VISION_PROMPT },
      {
        role: "user",
        content: [
          ...imageContent,
          { type: "text", text: "Analyze these product image(s) for video ad creation." },
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
