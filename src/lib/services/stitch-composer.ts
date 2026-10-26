import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import {
  StitchCompositionError,
  type MediaBudget,
  type TimelineClipReport,
} from "@/lib/media/stitch-pipeline";
import { readDirectorPlanVoiceoverChunks } from "@/lib/schemas/director-plan";
import { DEFAULT_TAIL_TRIM_SECONDS } from "@/lib/video-generation/tail-trim";
import type { UploadedAsset } from "@/types/video-generation";
import {
  composeAndPersistTimeline,
  extractBrollClaimSegments,
  isStitchCandidateReady,
  parsePersistedPostProduction,
  planHasUnifiedAssembly,
  type NormalizeAndConcatClip,
} from "./stitch-service";

/**
 * 应用内合成器的编排层（C3：生产 inprocess 与开发 local 唯一的合成入口）。
 *
 * 按 FinalVideo 的形态挑分支，组出时间线，交给 composeAndPersistTimeline：
 *   - b-roll   ：图库素材画面（循环补长）+ TTS 配音（替换素材原声，必须在），单遍合成
 *   - assembly ：unified plan 的 assemblyPlan —— AI 段 + 客户上传片段 + 客户选的品牌尾卡 /
 *                CTA 卡（现场渲染），trimToFit、字幕窗口（尾卡不背字幕）、logo 角标策略
 *   - legacy   ：没有 unified plan 的多段 / 单段 AI 视频
 * AI 生成段默认做语音安全裁尾（杀尾帧幻觉出的假名片 / 乱码电话，不切口播）；
 * b-roll、客户上传片段、尾卡不裁。
 *
 * 只读数据库、不写库：结果由 runClaimedStitchAttempt 交给唯一成功写入点 finishStitchTask。
 */

export type ComposeBranch = "broll" | "assembly" | "legacy";

export interface ComposedFinalVideo {
  stitchedVideoUrl: string;
  thumbnailUrl: string | null;
  subtitleFileUrl: string | null;
  branch: ComposeBranch;
  durationSec: number;
  captionWindowSec: number | null;
  warnings: string[];
  clips: TimelineClipReport[];
  timings: Record<string, number>;
}

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * AI 段默认裁尾秒数：STITCH_AI_TAIL_TRIM_SEC（默认 0.8，与品牌封装同值；0 / off 关闭）。
 * 语音安全：口播讲到片尾时自动缩短甚至放弃；裁完不足 5s 的短段不裁。
 */
export function resolveAiTailTrimSeconds(env: Env = process.env): number {
  const raw = (env.STITCH_AI_TAIL_TRIM_SEC ?? "").trim().toLowerCase();
  if (!raw) return DEFAULT_TAIL_TRIM_SECONDS;
  if (raw === "off" || raw === "false" || raw === "none") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_TAIL_TRIM_SECONDS;
  return Math.min(value, 3);
}

/**
 * 纯函数：assembly 片段 → 时间线片段（裁尾只给 AI 段；尾卡 / CTA 卡不背字幕）。
 */
export function assemblyClipsToTimeline(
  clips: Array<{
    type: string;
    url: string;
    intendedDurationSec: number;
    trimToFit: boolean;
  }>,
  aiTailTrimSec: number,
): NormalizeAndConcatClip[] {
  return clips.map((clip) => {
    const isEndCard = clip.type === "brand_end_card" || clip.type === "cta_card";
    const isAi = clip.type === "ai_generated_clip";
    return {
      url: clip.url,
      intendedDurationSec: clip.intendedDurationSec,
      trimToFit: clip.trimToFit,
      role: isAi ? "ai_generated" : isEndCard ? "end_card" : clip.type === "uploaded_clip" ? "uploaded" : "other",
      ...(isAi && aiTailTrimSec > 0 ? { tailTrimSec: aiTailTrimSec } : {}),
      ...(isEndCard ? { excludeFromCaptions: true } : {}),
    } satisfies NormalizeAndConcatClip;
  });
}

/**
 * 纯函数：legacy 段（全部是 AI 生成段）→ 时间线片段。
 * 段的计划时长（VideoJob.segmentDurationSec）只给字幕：旧数据没有持久化台词时按它切，
 * 不按语音安全裁尾后的实测（实测不等长会把语句边界吸偏）。不填 intendedDurationSec，裁剪规则不变。
 */
export function legacySegmentsToTimeline(
  segments: Array<{ outputVideoUrl: string | null; segmentDurationSec?: number | null }>,
  aiTailTrimSec: number,
): NormalizeAndConcatClip[] {
  return segments.map((segment) => ({
    url: segment.outputVideoUrl as string,
    intendedDurationSec: null,
    trimToFit: false,
    role: "ai_generated" as const,
    ...(aiTailTrimSec > 0 ? { tailTrimSec: aiTailTrimSec } : {}),
    ...(segment.segmentDurationSec && segment.segmentDurationSec > 0
      ? { plannedDurationSec: segment.segmentDurationSec }
      : {}),
  }));
}

export async function composeFinalVideoForStitch(args: {
  finalVideoId: string;
  budget?: MediaBudget;
  checkpoint?: () => Promise<void>;
  env?: Env;
}): Promise<ComposedFinalVideo> {
  const env = args.env ?? process.env;
  const fv = await db.finalVideo.findUnique({
    where: { id: args.finalVideoId },
    include: {
      brief: {
        select: {
          id: true,
          aspectRatio: true,
          videoGenerationPlan: true,
          /// P04-C：各段台词（segmentPlan[].voiceoverChunk）给字幕逐段对齐
          directorPlan: true,
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
    throw new StitchCompositionError("FINAL_VIDEO_MISSING", "FinalVideo 不存在");
  }
  if (!isStitchCandidateReady(fv)) {
    throw new StitchCompositionError(
      "SEGMENTS_NOT_READY",
      "not every segment has SUCCEEDED with an output URL",
    );
  }
  let postProduction;
  try {
    postProduction = parsePersistedPostProduction(fv.postProduction);
  } catch (err) {
    throw new StitchCompositionError("POST_PRODUCTION_INVALID", (err as Error).message);
  }
  const aspectRatio = fv.brief?.aspectRatio || "9:16";
  const aiTailTrimSec = resolveAiTailTrimSeconds(env);
  const warnings: string[] = [];
  /// 派发时持久化的各 AI 段台词；旧计划没有 → null，字幕按计划时长重切
  const voiceoverChunks = readDirectorPlanVoiceoverChunks(fv.brief?.directorPlan);

  // ---------------- b-roll ----------------
  const brollSegments = extractBrollClaimSegments(fv.segments);
  if (brollSegments) {
    const brollAspect = aspectRatio === "16:9" ? "16:9" : "9:16";
    const workDir = path.join(
      os.tmpdir(),
      `aivora-broll-compose-${args.finalVideoId.replace(/[^A-Za-z0-9_-]/g, "_")}-${Date.now()}`,
    );
    await mkdir(workDir, { recursive: true });
    try {
      /// 动态 import：broll-assembly-service 静态依赖 stitch-service（同步交付路径）
      const { prepareBrollTimelineClips, BROLL_FRAME_RATE } = await import(
        "@/lib/services/broll-assembly-service"
      );
      /// 素材画面 + 配音（替换素材原声）+ 段长由配音实测驱动；配音必须在（不交付哑片）
      const clips = await prepareBrollTimelineClips({
        segments: brollSegments,
        workDir,
        budget: args.budget,
        checkpoint: args.checkpoint,
      });
      const result = await composeAndPersistTimeline({
        finalVideoId: args.finalVideoId,
        aspectRatio: brollAspect,
        clips,
        frameRate: BROLL_FRAME_RATE,
        postProduction,
        extractThumbnail: true,
        budget: args.budget,
        checkpoint: args.checkpoint,
      });
      return { ...result, branch: "broll", warnings };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  // ---------------- unified assembly ----------------
  if (planHasUnifiedAssembly(fv.brief?.videoGenerationPlan)) {
    const { resolveAssemblyInputs, applyAssemblyLogoOverlay } = await import(
      "@/lib/video-generation/assembly-executor"
    );
    const inputs = await resolveAssemblyInputs(fv);
    warnings.push(...inputs.warnings);
    await args.checkpoint?.();
    const result = await composeAndPersistTimeline({
      finalVideoId: args.finalVideoId,
      aspectRatio: inputs.aspectRatio,
      clips: assemblyClipsToTimeline(inputs.clips, aiTailTrimSec),
      postProduction,
      voiceoverChunks,
      extractThumbnail: true,
      budget: args.budget,
      checkpoint: args.checkpoint,
    });
    const stitchedVideoUrl = await applyAssemblyLogoOverlay({
      finalVideoId: args.finalVideoId,
      aspectRatio: inputs.aspectRatio,
      sourceVideoUrl: result.stitchedVideoUrl,
      plan: inputs.plan.brandPackagingPlan,
      assets: (inputs.plan.classifiedAssets ?? []) as UploadedAsset[],
      fallbackLogoUrl: inputs.brandKitLogoUrl,
      warnings,
    });
    return { ...result, stitchedVideoUrl, branch: "assembly", warnings };
  }

  // ---------------- legacy ----------------
  const result = await composeAndPersistTimeline({
    finalVideoId: args.finalVideoId,
    aspectRatio,
    clips: legacySegmentsToTimeline(fv.segments, aiTailTrimSec),
    postProduction,
    voiceoverChunks,
    extractThumbnail: true,
    budget: args.budget,
    checkpoint: args.checkpoint,
  });
  return { ...result, branch: "legacy", warnings };
}
