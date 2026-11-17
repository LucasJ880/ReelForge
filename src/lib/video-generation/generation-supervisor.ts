/**
 * Phase 5 — Generation Supervisor.
 *
 * 唯一对外入口：buildPlan(request) → VideoGenerationPlan
 *
 * 编排（按顺序）：
 *   1. classifyInput        → InputClassification
 *   2. classifyAssets       → 把 attachments 跑一遍 asset-classifier 拿 inferredRole（若 UI 已分类则跳过）
 *   3. buildCreativeBrief ‖ analyzeVisualReferences → CreativeBrief + 看商品图（出方案只有这两步调模型，并行）
 *   4. buildBrandPackaging  → BrandPackagingPlan
 *   5. buildClipPlacement   → ClipPlacementPlan
 *   6. planUnifiedSegments  → UnifiedSegmentSlot[]
 *   6.5 heuristicBible      → ConsistencyBible（确定性，不调模型）
 *   7. buildVideoSegments   → VideoSegment[]（模板镜头表 + 固定负面提示词，不调模型）
 *   8. buildAssemblyPlan    → AssemblyPlan
 *   9. buildQualityReview   → QualityReview
 *   10. buildPlanPreview    → PlanPreview
 *
 * 无副作用：不写 DB，不调 Seedance。dispatch 阶段在 API 路由层完成。
 *
 * 各步 AI 调用失败都有兜底，方案照常出；哪几步退回了兜底记在 plan.planningDegradations（2026-10-29），
 * 同时进质量评审的 warning（商家看得到）并打一行运维日志。
 *
 * 一致性设定与段提示词不调模型（2026-11-09 起；退回四次调用的开关 PLANNING_FULL_LLM 已在瘦身第 4 批删除）：
 * 单条视频派发时提示词会按已确认的故事板改写（storyboard-beats 的 ground* 函数），剧情与镜头来自商家原话 + 镜头卡，
 * 方案里的段提示词只留下 PRODUCT / CHARACTER / 各类 LOCK / Audio / Spoken dialogue 这几行模板行——
 * 为它们调模型写出来的镜头表与人物场景设定本来就整段被丢弃。
 */

import { signoffActive } from "@/lib/video-generation/brand-signoff";
import { randomUUID } from "node:crypto";
import { classifyInput } from "@/lib/video-generation/input-classifier";
import { classifyAsset } from "@/lib/video-generation/asset-classifier";
import { heuristicBrief } from "@/lib/video-generation/creative-strategist";
import { directorCaptionScript, directorVideoPrompt, directorVoiceLanguage } from "@/lib/video-generation/director-line";
import type { DirectorJob } from "@/lib/video-generation/director-plan";
import { heuristicBible } from "@/lib/video-generation/consistency-bible";
import type { ConsistencyLock } from "@/lib/video-generation/style-templates";
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
          /// 选了任何一首曲子都按同一上限压音量（原来只认最早的那一首，新曲库会被悄悄静音）
          bgm && bgm.trackId !== "none"
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
    /// 片尾落款：开着且有品牌名才进快照；没勾的成片快照里不多这个键（与之前逐字节一致）
    ...(signoffActive(request.signoff)
      ? {
          signoff: {
            enabled: true,
            brandName: request.signoff.brandName.trim(),
            cta: request.signoff.cta?.trim() || null,
            ...(request.signoff.logo ? { logo: true } : {}),
          },
        }
      : {}),
    /// 右上角 Logo：勾了才进快照（没勾的成片快照里不多这个键）
    ...(request.cornerLogo === true ? { cornerLogo: true } : {}),
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
  options: {
    /// 这轮故事板带着的镜头脚本（导演线路是唯一的出片方式，2026-11-17）。方案不调模型——脚本已经把片子写完了：
    /// 整条片是一个 AI 段，段提示词就是脚本拼出来的出片提示词；口播稿取脚本里的台词（字幕烧的就是它）。
    director: { job: DirectorJob };
  },
): Promise<VideoGenerationPlan> {
  const director = options.director;
  const postProduction = withDirectorVoiceover(normalizePostProductionSettings(request), director.job, request.rawPrompt);
  /// 1. Ensure assets are classified. UI 大概率已经跑过 /api/video-generation/classify-asset；
  /// 但兜底再跑一次，保证 inferredRole 一定有合理值。
  const classifiedAssets = ensureClassified(request.attachments ?? []);

  const classification = classifyInput({ ...request, attachments: classifiedAssets });
  const degradations = createPlanningDegradationLog();

  /// 2. 简报按商家原话抽（只用来给订单起标题、过质量把关），不调模型、不看图——片子怎么拍脚本已经写完了
  const creativeBrief = heuristicBrief({
    request: { ...request, attachments: classifiedAssets },
    classification,
    classifiedAssets,
    onDegraded: degradations.record,
  });
  const visualRefs = null;

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
    singleAiSegment: true,
  });

  /// 5.4 老的风格模版与一致性锁 2026-11-17 下线：风格由风格卡交给导演写手（director-line-policy.ts），已经写进脚本里
  const styleTemplate = null;
  const consistencyLocks: ConsistencyLock[] = [];

  /// 5.5 Consistency bible（跨镜头一致性锚：角色/场景/产品/光线弧，一次生成逐段复用）。确定性，不调模型。
  const aiSlotCount = segmentSlots.filter((s) => s.source === "ai").length;
  const consistencyBible = heuristicBible({
    creativeBrief,
    classification,
    classifiedAssets,
    aiSegmentCount: Math.max(1, aiSlotCount),
    language: request.language ?? "en-US",
    styleTemplate,
    visualRefs,
  });

  /// 6. Per-segment prompts → VideoSegment[]（模板镜头表，不调模型）
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
  });
  /// AI 段的提示词整段换成脚本拼出来的那一份（全程用正面描述，不带负面提示词）
  const videoPrompt = directorVideoPrompt(director.job);
  for (const segment of segments) {
    if (segment.type !== "ai_generated_clip") continue;
    segment.prompt = videoPrompt;
    segment.negativePrompt = "";
  }

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

/**
 * 导演线路的后期设置：口播与配乐由出片模型原生给（脚本里写了声音和每句台词），所以口播一定开着，
 * 口播稿 = 脚本里的台词按先后连起来（字幕烧的就是它）。字幕开不开、配乐选没选、片尾落款照商家选的来。
 */
function withDirectorVoiceover(base: PostProductionPlan, job: DirectorJob, rawPrompt: string): PostProductionPlan {
  const script = directorCaptionScript(job);
  const language = directorVoiceLanguage(rawPrompt);
  /// 配乐随片子一起出（脚本里写了 music）：曲库的曲子不再混进去，不然两段音乐叠在一起。
  /// 脚本里一句台词都没有（静物、沉浸声音这类风格）也一样：音轨仍是模型原生的，只是没有口播、没有字幕可烧。
  const nativeAudio = { bgm: { trackId: "none" as const, volume: 0 }, nativeMusic: true };
  if (!script) {
    return {
      ...base,
      audio: { ...nativeAudio, voiceover: { ...base.audio.voiceover, enabled: false, script: "" } },
    };
  }
  return {
    ...base,
    audio: {
      ...nativeAudio,
      voiceover: { ...base.audio.voiceover, enabled: true, language, script, drive: "native" },
    },
    captions: { ...base.captions, language },
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
