import { FinalVideoStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { renderBrandEndCard } from "@/lib/video-generation/brand-end-card-renderer";
import { applyBrandOverlayIfConfigured } from "@/lib/video-generation/brand-overlay-renderer";
import { CORNER_LOGO_WATERMARK_ENABLED } from "@/lib/video-generation/brand-watermark-policy";
import { StitchCompositionError } from "@/lib/media/stitch-pipeline";
import {
  effectiveAssetRole,
  type AssemblyPlan,
  type AspectRatio,
  type BrandPackagingPlan,
  type SegmentType,
  type UploadedAsset,
  type VideoGenerationPlan,
} from "@/types/video-generation";

/**
 * Phase 2 · L3 — Assembly Executor（C3 起只负责「解析」，不再写库、不再自己拼接）。
 *
 * 职责：把 VideoGenerationPlan.assemblyPlan.clips 里的每个 clip 物化成可拼接 URL：
 *  - ai_generated_clip → 找对应 VideoJob.outputVideoUrl
 *  - uploaded_clip     → 找 classifiedAssets[id].url（客户自己上传的片段）
 *  - brand_end_card    → renderBrandEndCard 现场渲染（客户选的联系方式尾卡）
 *  - cta_card          → 视为 brand_end_card（同一份模板）
 *
 * 拼接、后期、缩略图由 stitch-composer → stitch-service.composeAndPersistTimeline 统一完成，
 * 结果只经 finishStitchTask 写回。生产（inprocess）与开发（local）走同一条路径——
 * 改造前生产 runner 根本不读 assemblyPlan，客户选的尾卡 / 上传片段在线上从未生效。
 */

export interface AssemblyClipInput {
  segmentOrder: number;
  type: SegmentType;
  url: string;
  intendedDurationSec: number;
  /// trimToFit=true 表示该 clip 长度可能超出，stitch 时按 intendedDurationSec 裁剪
  trimToFit: boolean;
  notes?: string;
}

export interface AssembleResult {
  finalVideoId: string;
  ok: boolean;
  status: FinalVideoStatus;
  stitchedVideoUrl?: string | null;
  error?: string | null;
  awaitingExternal?: boolean;
  warnings: string[];
  skipped?: boolean;
}

export interface AssemblyFinalVideoInput {
  id: string;
  brief: {
    id: string;
    aspectRatio: string | null;
    videoGenerationPlan: unknown;
    contentAngle?: {
      round?: {
        deliveryOrder?: { productInput: unknown } | null;
      } | null;
    } | null;
  } | null;
  segments: Array<{
    id: string;
    segmentIndex: number | null;
    outputVideoUrl: string | null;
  }>;
}

export interface AssemblyInputs {
  plan: VideoGenerationPlan;
  aspectRatio: AspectRatio;
  clips: AssemblyClipInput[];
  warnings: string[];
  brandKitLogoUrl: string | null;
}

/** 纯函数：尾卡 / CTA 卡不背字幕（字幕窗口按实际时长自动扣掉它们） */
export function isEndCardClipType(type: string): boolean {
  return type === "brand_end_card" || type === "cta_card";
}

/**
 * 解析一条 unified FinalVideo 的完整装配输入（AI 段 / 上传片段 / 现场渲染尾卡）。
 * 不写库；解析不出可拼片段时抛 StitchCompositionError（由调用方经 finishStitchTask 落 FAILED）。
 */
export async function resolveAssemblyInputs(
  fv: AssemblyFinalVideoInput,
): Promise<AssemblyInputs> {
  const plan = fv.brief?.videoGenerationPlan as VideoGenerationPlan | null | undefined;
  if (!plan?.assemblyPlan) {
    throw new StitchCompositionError(
      "ASSEMBLY_PLAN_MISSING",
      "brief has no unified VideoGenerationPlan.assemblyPlan",
    );
  }
  const aspectRatio = (fv.brief?.aspectRatio ?? "9:16") as AspectRatio;
  const warnings: string[] = [];
  /// 解析 brandKit logoUrl 用于 end card 渲染
  const brandKit = extractBrandKit(
    fv.brief?.contentAngle?.round?.deliveryOrder?.productInput ?? null,
  );

  /// P05-C：重做换挂后每个 segmentIndex 只能挂一行；挂了两行说明旧行没摘下来，
  /// aiJobs.find 会静默取到其中一行（可能是被替换掉的旧段）——宁可合成失败回滚到旧成片。
  const seenSegmentIndexes = new Set<number>();
  for (const job of fv.segments) {
    if (job.segmentIndex == null) continue;
    if (seenSegmentIndexes.has(job.segmentIndex)) {
      throw new StitchCompositionError(
        "DUPLICATE_SEGMENT_INDEX",
        `FinalVideo ${fv.id} has more than one segment attached at segmentIndex=${job.segmentIndex}`,
      );
    }
    seenSegmentIndexes.add(job.segmentIndex);
  }

  let clips: AssemblyClipInput[];
  try {
    clips = await resolveClips({
      assemblyPlan: plan.assemblyPlan,
      brandPackaging: plan.brandPackagingPlan,
      classifiedAssets: plan.classifiedAssets ?? [],
      brandKit,
      aiJobs: fv.segments,
      briefId: fv.brief?.id ?? fv.id,
      aspectRatio,
      warnings,
    });
  } catch (err) {
    throw new StitchCompositionError(
      "ASSEMBLY_RESOLVE_FAILED",
      `Resolve clips failed: ${(err as Error).message}`,
    );
  }
  /// 装配期警告必须留痕：0805 walkthrough 首拼把联系方式帧静默跳过，
  /// 事后无任何日志可查（重拼即成功，属偶发）。跳过类警告一律落 server log。
  if (warnings.length > 0) {
    console.warn("[assembly]", fv.id, JSON.stringify(warnings));
  }
  if (clips.length === 0) {
    throw new StitchCompositionError("NO_ASSEMBLABLE_CLIPS", "No assemblable clips found");
  }
  return {
    plan,
    aspectRatio,
    clips,
    warnings,
    brandKitLogoUrl: brandKit?.logoUrl ?? null,
  };
}

/**
 * 兼容入口（无生产调用方）：本地认领 + 统一合成器 + 唯一成功写入点。
 * 改造前这里有自己的一套 READY 写入与 markBriefReady，现已收敛到 stitch-service。
 */
export async function executeAssembly(
  finalVideoId: string,
): Promise<AssembleResult> {
  const fv = await db.finalVideo.findUnique({
    where: { id: finalVideoId },
    select: { status: true },
  });
  if (!fv) {
    return {
      finalVideoId,
      ok: false,
      status: FinalVideoStatus.FAILED,
      error: "FinalVideo 不存在",
      warnings: [],
    };
  }
  const { claimFinalVideoForStitch, runClaimedStitchAttempt } = await import(
    "@/lib/services/stitch-service"
  );
  const attemptToken = await claimFinalVideoForStitch(finalVideoId);
  if (!attemptToken) {
    return { finalVideoId, ok: false, status: fv.status, skipped: true, warnings: [] };
  }
  const outcome = await runClaimedStitchAttempt({ finalVideoId, attemptToken });
  return {
    finalVideoId,
    ok: outcome.result.ok,
    status: outcome.result.status,
    stitchedVideoUrl: outcome.result.stitchedVideoUrl ?? null,
    error: outcome.result.error ?? null,
    warnings: [],
  };
}

/**
 * logo 角标（0805 起平台策略关闭：CORNER_LOGO_WATERMARK_ENABLED=false 时原样返回）。
 */
export async function applyAssemblyLogoOverlay(input: {
  finalVideoId: string;
  aspectRatio: AspectRatio;
  sourceVideoUrl: string;
  plan: BrandPackagingPlan;
  assets: UploadedAsset[];
  fallbackLogoUrl: string | null;
  warnings: string[];
}): Promise<string> {
  /// 0805 产品决策：logo 走印上式（产品图 imprint），封装只留联系方式帧，
  /// 平台管线不再自动盖角标水印。见 brand-watermark-policy.ts。
  if (!CORNER_LOGO_WATERMARK_ENABLED) return input.sourceVideoUrl;
  if (input.plan.mode === "none") return input.sourceVideoUrl;
  const logoUrl = input.assets.find(
    (asset) => effectiveAssetRole(asset) === "logo",
  )?.url ?? input.fallbackLogoUrl;
  const overlay = await applyBrandOverlayIfConfigured({
    sourceVideoUrl: input.sourceVideoUrl,
    logoUrl,
    brandName: input.plan.brandName,
    config: {
      enabled: true,
      placement: input.plan.logoOverlayPlacement ?? "top-left",
      opacity: 0.9,
      logoWidthRatio: 0.16,
      marginPx: 32,
      durationMode: "full_video",
    },
  });
  input.warnings.push(...overlay.warnings);
  if (!overlay.applied || !overlay.overlayUrl) return input.sourceVideoUrl;
  try {
    const { runFfmpegNormalizeAndConcat } = await import(
      "@/lib/services/stitch-service"
    );
    return await runFfmpegNormalizeAndConcat({
      finalVideoId: `${input.finalVideoId}-brand-overlay`,
      aspectRatio: input.aspectRatio,
      clips: [{
        url: overlay.overlayUrl,
        intendedDurationSec: null,
        trimToFit: false,
      }],
    });
  } catch {
    input.warnings.push("Brand logo overlay could not be persisted; the clean assembled video was kept.");
    return input.sourceVideoUrl;
  }
}

interface ResolveArgs {
  assemblyPlan: AssemblyPlan;
  brandPackaging: BrandPackagingPlan;
  classifiedAssets: UploadedAsset[];
  brandKit: { logoUrl?: string | null } | null;
  aiJobs: Array<{
    id: string;
    segmentIndex: number | null;
    outputVideoUrl: string | null;
  }>;
  briefId: string;
  aspectRatio: string;
  warnings: string[];
}

async function resolveClips(args: ResolveArgs): Promise<AssemblyClipInput[]> {
  const {
    assemblyPlan,
    brandPackaging,
    classifiedAssets,
    brandKit,
    aiJobs,
    briefId,
    aspectRatio,
    warnings,
  } = args;

  const orderedClips = [...assemblyPlan.clips].sort(
    (a, b) => a.segmentOrder - b.segmentOrder,
  );

  /// 给 ai_generated_clip 算「这是第几个 AI 段」（0-based），与 VideoJob.segmentIndex 对齐
  const aiClipsBefore = new Map<number, number>();
  let aiCounter = 0;
  for (const c of orderedClips) {
    if (c.sourceType === "ai_generated_clip") {
      aiClipsBefore.set(c.segmentOrder, aiCounter);
      aiCounter += 1;
    }
  }

  const assetIndex = new Map(classifiedAssets.map((a) => [a.id, a]));
  const logoUrl =
    classifiedAssets.find((a) => effectiveAssetRole(a) === "logo")?.url ??
    brandKit?.logoUrl ??
    null;

  const out: AssemblyClipInput[] = [];

  for (const clip of orderedClips) {
    const intendedDur = Math.max(1, clip.toSec - clip.fromSec);

    if (clip.sourceType === "ai_generated_clip") {
      const aiIdx = aiClipsBefore.get(clip.segmentOrder) ?? 0;
      const job = aiJobs.find((j) => j.segmentIndex === aiIdx);
      if (!job?.outputVideoUrl) {
        warnings.push(
          `AI clip @ segmentOrder=${clip.segmentOrder} (aiIdx=${aiIdx}) missing outputVideoUrl, skipped.`,
        );
        continue;
      }
      out.push({
        segmentOrder: clip.segmentOrder,
        type: "ai_generated_clip",
        url: job.outputVideoUrl,
        intendedDurationSec: intendedDur,
        trimToFit: true,
        notes: `AI seg ${aiIdx}`,
      });
      continue;
    }

    if (clip.sourceType === "uploaded_clip") {
      const asset = clip.uploadedAssetId ? assetIndex.get(clip.uploadedAssetId) : null;
      if (!asset) {
        warnings.push(
          `Uploaded clip asset id=${clip.uploadedAssetId ?? "null"} not found in classifiedAssets, skipped.`,
        );
        continue;
      }
      if (asset.type !== "VIDEO") {
        warnings.push(
          `Uploaded asset id=${asset.id} is type=${asset.type}; cannot use as clip, skipped.`,
        );
        continue;
      }
      out.push({
        segmentOrder: clip.segmentOrder,
        type: "uploaded_clip",
        url: asset.url,
        intendedDurationSec: intendedDur,
        trimToFit: true,
        notes: `uploaded ${effectiveAssetRole(asset)}`,
      });
      continue;
    }

    if (clip.sourceType === "brand_end_card" || clip.sourceType === "cta_card") {
      const rendered = await renderBrandEndCard({
        briefId,
        aspectRatio,
        plan: brandPackaging,
        logoUrl,
      });
      if (!rendered) {
        warnings.push(
          `Brand end card requested but renderer returned null (mode=${brandPackaging.mode}); skipped.`,
        );
        continue;
      }
      if (rendered.warnings?.length) warnings.push(...rendered.warnings);
      if (!rendered.url) {
        warnings.push(
          `Brand end card not produced (source=${rendered.source}); skipped.`,
        );
        continue;
      }
      out.push({
        segmentOrder: clip.segmentOrder,
        type: clip.sourceType,
        url: rendered.url,
        intendedDurationSec: rendered.durationSec,
        trimToFit: false,
        notes: `end card (${rendered.source})`,
      });
      continue;
    }
  }

  return out;
}

function extractBrandKit(
  productInput: unknown,
): { logoUrl?: string | null } | null {
  if (!productInput || typeof productInput !== "object") return null;
  const root = productInput as Record<string, unknown>;
  const brandKit = root.brandKit;
  if (!brandKit || typeof brandKit !== "object") return null;
  const bk = brandKit as Record<string, unknown>;
  const logoUrl = typeof bk.logoUrl === "string" ? bk.logoUrl : null;
  return { logoUrl };
}

/// 仅供测试导入（纯函数辅助）
export const __test__ = {
  extractBrandKit,
};
