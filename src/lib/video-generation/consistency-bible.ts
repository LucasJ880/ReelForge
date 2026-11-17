/**
 * Consistency Bible —— 跨镜头一致性锚点（确定性模板）。
 *
 * 每个镜头分开生成，这里把必须逐镜一致的东西（人物、场景、商品、光线、画风）写成一份设定，逐段复用；
 * 配合出片时传入的商品参考图一起锁住一致性。
 *
 * 2026-11-09 起出方案不再为这份设定调模型（那次调用没看图，写出的人物 / 场景 / 光线在按故事板改写提示词时
 * 全被丢弃，只剩商品描述一句进 PRODUCT 行）。瘦身第 4 批把调模型的那条退路（PLANNING_FULL_LLM）连同它的
 * 系统提示词一起删了：现在只有 heuristicBible 这一条路——
 *  - 商品描述直接用「看商品图」那一步的原话（visualRefs.productDescription）；
 *  - 真实场所的场景描述直接用实拍盘点；
 *  - 其余取风格模版的底盘，没有模版时用通用设定。
 * 输出全英文（视频模型对英文提示词的遵从度最好），voiceProfile 记录口播语言。
 */

import { effectiveAssetRole } from "@/types/video-generation";
import { presenterReferenceAssets } from "@/lib/video-generation/storyboard-person-refs";
import type {
  ConsistencyBible,
  CreativeBrief,
  InputClassification,
  UploadedAsset,
} from "@/types/video-generation";
import type { StyleTemplate } from "@/lib/video-generation/style-templates";
import type { VisualReferenceAnalysis } from "@/lib/video-generation/visual-reference-analysis";

/// 有主播参考图时在具体人物描述后追加「与主播参考图同一人」。
const PRESENTER_HEURISTIC_SUFFIX =
  "Must be the exact person in the presenter reference photo — same face, hair, skin tone, build and age in every shot.";

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

/** lightingArc 长度对齐 segment 数：不足则复用最后一条，超出则截断 */
function normalizeArc(arc: string[], count: number): string[] {
  const out = arc.slice(0, count);
  while (out.length < count) {
    out.push(out[out.length - 1] ?? "soft natural daylight");
  }
  return out;
}

/** 一致性设定（确定性，不调模型）。出方案与测试都走这一条。 */
export function heuristicBible(args: BuildConsistencyBibleArgs): ConsistencyBible {
  const langIsZh = args.language.toLowerCase().startsWith("zh");
  const tpl = args.styleTemplate;
  const refs = args.visualRefs;
  /// 有主播参考图（且开关放行）时，在具体人物描述后追加「与主播参考图同一人」；没有时保持现状。
  const presenterAnchored = presenterReferenceAssets(args.classifiedAssets).length > 0;
  const baseCharacter =
    tpl?.scaffold.characterHint ??
    "One woman in her late 20s, shoulder-length dark brown hair loosely tied, warm light-tan skin, oval face, wearing an oat-colored long-sleeve loungewear set, friendly relatable everyday vibe (not a model).";
  return {
    characterProfile: presenterAnchored ? `${baseCharacter} ${PRESENTER_HEURISTIC_SUFFIX}` : baseCharacter,
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
