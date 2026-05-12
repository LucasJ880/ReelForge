/**
 * Phase 5 — Video assembly plan.
 *
 * 输入：VideoSegment[] + BrandPackagingPlan + AspectRatio + 时长
 * 输出：AssemblyPlan（描述最终 ffmpeg 拼接的所有 clip 顺序、转场、归一化方案）
 *
 * Phase 1 不真实跑 ffmpeg；这里只生成结构化 plan。
 * stitch-service.ts（已存在）在 dispatch 后实际接到 ffmpeg。
 */

import { resolutionForAspectRatio } from "@/lib/video-generation/segment-planner-adapter";
import type {
  AspectRatio,
  AssemblyClip,
  AssemblyPlan,
  BrandPackagingPlan,
  VideoSegment,
} from "@/types/video-generation";

export interface BuildAssemblyPlanArgs {
  segments: VideoSegment[];
  brandPackaging: BrandPackagingPlan;
  aspectRatio: AspectRatio;
  fps?: number;
}

export function buildAssemblyPlan(
  args: BuildAssemblyPlanArgs,
): AssemblyPlan {
  const { segments, brandPackaging, aspectRatio } = args;
  const fps = args.fps ?? 30;

  const clips: AssemblyClip[] = [];
  let cursor = 0;
  for (const segment of segments) {
    const from = cursor;
    const to = from + segment.durationSeconds;
    clips.push({
      segmentOrder: segment.order,
      sourceType: segment.type,
      uploadedAssetId: segment.uploadedAssetId ?? null,
      sourceVideoJobId: null, // dispatch 时补齐
      fromSec: from,
      toSec: to,
      normalize: true,
    });
    cursor = to;
  }

  /// 转场策略：Phase 1 默认全 cut；多段且段间内容差异大 → match_cut（依赖 LLM continuity notes，Phase 2 再细化）
  const transitions: Array<"cut" | "match_cut" | "fade"> = segments
    .slice(0, Math.max(0, segments.length - 1))
    .map(() => "cut");

  const normalizationPlan = [
    `target: ${resolutionForAspectRatio(aspectRatio)} @ ${fps}fps`,
    "audio: -14 LUFS loudness normalize",
    "video: SAR=1, color grade pass-through (no LUT in Phase 1)",
    "segments are normalized to the target resolution & aspect via ffmpeg scale+pad",
    brandPackaging.mode === "auto_end_card"
      ? "brand end card: rendered separately via ffmpeg drawtext / overlay (Phase 2)"
      : brandPackaging.mode === "uploaded_clip"
        ? "brand end card: uses uploaded clip; normalized to target resolution"
        : "no brand end card",
  ].join(" | ");

  return {
    targetResolution: resolutionForAspectRatio(aspectRatio),
    aspectRatio,
    fps,
    outputCodec: "h264_aac_mp4",
    clips,
    transitions,
    finalDurationSeconds: cursor,
    normalizationPlan,
  };
}
