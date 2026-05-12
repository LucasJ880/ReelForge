/**
 * Phase 5 — VideoGenerationPlan → DirectorPlan adapter.
 *
 * dispatchMultiSegmentGeneration() 在 video-service.ts 里强依赖 brief.directorPlan
 * （它要 parseDirectorPlan + 拿 segmentPlan[].seedancePrompt 直发 Seedance）。
 *
 * 这里把统一管线输出的 VideoGenerationPlan 映射到现有 DirectorPlan schema，
 * 保留所有 AI 段的 seedancePrompt + negativePrompt + 引用图。
 *
 * 关键约束：
 *  - DirectorPlan.segmentPlan 不包含 uploaded_clip / brand_end_card 段；
 *    那些段由 stitch-service 直接用 attachment URL / ffmpeg overlay 处理。
 *  - DirectorPlan.targetDurationSec 必须等于 AI 段总时长（让 segment-planner 对齐）。
 *  - editingPlan.logoPlacement / ctaEndCard 描述由 brandPackagingPlan 派生。
 */

import {
  type DirectorPlan,
  type SegmentPlan as DirectorSegmentPlan,
  type TimelineBlock,
  type EditingPlan,
  DIRECTOR_PROMPT_VERSION,
  directorPlanSchema,
} from "@/lib/schemas/director-plan";
import type { VideoGenerationPlan, VideoSegment } from "@/types/video-generation";

export interface MapToDirectorArgs {
  plan: VideoGenerationPlan;
  /// dispatch 时填的目标语言（默认从 plan.inputClassification.targetPlatform 推断；或调用方覆盖）
  language?: string;
}

/**
 * 把 VideoGenerationPlan 转成 DirectorPlan，可直接落到 VideoBrief.directorPlan 字段。
 */
export function mapPlanToDirectorPlan(args: MapToDirectorArgs): DirectorPlan {
  const { plan } = args;
  const language = args.language ?? "en";

  const aiSegments = plan.segments.filter((s) => s.type === "ai_generated_clip");
  if (aiSegments.length === 0) {
    // 兜底：如果全是上传 clip，构造 1 个最小占位 AI 段，避免 directorPlan.segmentPlan.min(1) 报错
    aiSegments.push(syntheticPlaceholderSegment(plan));
  }

  const segmentPlan: DirectorSegmentPlan[] = aiSegments.map((seg, i) => ({
    segmentIndex: i,
    durationSec: Math.max(1, Math.min(15, Math.round(seg.durationSeconds))),
    fromSec: computeFromSec(aiSegments, i),
    toSec: computeFromSec(aiSegments, i) + seg.durationSeconds,
    role: seg.role === "outro" ? "cta" : seg.role,
    seedancePrompt: seg.prompt ?? `Cinematic shot at segment ${i}`,
    negativePrompt: seg.negativePrompt ?? "",
    continuityNotes:
      i === 0 ? "Establish look and tone" : `Continue look from segment ${i - 1}`,
    referenceAssetHints: seg.sourceAssetIds,
    expectedOutput: seg.purpose,
  }));

  const timelineScript: TimelineBlock[] = segmentPlan.map((s) => ({
    fromSec: s.fromSec,
    toSec: s.toSec,
    visual: s.expectedOutput,
    cameraMovement: aiSegments[s.segmentIndex]?.cameraDirection ?? "",
    onScreenText: "",
    voiceover: "",
    musicCue: "",
    assetNeeded: aiSegments[s.segmentIndex]?.sourceAssetIds.join(", ") || "",
    hasFootage: (aiSegments[s.segmentIndex]?.sourceAssetIds.length ?? 0) > 0,
    seedanceShotPrompt: s.seedancePrompt,
  }));

  const editingPlan: EditingPlan = {
    stitchOrder: plan.segments.map((s) => s.order),
    transitions: plan.assemblyPlan.transitions,
    captions: plan.creativeBrief.cta ?? "",
    logoPlacement:
      plan.brandPackagingPlan.logoAssetId
        ? "Brand logo composited on end card by Aivora ffmpeg overlay"
        : "logo to be added later",
    ctaEndCard:
      plan.brandPackagingPlan.mode === "none"
        ? ""
        : plan.brandPackagingPlan.cta ??
          plan.brandPackagingPlan.brandName ??
          "Brand end card",
    backgroundMusic: "",
    voiceoverAlignment: "",
    safeAreaNotes: `Aspect ${plan.assemblyPlan.aspectRatio}, leave clear lower-third for overlays.`,
  };

  const directorPlan: DirectorPlan = {
    version: DIRECTOR_PROMPT_VERSION,
    language,
    targetDurationSec: segmentPlan.reduce((acc, s) => acc + s.durationSec, 0),
    platform: plan.inputClassification.targetPlatform,
    strategySummary: {
      targetAudience: plan.creativeBrief.targetAudience,
      corePainPoint: plan.creativeBrief.corePainPoint,
      emotionalAngle: plan.creativeBrief.emotionalAngle,
      keySellingPoints:
        plan.creativeBrief.keySellingPoints.length > 0
          ? plan.creativeBrief.keySellingPoints
          : ["Concrete visual proof of the product in real use"],
      platformFit: plan.creativeBrief.platformFit,
      recommendedDurationReason: plan.creativeBrief.recommendedDurationReason,
    },
    timelineScript,
    segmentPlan,
    editingPlan,
    qualityChecklist: [
      ...plan.qualityReview.warnings.map((w) => w.message),
      ...plan.qualityReview.suggestions.map((s) => s.message),
    ],
  };

  /// 兜底校验：与 director-plan zod 一致
  return directorPlanSchema.parse(directorPlan);
}

function computeFromSec(segments: VideoSegment[], idx: number): number {
  let cursor = 0;
  for (let i = 0; i < idx; i++) {
    cursor += segments[i].durationSeconds;
  }
  return cursor;
}

function syntheticPlaceholderSegment(plan: VideoGenerationPlan): VideoSegment {
  return {
    id: "synthetic_seg_0",
    order: 0,
    type: "ai_generated_clip",
    role: "hook",
    durationSeconds: 5,
    purpose: "Placeholder AI segment (all original segments were uploaded clips or end card)",
    prompt: `Cinematic short establishing shot, ${plan.assemblyPlan.aspectRatio}, warm natural light, real setting.`,
    negativePrompt:
      "low quality, blurry, text artifacts, watermark, no logo, no brand text, no URLs",
    sourceAssetIds: [],
    uploadedAssetId: null,
    cameraDirection: "static",
    visualDirection: "warm natural light",
    outputSpec: {
      aspectRatio: plan.assemblyPlan.aspectRatio,
      resolution: plan.assemblyPlan.targetResolution,
    },
  };
}
