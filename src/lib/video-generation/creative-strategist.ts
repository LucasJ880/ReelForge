/**
 * Phase 5 — Creative strategist.
 *
 * 输入：UnifiedVideoGenerationRequest + InputClassification
 * 输出：CreativeBrief（含 hook、narrative、target audience、selling points、CTA、optional variants）
 *
 * 路径：
 *  - isLLMForcedMock() / isLLMAvailable()==false → 用启发式（heuristic）从 rawPrompt 抽
 *  - 否则 → 调 chatJsonByTier({ tier: "creative" })
 *
 * 不直接抛 LLM 错误：失败时回退到启发式 brief（这部分只是 brief，不直接送 Seedance；
 * 即使 brief 略弱，prompt-intelligence 还会基于 brief + 时长 + 资产 再做一次结构化推断）。
 */

import { chatJsonByTier, isLLMAvailable, isLLMForcedMock } from "@/lib/ai";
import type {
  CreativeBrief,
  InputClassification,
  UnifiedVideoGenerationRequest,
  UploadedAsset,
} from "@/types/video-generation";
import { effectiveAssetRole } from "@/types/video-generation";

const CREATIVE_STRATEGIST_SYSTEM_PROMPT = `You are a short-form video creative strategist for TikTok / Instagram Reels / YouTube Shorts.

Given a user's raw idea and uploaded assets, produce a JSON CreativeBrief with this shape:

{
  "hook": "concrete visual moment for the first 2 seconds",
  "narrative": "1-2 sentences describing the storyline",
  "targetAudience": "specific audience description",
  "corePainPoint": "ONE concrete problem this video solves",
  "emotionalAngle": "the feeling the viewer walks away with",
  "keySellingPoints": ["..."],
  "cta": "CTA text or null for personal creators",
  "platformFit": "why this works on the target platform",
  "recommendedDurationReason": "why the selected duration is right",
  "angleVariants": [{ "title": "...", "hook": "...", "angle": "..." }]
}

HARD RULES:
1. Never use filler adjectives: amazing, revolutionary, premium, next-level, game-changing, perfect for everyone.
2. The hook MUST be a visual moment, not a tagline.
3. For business mode, produce 0 to 3 angleVariants (different ad directions); for personal mode, produce an empty array.
4. cta is required for business; null for personal.
5. Output JSON only — no markdown, no commentary.`;

export interface BuildCreativeBriefArgs {
  request: UnifiedVideoGenerationRequest;
  classification: InputClassification;
  classifiedAssets: UploadedAsset[];
}

export async function buildCreativeBrief(
  args: BuildCreativeBriefArgs,
): Promise<CreativeBrief> {
  if (isLLMForcedMock() || !isLLMAvailable()) {
    return heuristicBrief(args);
  }

  try {
    const userPrompt = buildUserPrompt(args);
    const { data } = await chatJsonByTier<unknown>({
      tier: "creative",
      stage: "unified_creative_brief",
      system: CREATIVE_STRATEGIST_SYSTEM_PROMPT,
      user: userPrompt,
      temperature: 0.7,
      maxTokens: 2000,
    });
    return coerceBrief(data, args);
  } catch (err) {
    console.warn(
      "[creative-strategist] LLM failed, falling back to heuristic:",
      (err as Error).message,
    );
    return heuristicBrief(args);
  }
}

function buildUserPrompt(args: BuildCreativeBriefArgs): string {
  const assetSummary = args.classifiedAssets
    .map(
      (a) =>
        `  - ${effectiveAssetRole(a)} (${a.type}, ${a.fileName}${
          a.durationSeconds ? `, ${a.durationSeconds}s` : ""
        })`,
    )
    .join("\n");

  return `# User intent
user_type: ${args.request.userType}
raw_prompt: ${args.request.rawPrompt}
selected_duration: ${args.request.selectedDuration}s
aspect_ratio: ${args.request.selectedAspectRatio}
brand_ending_mode: ${args.request.selectedBrandEndingMode}
cta: ${args.request.cta ?? "(none)"}
platform: ${args.classification.targetPlatform}

# Brand kit
${JSON.stringify(args.request.brandKit ?? {}, null, 2)}

# Uploaded assets
${assetSummary || "  (none)"}

# Classifier signals
generation_mode: ${args.classification.generationMode}
video_goal: ${args.classification.videoGoal}
needs_cta: ${args.classification.needsCTA}
needs_brand_packaging: ${args.classification.needsBrandPackaging}
needs_user_clip_insertion: ${args.classification.needsUserClipInsertion}

Return a CreativeBrief JSON now.`;
}

function coerceBrief(
  raw: unknown,
  args: BuildCreativeBriefArgs,
): CreativeBrief {
  const isBusiness = args.request.userType !== "personal";
  const obj = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {});

  const get = (k: string): string => (typeof obj[k] === "string" ? (obj[k] as string) : "");

  return {
    hook: get("hook") || extractFirstSentence(args.request.rawPrompt),
    narrative: get("narrative") || args.request.rawPrompt,
    targetAudience:
      get("targetAudience") ||
      (isBusiness ? "Target customers for this product or service" : "Personal audience"),
    corePainPoint:
      get("corePainPoint") || "The problem this content addresses",
    emotionalAngle: get("emotionalAngle") || "Engaging and authentic",
    keySellingPoints: Array.isArray(obj.keySellingPoints)
      ? (obj.keySellingPoints as unknown[]).filter((x) => typeof x === "string").slice(0, 5).map(String)
      : [],
    cta: isBusiness ? get("cta") || args.request.cta || "Tap to learn more" : null,
    platformFit:
      get("platformFit") ||
      `Suited for ${args.classification.targetPlatform} ${args.request.selectedAspectRatio}.`,
    recommendedDurationReason:
      get("recommendedDurationReason") ||
      `${args.request.selectedDuration}s gives enough room for hook + payoff.`,
    angleVariants:
      isBusiness && Array.isArray(obj.angleVariants)
        ? (obj.angleVariants as unknown[])
            .filter((x) => x && typeof x === "object")
            .slice(0, 3)
            .map((v) => {
              const vv = v as Record<string, unknown>;
              return {
                title: typeof vv.title === "string" ? vv.title : "Untitled angle",
                hook: typeof vv.hook === "string" ? vv.hook : "",
                angle: typeof vv.angle === "string" ? vv.angle : "",
              };
            })
        : [],
  };
}

/**
 * 启发式（无 LLM 时使用）：
 * - hook = 用户 prompt 的第一句
 * - narrative = 整段 prompt
 * - 其它字段填合理默认
 */
export function heuristicBrief(args: BuildCreativeBriefArgs): CreativeBrief {
  const isBusiness = args.request.userType !== "personal";
  const hook = extractFirstSentence(args.request.rawPrompt);
  const productHint =
    args.classifiedAssets.find((a) => effectiveAssetRole(a) === "product_image")?.fileName ??
    args.request.brandKit?.brandName ??
    "your product";

  const sellingPoints: string[] = isBusiness
    ? [
        `Concrete visual of ${productHint} in use`,
        "Authentic, not staged",
        "Mobile-first vertical framing",
      ]
    : [];

  return {
    hook: hook || "Open with the strongest visual moment.",
    narrative: args.request.rawPrompt || "Tell the story in 1-2 simple beats.",
    targetAudience: isBusiness
      ? "Buyers who care about practical results"
      : "Friends and casual viewers",
    corePainPoint: isBusiness
      ? "Customers don't know if this product fits their daily life"
      : "Standard daily moments worth sharing",
    emotionalAngle: isBusiness ? "Confidence and clarity" : "Authentic and fun",
    keySellingPoints: sellingPoints,
    cta: isBusiness ? args.request.cta ?? "Tap to learn more" : null,
    platformFit: `${args.classification.targetPlatform} ${args.request.selectedAspectRatio}`,
    recommendedDurationReason: `${args.request.selectedDuration}s fits the hook + payoff pattern.`,
    angleVariants: [],
  };
}

function extractFirstSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(.+?[.!?。！？])\s/);
  if (match) return match[1].trim();
  // No sentence boundary — first 120 chars
  return trimmed.slice(0, 120);
}

export const __test__ = { heuristicBrief, extractFirstSentence };
