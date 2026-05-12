/**
 * Phase 5 — Prompt Intelligence Engine.
 *
 * 输入：CreativeBrief + UnifiedSegmentSlot[] + classifiedAssets + brandKit + classification
 * 输出：VideoSegment[]
 *
 * 路径：
 *  - isLLMForcedMock() / isLLMAvailable()==false → 启发式
 *  - 否则 → 调 chatJsonByTier(tier: "videoPrompt")；失败回退启发式
 *
 * 硬约束（不论 LLM / heuristic）：
 *  - prompt 不写 logo URL / 品牌名 / slogan / URL / QR / 精确 CTA 文本
 *  - negativePrompt 始终 append brand guard
 */

import { chatJsonByTier, isLLMAvailable, isLLMForcedMock } from "@/lib/providers/openai";
import { effectiveAssetRole } from "@/types/video-generation";
import type {
  AspectRatio,
  CreativeBrief,
  InputClassification,
  UploadedAsset,
  VideoSegment,
} from "@/types/video-generation";
import { resolutionForAspectRatio, type UnifiedSegmentSlot } from "@/lib/video-generation/segment-planner-adapter";

const SEEDANCE_BRAND_GUARD_RULE = `
ABSOLUTE BRAND CONSTRAINT (most important rule, never violate):
- DO NOT instruct the model to render exact logos, brand names, slogans, URLs, QR codes, promo text, CTA button text, or any specific on-screen text that must be precise.
- These are post-processed by Aivora's overlay layer, not by the AI video model.
- You MAY describe spatial regions that will receive overlays later (e.g., "leave a clean lower-third area for caption overlay").
- For end-card / CTA moments, focus on visual atmosphere, NOT the literal text.
- Negative prompts MUST include: "no logo, no brand text, no URLs, no readable text, no QR codes, no watermarks".
`.trim();

const PROMPT_INTELLIGENCE_SYSTEM_PROMPT = `You are an AI video prompt engineer for short-form ads.

Given a CreativeBrief and a list of segment slots (each with a role and duration), produce a JSON array of segment prompts:

[
  {
    "segmentOrder": 0,
    "seedancePrompt": "concrete, sensory description of what is on screen during this segment",
    "negativePrompt": "things to avoid",
    "cameraDirection": "static | dolly-in | handheld | tracking | overhead | crane",
    "visualDirection": "lighting + color grade + mood",
    "continuityNotes": "what visual elements must stay consistent with previous segment"
  }
]

PROMPT QUALITY RULES:
1. Each seedancePrompt MUST be specific: subject + setting + lighting + camera + texture + emotional cue.
2. Never use vague filler: amazing, revolutionary, premium, next-level, transform.
3. Each segment is at most 15 seconds; keep prompts tight.
4. Reference uploaded product images by saying "the uploaded product photo" — do NOT include URLs.

${SEEDANCE_BRAND_GUARD_RULE}

Output JSON only. Array length MUST match the number of segment slots provided.`;

const DEFAULT_NEGATIVE_PROMPT =
  "low quality, blurry, distorted hands, text artifacts, watermark, no logo, no brand text, no URLs, no readable text, no QR codes";

export interface BuildSegmentPromptsArgs {
  creativeBrief: CreativeBrief;
  segmentSlots: UnifiedSegmentSlot[];
  classifiedAssets: UploadedAsset[];
  classification: InputClassification;
  aspectRatio: AspectRatio;
}

export interface SegmentPromptResult {
  segmentOrder: number;
  seedancePrompt: string;
  negativePrompt: string;
  cameraDirection: string;
  visualDirection: string;
  continuityNotes: string;
}

/**
 * 主入口：生成所有 segment 的 prompt + 把每段映射成完整 VideoSegment[]。
 */
export async function buildVideoSegments(
  args: BuildSegmentPromptsArgs,
): Promise<VideoSegment[]> {
  const aiSlots = args.segmentSlots.filter((s) => s.source === "ai");

  const aiPrompts =
    aiSlots.length === 0
      ? []
      : isLLMForcedMock() || !isLLMAvailable()
        ? heuristicSegmentPrompts(args, aiSlots)
        : await tryLLMSegmentPrompts(args, aiSlots);

  const segments: VideoSegment[] = [];

  for (let idx = 0; idx < args.segmentSlots.length; idx++) {
    const slot = args.segmentSlots[idx];
    const sharedSpec = {
      aspectRatio: args.aspectRatio,
      resolution: resolutionForAspectRatio(args.aspectRatio),
    };

    if (slot.source === "uploaded") {
      segments.push({
        id: `seg_${idx}`,
        order: idx,
        type: "uploaded_clip",
        role: roleFromSlot(slot.role),
        durationSeconds:
          slot.durationSec ||
          estimateUploadedDuration(args, slot.uploadedAssetId ?? null),
        purpose: `Uploaded clip used at position ${idx} in the final video`,
        prompt: null,
        negativePrompt: null,
        sourceAssetIds: slot.uploadedAssetId ? [slot.uploadedAssetId] : [],
        uploadedAssetId: slot.uploadedAssetId ?? null,
        cameraDirection: null,
        visualDirection: null,
        outputSpec: sharedSpec,
      });
      continue;
    }

    if (slot.source === "brand_end_card") {
      segments.push({
        id: `seg_${idx}`,
        order: idx,
        type: "brand_end_card",
        role: "cta",
        durationSeconds: slot.durationSec,
        purpose:
          "Branded end card composited by Aivora (logo + CTA + brand text overlay)",
        prompt: null,
        negativePrompt: null,
        sourceAssetIds: [],
        uploadedAssetId: null,
        cameraDirection: null,
        visualDirection: null,
        outputSpec: sharedSpec,
      });
      continue;
    }

    /// AI segment — pick matching prompt row by aiSlots index
    const aiOrderInSlots = aiSlots.findIndex(
      (s) => s.segmentIndex === slot.segmentIndex,
    );
    const promptRow = aiOrderInSlots >= 0 ? aiPrompts[aiOrderInSlots] : undefined;
    segments.push({
      id: `seg_${idx}`,
      order: idx,
      type: "ai_generated_clip",
      role: roleFromSlot(slot.role),
      durationSeconds: slot.durationSec,
      purpose: descriptionForRole(slot.role, args.creativeBrief),
      prompt: promptRow?.seedancePrompt ?? heuristicSinglePrompt(slot, args),
      negativePrompt: promptRow?.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT,
      sourceAssetIds: relevantReferenceAssetIds(args),
      uploadedAssetId: null,
      cameraDirection: promptRow?.cameraDirection ?? "handheld",
      visualDirection: promptRow?.visualDirection ?? "warm natural light, real setting",
      outputSpec: sharedSpec,
    });
  }

  return segments;
}

async function tryLLMSegmentPrompts(
  args: BuildSegmentPromptsArgs,
  aiSlots: UnifiedSegmentSlot[],
): Promise<SegmentPromptResult[]> {
  try {
    const userPrompt = buildLLMUserPrompt(args, aiSlots);
    const { data } = await chatJsonByTier<unknown>({
      tier: "videoPrompt",
      stage: "unified_segment_prompts",
      system: PROMPT_INTELLIGENCE_SYSTEM_PROMPT,
      user: userPrompt,
      temperature: 0.7,
      maxTokens: 3000,
    });

    /// LLM 可能直接返回 array 也可能包裹在 { prompts: [...] }
    const arr = extractArray(data);
    if (!arr) {
      console.warn("[prompt-intelligence] LLM did not return array; falling back");
      return heuristicSegmentPrompts(args, aiSlots);
    }

    return aiSlots.map((slot, i) => {
      const raw = arr[i] && typeof arr[i] === "object" ? (arr[i] as Record<string, unknown>) : {};
      const seedancePrompt =
        typeof raw.seedancePrompt === "string" && raw.seedancePrompt.trim().length > 0
          ? raw.seedancePrompt
          : heuristicSinglePrompt(slot, args);
      return {
        segmentOrder: i,
        seedancePrompt,
        negativePrompt:
          typeof raw.negativePrompt === "string" && raw.negativePrompt.trim().length > 0
            ? appendBrandGuard(raw.negativePrompt)
            : DEFAULT_NEGATIVE_PROMPT,
        cameraDirection:
          typeof raw.cameraDirection === "string" ? raw.cameraDirection : "handheld",
        visualDirection:
          typeof raw.visualDirection === "string"
            ? raw.visualDirection
            : "warm natural light",
        continuityNotes:
          typeof raw.continuityNotes === "string" ? raw.continuityNotes : "",
      };
    });
  } catch (err) {
    console.warn(
      "[prompt-intelligence] LLM failed; falling back to heuristic:",
      (err as Error).message,
    );
    return heuristicSegmentPrompts(args, aiSlots);
  }
}

function extractArray(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.prompts)) return obj.prompts as unknown[];
    if (Array.isArray(obj.segments)) return obj.segments as unknown[];
  }
  return null;
}

function buildLLMUserPrompt(
  args: BuildSegmentPromptsArgs,
  aiSlots: UnifiedSegmentSlot[],
): string {
  const slotSummary = aiSlots
    .map(
      (s, i) =>
        `  - slot ${i}: role=${s.role} duration=${s.durationSec}s`,
    )
    .join("\n");

  const referenceAssets = args.classifiedAssets
    .filter((a) => {
      const r = effectiveAssetRole(a);
      return r === "product_image" || r === "reference_image";
    })
    .map((a) => `  - ${a.fileName} (${effectiveAssetRole(a)})`)
    .join("\n");

  return `# Creative brief
${JSON.stringify(args.creativeBrief, null, 2)}

# Segment slots to fill (return one entry per slot, in the same order)
${slotSummary}

# Reference assets (passed to Seedance as first-frame references; do NOT include URLs)
${referenceAssets || "  (none)"}

# Output spec
aspect_ratio: ${args.aspectRatio}
generation_mode: ${args.classification.generationMode}

Return a JSON array now.`;
}

/** 启发式 prompt 生成器 —— 无 LLM / mock / LLM 失败时使用 */
export function heuristicSegmentPrompts(
  args: BuildSegmentPromptsArgs,
  aiSlots: UnifiedSegmentSlot[],
): SegmentPromptResult[] {
  return aiSlots.map((slot, i) => ({
    segmentOrder: i,
    seedancePrompt: heuristicSinglePrompt(slot, args),
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    cameraDirection: i === 0 ? "slow dolly-in" : "handheld over-the-shoulder",
    visualDirection: "warm natural light, real setting, soft color grade",
    continuityNotes:
      i === 0 ? "Establish look and tone" : `Continue look from slot ${i - 1}`,
  }));
}

function heuristicSinglePrompt(
  slot: UnifiedSegmentSlot,
  args: BuildSegmentPromptsArgs,
): string {
  const productAsset = args.classifiedAssets.find(
    (a) => effectiveAssetRole(a) === "product_image",
  );
  const subject =
    productAsset?.fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]/g, " ") ??
    subjectFromBrief(args.creativeBrief);

  const orientation =
    args.aspectRatio === "9:16"
      ? "9:16 vertical"
      : args.aspectRatio === "16:9"
        ? "16:9 horizontal"
        : "1:1 square";

  switch (slot.role) {
    case "hook":
      return `${orientation} cinematic close-up that captures attention in the first 2 seconds. ${args.creativeBrief.hook} Real environment, warm natural light, shallow depth of field.`;
    case "demo":
      return `${orientation} clean demonstration of ${subject} in real use. Hands of a real person interacting naturally, eye-level handheld camera, soft daylight.`;
    case "lifestyle":
      return `${orientation} lifestyle moment featuring ${subject} integrated into a daily routine. Natural environment, candid framing, warm color grade.`;
    case "benefit":
      return `${orientation} visual proof of the core benefit: ${args.creativeBrief.corePainPoint}. Concrete, sensory, no taglines.`;
    case "cta":
      return `${orientation} clean closing shot with negative space on the right for caption overlay. Subject framed centrally, soft spotlight, calm energy.`;
    case "intro":
      return `${orientation} establishing shot setting the scene. Wide framing, gentle motion, warm light.`;
    default:
      return `${orientation} cinematic shot of ${subject}, real setting, warm light.`;
  }
}

function subjectFromBrief(brief: CreativeBrief): string {
  if (brief.keySellingPoints.length > 0) {
    return brief.keySellingPoints[0];
  }
  return "the product";
}

function appendBrandGuard(negative: string): string {
  if (negative.toLowerCase().includes("no logo")) return negative;
  const guard = "no logo, no brand text, no URLs, no readable text, no QR codes";
  return `${negative.trim().replace(/[,\s]+$/, "")}, ${guard}`;
}

function descriptionForRole(
  role: UnifiedSegmentSlot["role"],
  brief: CreativeBrief,
): string {
  switch (role) {
    case "hook":
      return `Open with: ${brief.hook}`;
    case "demo":
      return "Demonstrate the product in real use";
    case "lifestyle":
      return "Show product in lifestyle / daily routine";
    case "benefit":
      return `Visual proof of: ${brief.corePainPoint}`;
    case "cta":
      return "Closing moment leading to brand end card or CTA overlay";
    case "intro":
      return "Establishing shot setting the scene";
    default:
      return "Cinematic segment";
  }
}

function roleFromSlot(slotRole: UnifiedSegmentSlot["role"]): VideoSegment["role"] {
  return slotRole;
}

function relevantReferenceAssetIds(args: BuildSegmentPromptsArgs): string[] {
  return args.classifiedAssets
    .filter((a) => {
      const r = effectiveAssetRole(a);
      return r === "product_image" || r === "reference_image";
    })
    .map((a) => a.id);
}

function estimateUploadedDuration(
  args: BuildSegmentPromptsArgs,
  uploadedAssetId: string | null,
): number {
  if (!uploadedAssetId) return 5;
  const asset = args.classifiedAssets.find((a) => a.id === uploadedAssetId);
  return asset?.durationSeconds ?? 5;
}

export const __test__ = {
  heuristicSegmentPrompts,
  heuristicSinglePrompt,
  appendBrandGuard,
  subjectFromBrief,
  DEFAULT_NEGATIVE_PROMPT,
  SEEDANCE_BRAND_GUARD_RULE,
};
