/**
 * Phase 5 — Clip placement planner.
 *
 * 把分类好的上传素材分配到视频时间轴上的合理位置：
 *   - intro_clip → beginning（segment 0）
 *   - product_demo / store / ad_clip → middle 或 before_cta
 *   - outro_clip / logo_animation → end（注意：outro 优先归 brand-packaging 处理）
 *   - logo / product_image / reference_image → 不进时间轴（image-to-video 参考图）
 *   - existing_commercial → middle（容许全段替换 AI）
 *
 * 输出：ClipPlacementPlan，包含 decisions[] 和 warnings[]
 */

import { effectiveAssetRole } from "@/types/video-generation";
import type {
  ClipPlacementPlan,
  ClipPlacementDecision,
  InputClassification,
  UploadedAsset,
} from "@/types/video-generation";
import {
  planRawSegments,
  type SupportedDurationSec,
} from "@/lib/video-generation/segment-planner-adapter";

export interface BuildClipPlacementArgs {
  classifiedAssets: UploadedAsset[];
  classification: InputClassification;
  targetDurationSec: SupportedDurationSec;
  /// 是否会有 brand end card？若 true，前移 outro/logo_animation 到 brand-packaging 接管
  hasBrandEndCard: boolean;
}

export function buildClipPlacementPlan(
  args: BuildClipPlacementArgs,
): ClipPlacementPlan {
  const { classifiedAssets, classification, targetDurationSec, hasBrandEndCard } = args;
  const decisions: ClipPlacementDecision[] = [];
  const warnings: string[] = [];

  const slots = planRawSegments(targetDurationSec);
  const lastIdx = slots.length - 1;

  for (const asset of classifiedAssets) {
    const role = effectiveAssetRole(asset);

    switch (role) {
      case "intro_clip":
        decisions.push({
          uploadedAssetId: asset.id,
          role,
          position: "beginning",
          targetSegmentOrder: 0,
          // intro 短：默认 replace segment 0 的 AI 段（避免过度膨胀总时长）
          replacesAISegment: slots.length > 0,
        });
        break;

      case "outro_clip":
      case "logo_animation":
        if (hasBrandEndCard) {
          // brand-packaging 已经接管；不再单独安排
          break;
        }
        decisions.push({
          uploadedAssetId: asset.id,
          role,
          position: "end",
          targetSegmentOrder: lastIdx + 1, // append
          replacesAISegment: false,
        });
        break;

      case "product_demo_clip":
      case "store_clip":
      case "ad_clip":
      case "existing_commercial":
        decisions.push({
          uploadedAssetId: asset.id,
          role,
          position: classification.needsCTA ? "before_cta" : "middle",
          // 优先放中段的 AI 段（segment 1，如果存在），整段替换
          targetSegmentOrder: pickMiddleIndex(slots.length),
          replacesAISegment: slots.length > 1,
        });
        break;

      case "logo":
      case "product_image":
      case "reference_image":
      case "unknown":
        // 不进时间轴；这些是 prompt-intelligence / brand-packaging 的输入
        break;
    }
  }

  // 多个 ad_clip / store_clip / demo_clip 同时存在 → 提示用户
  const middleClips = decisions.filter(
    (d) =>
      d.role === "ad_clip" ||
      d.role === "store_clip" ||
      d.role === "product_demo_clip" ||
      d.role === "existing_commercial",
  );
  if (middleClips.length > 1) {
    warnings.push(
      `${middleClips.length} mid-segment clips uploaded. Only the first ${middleClips.length === 1 ? "1" : Math.min(slots.length - 1, middleClips.length)} will be placed in the final video; the rest will be ignored or stitched as b-roll.`,
    );
  }

  return { decisions, warnings };
}

function pickMiddleIndex(slotCount: number): number {
  if (slotCount <= 1) return 0;
  if (slotCount === 2) return 1; // hook + cta → middle 不存在；放在 cta 前
  return Math.floor(slotCount / 2);
}
