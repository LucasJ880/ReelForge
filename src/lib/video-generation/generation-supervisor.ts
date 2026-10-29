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
 *
 * 各步 AI 调用失败都有兜底，方案照常出；哪几步退回了兜底记在 plan.planningDegradations（2026-10-29），
 * 同时进质量评审的 warning（商家看得到）并打一行运维日志。
 */

import { randomUUID } from "node:crypto";
import { classifyInput } from "@/lib/video-generation/input-classifier";
import { classifyAsset } from "@/lib/video-generation/asset-classifier";
import { buildCreativeBrief } from "@/lib/video-generation/creative-strategist";
import { buildConsistencyBible } from "@/lib/video-generation/consistency-bible";
import {
  getConsistencyLocks,
  resolveStyleTemplate,
} from "@/lib/video-generation/style-templates";
import { analyzeVisualReferences } from "@/lib/video-generation/visual-reference-analysis";
import { buildBrandPackagingPlan } from "@/lib/video-generation/brand-packaging";
import { buildClipPlacementPlan } from "@/lib/video-generation/clip-placement-planner";
import { planUnifiedSegments } from "@/lib/video-generation/segment-planner-adapter";
import { buildVideoSegments } from "@/lib/video-generation/prompt-intelligence";
import { buildAssemblyPlan } from "@/lib/video-generation/video-assembly-plan";
import { buildQualityReview } from "@/lib/video-generation/quality-reviewer";
import { buildPlanPreview } from "@/lib/video-generation/plan-preview";
import { resolveClientLockProfile } from "@/lib/video-generation/client-lock-profiles";
import {
  createPlanningDegradationLog,
  logPlanningDegradations,
} from "@/lib/video-generation/planning-degradation";
import {
  effectiveAssetRole,
  type UnifiedVideoGenerationRequest,
  type VideoGenerationPlan,
  type UploadedAsset,
  type PostProductionPlan,
} from "@/types/video-generation";

export function normalizePostProductionSettings(
  request: UnifiedVideoGenerationRequest,
): PostProductionPlan {
  const language = request.language?.trim() || "en-US";
  const voiceover = request.audio?.voiceover;
  const bgm = request.audio?.bgm;
  const captions = request.captions;
  return {
    audio: {
      voiceover: {
        enabled: voiceover?.enabled ?? false,
        voiceId: voiceover?.voiceId.trim() || "warm-confident",
        language: voiceover?.language.trim() || language,
        script: voiceover?.script ?? "",
        /// 只透传；该线路做不做得到由派发入口的能力闸判断。
        drive: voiceover?.drive ?? "native",
      },
      bgm: {
        trackId: bgm?.trackId ?? "none",
        volume:
          bgm?.trackId === "wholesome"
            ? Math.min(0.35, Math.max(0, bgm.volume))
            : 0,
      },
    },
    captions: {
      enabled: captions?.enabled ?? false,
      style: captions?.style ?? "word_by_word",
      language: captions?.language.trim() || language,
      position: captions?.position ?? "bottom",
      exportSrt: captions?.exportSrt ?? false,
    },
  };
}

/**
 * 主入口。
 *
 * @param request 前端表单提交
 * @returns 完整的 VideoGenerationPlan（无副作用）
 */
export async function buildPlan(
  request: UnifiedVideoGenerationRequest,
): Promise<VideoGenerationPlan> {
  const postProduction = normalizePostProductionSettings(request);
  /// 1. Ensure assets are classified. UI 大概率已经跑过 /api/video-generation/classify-asset；
  /// 但兜底再跑一次，保证 inferredRole 一定有合理值。
  const classifiedAssets = ensureClassified(request.attachments ?? []);

  const classification = classifyInput({ ...request, attachments: classifiedAssets });
  const degradations = createPlanningDegradationLog();

  /// 2. Creative brief（可能调 LLM）与 5.45 参考图视觉分析：
  /// 视觉分析让 GPT 真正「看」参考图，提取真实门店 / 产品实拍细节，让文字锚（bible / prompt）和图片锚描述同一个真实场景。
  /// 两步互不依赖，并行跑（1028 闭环轮 E2E #7：出方案要 40–60 秒，串行时看图白等创意简报）；两者失败都自带兜底，不会拖垮对方。
  const [creativeBrief, visualRefs] = await Promise.all([
    buildCreativeBrief({
      request: { ...request, attachments: classifiedAssets },
      classification,
      classifiedAssets,
      onDegraded: degradations.record,
    }),
    analyzeVisualReferences(classifiedAssets, request.rawPrompt, degradations.record),
  ]);

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
  const styleTemplate = resolveStyleTemplate(request.styleTemplateId, request.rawPrompt);
  const autoLockIds = styleTemplate
    ? [
        "lock_character_identity",
        "lock_scene_geometry",
        "lock_lighting",
        /// 看生效角色：用户把推断成商品图的素材改标成 person（主播参考图）后，不再自动挂产品形状锁。
        ...(classifiedAssets.some((asset) => effectiveAssetRole(asset) === "product_image") ? ["lock_product_shape"] : []),
        ...(styleTemplate.scaffold.dialogueStyle ? ["lock_lipsync"] : []),
      ]
    : [];
  const consistencyLocks = getConsistencyLocks([
    ...autoLockIds,
    ...(request.consistencyLockIds ?? []),
  ]);

  /// 5.5 Consistency bible（跨镜头一致性锚：角色/场景/产品/光线弧，一次生成逐段复用）
  const aiSlotCount = segmentSlots.filter((s) => s.source === "ai").length;
  const consistencyBible = await buildConsistencyBible({
    creativeBrief,
    classification,
    classifiedAssets,
    aiSegmentCount: Math.max(1, aiSlotCount),
    language: request.language ?? "en-US",
    styleTemplate,
    visualRefs,
    onDegraded: degradations.record,
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
    visualRefs,
    voiceover: postProduction.audio.voiceover,
    onDegraded: degradations.record,
  });

  /// 7. Assembly plan
  const assemblyPlan = buildAssemblyPlan({
    segments,
    brandPackaging: brandPackagingPlan,
    aspectRatio: request.selectedAspectRatio,
  });

  /// 8. Quality review (SunnyShutter locks only when brand/client matches)
  /// 到这里会调 AI 的几步都跑完了：降级记录定稿，进质量评审（商家可见）并打一行运维日志。
  const planId = randomUUID();
  const planningDegradations = degradations.list();
  logPlanningDegradations({ source: "plan", planId }, planningDegradations);
  const clientLockProfileId = resolveClientLockProfile({
    brandName: brandPackagingPlan.brandName ?? request.brandKit?.brandName,
  });
  const qualityReview = buildQualityReview({
    classification,
    classifiedAssets,
    brandPackaging: brandPackagingPlan,
    segments,
    creativeBrief,
    clientLockProfileId,
    planningDegradations,
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
    id: planId,
    inputClassification: classification,
    classifiedAssets,
    creativeBrief,
    consistencyBible,
    segments,
    seedancePrompts,
    brandPackagingPlan,
    clipPlacementPlan,
    assemblyPlan,
    postProduction,
    qualityReview,
    planPreview,
    planningDegradations,
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
