/**
 * Consistency Bible —— 跨镜头一致性锚点生成器（2026-07 质量对齐）。
 *
 * 对标同行工作流：他们靠「角色板 + 产品板」图片锚定跨镜头一致性；
 * 我们的等价机制 = 一次性生成高密度文字锚（本模块）+ Seedance 2.0
 * Omni-Reference 产品参考图（video-service 传入）。
 *
 * 关键原则：
 * 1. characterProfile / environmentProfile / productDescription 必须**具体到可复现**
 *    （发型长度、服装颜色款式、家具材质、窗外景别…），任何模糊描述都会导致跨段漂移。
 * 2. lightingArc 是叙事工具：光线要随剧情推进（同行案例：刺眼晨光→拉帘全黑→柔和晨光）。
 * 3. 输出全英文（Seedance 对英文 prompt 的语义遵从度最好），voiceProfile 记录口播语言。
 */

import { chatJsonByTier, isLLMAvailable, isLLMForcedMock } from "@/lib/providers/openai";
import { effectiveAssetRole } from "@/types/video-generation";
import type {
  ConsistencyBible,
  CreativeBrief,
  InputClassification,
  UploadedAsset,
} from "@/types/video-generation";
import type { StyleTemplate } from "@/lib/video-generation/style-templates";
import type { VisualReferenceAnalysis } from "@/lib/video-generation/visual-reference-analysis";

const SYSTEM_PROMPT = `You are a film production designer creating a "consistency bible" for an AI-generated short-form video ad. Every shot of the video will be generated separately, so your job is to lock down EVERY visual detail that must stay identical across shots.

Return strict JSON:
{
  "characterProfile": "one main on-camera person, described so precisely that two different artists would draw the same person: gender, age range, ethnicity, exact hairstyle & hair color, skin tone, face shape, EXACT outfit (garment type, color, fit), overall vibe. 40-70 words.",
  "environmentProfile": "the single primary location, described precisely: room type, wall color, key furniture with materials, window type & what's visible outside, floor, decor items. 30-60 words.",
  "productDescription": "the product's exact visual identity: color, material, finish, shape, size relative to human hands/body, distinguishing details. 25-50 words.",
  "lightingArc": ["shot-by-shot lighting narrative entry per video segment, e.g. 'harsh 6AM sunlight blasting through window straight into her face'", "..."],
  "voiceProfile": "spoken-voice spec if the ad has voiceover, e.g. 'en-US, casual excited young female voice, natural pacing' — or null if no voiceover fits",
  "styleKeywords": "8-14 comma-separated style anchors, e.g. 'authentic handheld iPhone footage, realistic skin texture, natural motion blur, true-to-life color, no beauty filter, slight camera shake'"
}

RULES:
- Write in English only.
- If product photos are provided, the productDescription MUST describe what is actually in those photos (you are given their filenames + classifier notes; be faithful, never invent a different product).
- The character must fit the target audience (relatable, not a fashion model).
- lightingArc length MUST equal the number of segments given, and lighting must PROGRESS the story, not stay static.
- No brand names, no logos, no on-screen text instructions.`;

export interface BuildConsistencyBibleArgs {
  creativeBrief: CreativeBrief;
  classification: InputClassification;
  classifiedAssets: UploadedAsset[];
  /// AI 段数量（决定 lightingArc 长度）
  aiSegmentCount: number;
  /// 目标口播语言（如 "zh-CN" / "en-US"）
  language: string;
  /// 选中的风格模版（skill 模式）；其 scaffold 强约束 bible 的风格底盘
  styleTemplate?: StyleTemplate | null;
  /// 参考图视觉分析（真实门店/产品实拍）；有真实场所时 environmentProfile 逐字采用实拍描述
  visualRefs?: VisualReferenceAnalysis | null;
}

export async function buildConsistencyBible(
  args: BuildConsistencyBibleArgs,
): Promise<ConsistencyBible> {
  if (isLLMForcedMock() || !isLLMAvailable()) {
    return heuristicBible(args);
  }
  try {
    const productAssets = args.classifiedAssets.filter((a) => {
      const r = effectiveAssetRole(a);
      return r === "product_image" || r === "reference_image";
    });
    const productNotes =
      productAssets.length > 0
        ? productAssets
            .map((a) => `- ${a.fileName}: ${a.suggestedUse ?? "product photo"}`)
            .join("\n")
        : "(no product photos uploaded — infer product from the brief)";

    const refs = args.visualRefs;
    const realLocationSection =
      refs?.isRealLocation && refs.locationDescription
        ? `
# REAL LOCATION (from the client's actual photos — these photos are ALSO fed to the video model as visual references)
The video takes place in this REAL place. environmentProfile MUST be this description verbatim or near-verbatim — do NOT invent a different place:
"${refs.locationDescription}"
${refs.signageText ? `Storefront signage reads exactly: "${refs.signageText}" — the sign may appear in establishing shots.` : ""}
${refs.keyFeatures.length > 0 ? `Signature features to keep recognizable: ${refs.keyFeatures.join("; ")}.` : ""}
`
        : "";

    const tpl = args.styleTemplate;
    const templateSection = tpl
      ? `
# LOCKED STYLE TEMPLATE (the user chose the "${tpl.name}" style — you MUST obey these constraints)
${tpl.scaffold.characterHint ? `- character direction: ${tpl.scaffold.characterHint}` : ""}
${tpl.scaffold.environmentHint ? `- environment direction: ${tpl.scaffold.environmentHint}` : ""}
${tpl.scaffold.lightingHint ? `- lighting direction: ${tpl.scaffold.lightingHint}` : ""}
- shot pattern this video will follow: ${tpl.scaffold.shotPattern}
- dominant camera language: ${tpl.scaffold.cameraLanguage}
${tpl.scaffold.dialogueStyle ? `- voiceover style: ${tpl.scaffold.dialogueStyle}` : "- this style has NO voiceover: set voiceProfile to null"}
`
      : "";

    const { data } = await chatJsonByTier<Partial<ConsistencyBible>>({
      tier: "videoPrompt",
      stage: "consistency_bible",
      system: SYSTEM_PROMPT,
      user: `# Creative brief
${JSON.stringify(args.creativeBrief, null, 2)}
${realLocationSection}${templateSection}
# Product photos (will also be passed to the video model as visual references)
${refs?.productDescription ? `Analyzed product from photos: ${refs.productDescription}\n` : ""}${productNotes}

# Video structure
- number of segments: ${args.aiSegmentCount}
- target voiceover language: ${args.language}
- video goal: ${args.classification.videoGoal}

Return the JSON now.`,
      temperature: 0.6,
      maxTokens: 1200,
    });

    const fallback = heuristicBible(args);
    const lightingArc =
      Array.isArray(data.lightingArc) && data.lightingArc.length > 0
        ? normalizeArc(data.lightingArc.map(String), args.aiSegmentCount)
        : fallback.lightingArc;

    return {
      characterProfile: str(data.characterProfile) ?? fallback.characterProfile,
      environmentProfile:
        str(data.environmentProfile) ??
        (refs?.isRealLocation ? refs.locationDescription : null) ??
        fallback.environmentProfile,
      productDescription:
        str(data.productDescription) ?? refs?.productDescription ?? fallback.productDescription,
      lightingArc,
      voiceProfile:
        tpl && !tpl.scaffold.dialogueStyle
          ? null
          : data.voiceProfile === null
            ? null
            : (str(data.voiceProfile) ?? fallback.voiceProfile),
      /// 模版的 styleKeywords 是「锁死的风格底盘」，优先于 LLM 自由发挥
      styleKeywords: tpl?.scaffold.styleKeywords ?? (str(data.styleKeywords) ?? fallback.styleKeywords),
    };
  } catch (err) {
    console.warn(
      "[consistency-bible] LLM failed; falling back to heuristic:",
      (err as Error).message,
    );
    return heuristicBible(args);
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** lightingArc 长度对齐 segment 数：不足则复用最后一条，超出则截断 */
function normalizeArc(arc: string[], count: number): string[] {
  const out = arc.slice(0, count);
  while (out.length < count) {
    out.push(out[out.length - 1] ?? "soft natural daylight");
  }
  return out;
}

/** 无 LLM 时的可用兜底（mock 模式 / LLM 故障） */
export function heuristicBible(args: BuildConsistencyBibleArgs): ConsistencyBible {
  const langIsZh = args.language.toLowerCase().startsWith("zh");
  const tpl = args.styleTemplate;
  const refs = args.visualRefs;
  return {
    characterProfile:
      tpl?.scaffold.characterHint ??
      "One woman in her late 20s, shoulder-length dark brown hair loosely tied, warm light-tan skin, oval face, wearing an oat-colored long-sleeve loungewear set, friendly relatable everyday vibe (not a model).",
    environmentProfile:
      (refs?.isRealLocation ? refs.locationDescription : null) ??
      tpl?.scaffold.environmentHint ??
      "A bright modern city apartment bedroom: warm white walls, light-oak floor, queen bed with beige linen bedding, one large floor-to-ceiling window with a city view, small potted plant on a wooden side table.",
    productDescription:
      refs?.productDescription ??
      (args.classifiedAssets.some((a) => effectiveAssetRole(a) === "product_image")
        ? "The exact product shown in the uploaded reference photos — match its color, material, proportions and details faithfully."
        : `The product implied by the brief: ${args.creativeBrief.keySellingPoints[0] ?? "the featured product"}, realistic consumer-grade design.`),
    lightingArc: normalizeArc(
      tpl?.scaffold.lightingHint
        ? [tpl.scaffold.lightingHint]
        : [
            "bright natural morning daylight through the window",
            "soft warm afternoon light, gentle shadows",
            "cozy golden-hour glow",
            "calm soft evening lamp light",
          ],
      args.aiSegmentCount,
    ),
    voiceProfile:
      tpl && !tpl.scaffold.dialogueStyle
        ? null
        : langIsZh
          ? "zh-CN, casual friendly young female voice, natural pacing"
          : "en-US, casual excited young female voice, natural pacing",
    styleKeywords:
      tpl?.scaffold.styleKeywords ??
      "authentic handheld iPhone footage, realistic skin texture, natural motion blur, true-to-life color, no beauty filter, slight camera shake, real domestic environment",
  };
}
