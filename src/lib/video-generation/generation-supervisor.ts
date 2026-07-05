/**
 * Phase 5 — Generation Supervisor.
 *
 * 唯一对外入口：buildPlan(request) → VideoGenerationPlan
 *
 * 编排（按顺序）：
 *   1. classifyInput        → InputClassification
 *   2. classifyAssets       → 把 attachments 跑一遍 asset-classifier 拿 inferredRole（若 UI 已分类则跳过）
 *   3. buildCreativeBrief   → CreativeBrief（LLM 或 heuristic）
 *   4. buildBrandPackaging  → BrandPackagingPlan
 *   5. buildClipPlacement   → ClipPlacementPlan
 *   6. planUnifiedSegments  → UnifiedSegmentSlot[]
 *   7. buildVideoSegments   → VideoSegment[]（LLM prompts）
 *   8. buildAssemblyPlan    → AssemblyPlan
 *   9. buildQualityReview   → QualityReview
 *   10. buildPlanPreview    → PlanPreview
 *
 * 无副作用：不写 DB，不调 Seedance。dispatch 阶段在 API 路由层完成。
 */

import { randomUUID } from "node:crypto";
import { classifyInput } from "@/lib/video-generation/input-classifier";
import { classifyAsset } from "@/lib/video-generation/asset-classifier";
import { buildCreativeBrief } from "@/lib/video-generation/creative-strategist";
import { buildConsistencyBible } from "@/lib/video-generation/consistency-bible";
import {
  getConsistencyLocks,
  getStyleTemplate,
} from "@/lib/video-generation/style-templates";
import { buildBrandPackagingPlan } from "@/lib/video-generation/brand-packaging";
import { buildClipPlacementPlan } from "@/lib/video-generation/clip-placement-planner";
import { planUnifiedSegments } from "@/lib/video-generation/segment-planner-adapter";
import { buildVideoSegments } from "@/lib/video-generation/prompt-intelligence";
import { buildAssemblyPlan } from "@/lib/video-generation/video-assembly-plan";
import { buildQualityReview } from "@/lib/video-generation/quality-reviewer";
import { buildPlanPreview } from "@/lib/video-generation/plan-preview";
import type {
  UnifiedVideoGenerationRequest,
  VideoGenerationPlan,
  UploadedAsset,
} from "@/types/video-generation";
import { effectiveAssetRole } from "@/types/video-generation";

/**
 * 主入口。
 *
 * @param request 前端表单提交
 * @returns 完整的 VideoGenerationPlan（无副作用）
 */
export async function buildPlan(
  request: UnifiedVideoGenerationRequest,
): Promise<VideoGenerationPlan> {
  /// 1. Ensure assets are classified. UI 大概率已经跑过 /api/video-generation/classify-asset；
  /// 但兜底再跑一次，保证 inferredRole 一定有合理值。
  const classifiedAssets = ensureClassified(request.attachments ?? []);

  const classification = classifyInput({ ...request, attachments: classifiedAssets });

  /// 2. Creative brief（可能调 LLM）
  const creativeBrief = await buildCreativeBrief({
    request: { ...request, attachments: classifiedAssets },
    classification,
    classifiedAssets,
  });

  /// 3. Brand packaging
  const brandPackagingPlan = buildBrandPackagingPlan({
    request: { ...request, attachments: classifiedAssets },
    classification,
    classifiedAssets,
  });

  /// 4. Clip placement
  const clipPlacementPlan = buildClipPlacementPlan({
    classifiedAssets,
    classification,
    targetDurationSec: request.selectedDuration,
    hasBrandEndCard:
      brandPackagingPlan.mode !== "none" &&
      brandPackagingPlan.endCardDurationSeconds > 0 &&
      brandPackagingPlan.renderStrategy !== "use_uploaded_clip",
  });

  /// 5. Unified segment slots
  const segmentSlots = planUnifiedSegments({
    targetDurationSec: request.selectedDuration,
    clipPlacement: clipPlacementPlan,
    brandPackaging: brandPackagingPlan,
  });

  /// 5.4 风格模版（skill 模式）：后端固化的风格底盘 + 可叠加一致性锁
  const styleTemplate = getStyleTemplate(request.styleTemplateId);
  const consistencyLocks = getConsistencyLocks(request.consistencyLockIds);

  /// 5.5 Consistency bible（跨镜头一致性锚：角色/场景/产品/光线弧，一次生成逐段复用）
  const aiSlotCount = segmentSlots.filter((s) => s.source === "ai").length;
  const consistencyBible = await buildConsistencyBible({
    creativeBrief,
    classification,
    classifiedAssets,
    aiSegmentCount: Math.max(1, aiSlotCount),
    language: request.language ?? "en-US",
    styleTemplate,
  });

  /// 6. Per-segment prompts → VideoSegment[]
  const segments = await buildVideoSegments({
    creativeBrief,
    segmentSlots,
    classifiedAssets,
    classification,
    aspectRatio: request.selectedAspectRatio,
    consistencyBible,
    language: request.language ?? "en-US",
    styleTemplate,
    consistencyLocks,
  });

  /// 7. Assembly plan
  const assemblyPlan = buildAssemblyPlan({
    segments,
    brandPackaging: brandPackagingPlan,
    aspectRatio: request.selectedAspectRatio,
  });

  /// 8. Quality review
  const qualityReview = buildQualityReview({
    classification,
    classifiedAssets,
    brandPackaging: brandPackagingPlan,
    segments,
    creativeBrief,
  });

  /// 9. Plan preview
  const planPreview = buildPlanPreview({
    segments,
    brandPackaging: brandPackagingPlan,
    assemblyPlan,
    aspectRatio: request.selectedAspectRatio,
    userType: request.userType,
  });

  /// 10. Seedance prompts snapshot (used at dispatch time to populate VideoJob prompts)
  const seedancePrompts = segments
    .filter((s) => s.type === "ai_generated_clip" && s.prompt)
    .map((s) => ({
      segmentOrder: s.order,
      prompt: s.prompt ?? "",
      negativePrompt: s.negativePrompt ?? "",
      referenceImageUrls: classifiedAssets
        .filter((a) => s.sourceAssetIds.includes(a.id))
        .map((a) => a.url),
    }));

  return {
    id: randomUUID(),
    inputClassification: classification,
    classifiedAssets,
    creativeBrief,
    consistencyBible,
    segments,
    seedancePrompts,
    brandPackagingPlan,
    clipPlacementPlan,
    assemblyPlan,
    qualityReview,
    planPreview,
    createdAt: new Date().toISOString(),
  };
}

/** 给 attachments 补齐 inferredRole（如果还没分过类） */
function ensureClassified(assets: UploadedAsset[]): UploadedAsset[] {
  return assets.map((a) => {
    if (a.inferredRole && a.inferredRole !== "unknown") return a;
    const result = classifyAsset({
      url: a.url,
      mimeType: a.mimeType,
      fileName: a.fileName,
      width: a.width ?? null,
      height: a.height ?? null,
      durationSeconds: a.durationSeconds ?? null,
    });
    return {
      ...a,
      inferredRole: result.inferredRole,
      roleConfidence: result.roleConfidence,
      suggestedUse: a.suggestedUse ?? result.suggestedUse,
      warnings: [...(a.warnings ?? []), ...result.warnings],
    };
  });
}

export const __test__ = { ensureClassified };
