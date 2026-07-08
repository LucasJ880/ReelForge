import {
  FinalVideoStatus,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { renderBrandEndCard } from "@/lib/video-generation/brand-end-card-renderer";
import {
  effectiveAssetRole,
  type AssemblyClip,
  type AssemblyPlan,
  type AspectRatio,
  type BrandPackagingPlan,
  type SegmentType,
  type UploadedAsset,
  type VideoGenerationPlan,
} from "@/types/video-generation";

/**
 * Phase 2 · L3 — Assembly Executor。
 *
 * 职责：把 VideoGenerationPlan.assemblyPlan.clips 里的每个 clip 真的物化成
 *      可拼接 URL（http(s) / file://），交给 stitch-service 完成最终 ffmpeg。
 *
 *  - ai_generated_clip → 找对应 VideoJob.outputVideoUrl
 *  - uploaded_clip     → 找 classifiedAssets[id].url
 *  - brand_end_card    → renderBrandEndCard 现场渲染
 *  - cta_card          → Phase 2 视为 brand_end_card（同一份模板）
 *
 * 不真的跑 ffmpeg；ffmpeg 由 stitch-service.runFfmpegNormalizeAndConcat 统一处理。
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
  /// 调试用：实际收齐的 clip URL 列表（在 stitch 之前）
  resolvedClips?: AssemblyClipInput[];
  skipped?: boolean;
}

/**
 * 主入口：执行 finalVideoId 的完整组装。
 *
 * - 找 brief.videoGenerationPlan
 * - 解析 assemblyPlan.clips
 * - 收齐每段 URL（AI VideoJob / uploaded asset / 现场渲染 end card）
 * - 调 stitch-service.runFfmpegNormalizeAndConcat
 * - 写回 FinalVideo + brief 状态
 */
export async function executeAssembly(
  finalVideoId: string,
): Promise<AssembleResult> {
  const fv = await db.finalVideo.findUnique({
    where: { id: finalVideoId },
    include: {
      brief: {
        select: {
          id: true,
          aspectRatio: true,
          videoGenerationPlan: true,
          contentAngle: {
            select: {
              round: {
                select: {
                  deliveryOrder: { select: { productInput: true } },
                },
              },
            },
          },
        },
      },
      segments: { orderBy: { segmentIndex: "asc" } },
    },
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

  const plan = fv.brief?.videoGenerationPlan as
    | VideoGenerationPlan
    | null
    | undefined;
  /// 没有 unified plan 的旧 brief（含 Sunny Shutter）→ 不在本 executor 范围
  if (!plan?.assemblyPlan) {
    return {
      finalVideoId,
      ok: false,
      status: fv.status,
      skipped: true,
      warnings: ["No unified VideoGenerationPlan; falling back to legacy stitch."],
    };
  }

  /// 段必须齐 + 全 SUCCEEDED 才能开拼（否则等下一轮 cron）
  const aiJobs = fv.segments;
  const allAiSucceeded =
    aiJobs.length === fv.segmentCount &&
    aiJobs.every(
      (s) => s.status === VideoJobStatus.SUCCEEDED && !!s.outputVideoUrl,
    );
  if (!allAiSucceeded) {
    return {
      finalVideoId,
      ok: false,
      status: FinalVideoStatus.PENDING,
      skipped: true,
      warnings: ["Not all AI segments succeeded yet."],
    };
  }

  const aspectRatio = (fv.brief?.aspectRatio ?? "9:16") as AspectRatio;
  const warnings: string[] = [];

  /// 解析 brandKit logoUrl 用于 end card 渲染
  const brandKitFromOrder = extractBrandKit(
    fv.brief?.contentAngle?.round?.deliveryOrder?.productInput ?? null,
  );

  let resolvedClips: AssemblyClipInput[];
  try {
    resolvedClips = await resolveClips({
      assemblyPlan: plan.assemblyPlan,
      brandPackaging: plan.brandPackagingPlan,
      classifiedAssets: plan.classifiedAssets ?? [],
      brandKit: brandKitFromOrder,
      aiJobs,
      briefId: fv.brief?.id ?? finalVideoId,
      aspectRatio,
      warnings,
    });
  } catch (err) {
    return {
      finalVideoId,
      ok: false,
      status: FinalVideoStatus.FAILED,
      error: `Resolve clips failed: ${(err as Error).message}`,
      warnings,
    };
  }

  if (resolvedClips.length === 0) {
    return {
      finalVideoId,
      ok: false,
      status: FinalVideoStatus.FAILED,
      error: "No assemblable clips found",
      warnings,
    };
  }

  /// 单 clip 直通：不需要拼接，直接复用该 clip URL
  if (resolvedClips.length === 1) {
    const only = resolvedClips[0];
    const { isEphemeralSignedUrl } = await import(
      "@/lib/services/stitch-service"
    );
    /// 单 clip 是 AI 段且 URL 是公网 https 时直接复用；其他情况仍要走 stitch 来归一化。
    /// 临时签名 URL（Seedance TOS 24h 过期）除外 —— 必须走 stitch 转存持久存储，
    /// 否则成片链接一天后 403。
    if (
      only.type === "ai_generated_clip" &&
      /^https?:\/\//.test(only.url) &&
      !isEphemeralSignedUrl(only.url)
    ) {
      await db.finalVideo.update({
        where: { id: fv.id },
        data: {
          status: FinalVideoStatus.READY,
          stitchedVideoUrl: only.url,
          finishedAt: new Date(),
        },
      });
      if (fv.brief?.id) await markBriefReady(fv.brief.id);
      return {
        finalVideoId,
        ok: true,
        status: FinalVideoStatus.READY,
        stitchedVideoUrl: only.url,
        warnings,
        resolvedClips,
      };
    }
  }

  /// CAS PENDING → STITCHING
  const claim = await db.finalVideo.updateMany({
    where: { id: fv.id, status: FinalVideoStatus.PENDING },
    data: {
      status: FinalVideoStatus.STITCHING,
      startedAt: new Date(),
      ffmpegError: null,
    },
  });
  if (claim.count === 0) {
    return {
      finalVideoId,
      ok: false,
      status: fv.status,
      skipped: true,
      warnings,
    };
  }

  let stitchedUrl: string | null = null;
  let error: string | null = null;
  try {
    const { runFfmpegNormalizeAndConcat } = await import(
      "@/lib/services/stitch-service"
    );
    stitchedUrl = await runFfmpegNormalizeAndConcat({
      finalVideoId,
      aspectRatio,
      clips: resolvedClips.map((c) => ({
        url: c.url,
        intendedDurationSec: c.intendedDurationSec,
        trimToFit: c.trimToFit,
      })),
    });
  } catch (err) {
    error = (err as Error).message;
  }

  if (stitchedUrl) {
    await db.finalVideo.update({
      where: { id: fv.id },
      data: {
        status: FinalVideoStatus.READY,
        stitchedVideoUrl: stitchedUrl,
        finishedAt: new Date(),
        stitchAttempts: fv.stitchAttempts + 1,
      },
    });
    if (fv.brief?.id) await markBriefReady(fv.brief.id);
    return {
      finalVideoId,
      ok: true,
      status: FinalVideoStatus.READY,
      stitchedVideoUrl: stitchedUrl,
      warnings,
      resolvedClips,
    };
  }

  await db.finalVideo.update({
    where: { id: fv.id },
    data: {
      status: FinalVideoStatus.FAILED,
      ffmpegError: error,
      finishedAt: new Date(),
      stitchAttempts: fv.stitchAttempts + 1,
    },
  });
  return {
    finalVideoId,
    ok: false,
    status: FinalVideoStatus.FAILED,
    error,
    warnings,
    resolvedClips,
  };
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

async function markBriefReady(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    select: { finalVideo: true },
  });
  if (!brief?.finalVideo) return;
  await db.videoBrief.update({
    where: { id: briefId },
    data: {
      status: VideoBriefStatus.QA_PENDING,
      finalVideoUrl: brief.finalVideo.stitchedVideoUrl,
      finalThumbnailUrl: brief.finalVideo.thumbnailUrl,
    },
  });
  const existing = await db.qAReview.findFirst({
    where: { videoBriefId: briefId, status: "PENDING" },
  });
  if (!existing) {
    await db.qAReview.create({
      data: { videoBriefId: briefId, status: "PENDING" },
    });
  }
}

/// 仅供测试导入（纯函数辅助）
export const __test__ = {
  extractBrandKit,
};
