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

import type { RecordPlanningDegradation } from "@/lib/video-generation/planning-degradation";
import type {
  CreativeBrief,
  InputClassification,
  UnifiedVideoGenerationRequest,
  UploadedAsset,
} from "@/types/video-generation";

export interface BuildCreativeBriefArgs {
  request: UnifiedVideoGenerationRequest;
  classification: InputClassification;
  classifiedAssets: UploadedAsset[];
  /// LLM 失败退回启发式时记一条（方案上可见）；不传 = 只打日志
  onDegraded?: RecordPlanningDegradation;
}

export function heuristicBrief(args: BuildCreativeBriefArgs): CreativeBrief {
  const isBusiness = args.request.userType !== "personal";
  const hook = extractFirstSentence(args.request.rawPrompt);
  /// 不用上传文件名当产品名：上传后的文件名是 UUID（1025 真机验收里提示词出现过
  /// 「Concrete visual of 1232630b-….jpg in use」）。有品牌名用品牌名，否则泛称。
  const productHint = args.request.brandKit?.brandName?.trim() || "the product";

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
      ? "the everyday hassle this product solves"
      : "everyday moments worth sharing",
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
