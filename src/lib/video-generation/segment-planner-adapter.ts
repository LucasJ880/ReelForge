/**
 * Phase 5 — Segment planner adapter.
 *
 * 薄包装 src/lib/duration/segment-planner.ts，唯一不同：
 * - 输入除了 duration，还接收 ClipPlacementPlan，会把上传 clip 替换 / 插入到合适 segment 位置。
 * - 输出仍是 SegmentSlot 但每个 slot 多一个 source: "ai" | "uploaded" | "brand_end_card"。
 *
 * 注意：本模块**不重写**时长 → 段数映射的规则；这条规则只在 segment-planner.ts 维护。
 */

import {
  planSegments as planRawSegments,
  type SegmentSlot,
  type SegmentRole as DurationSegmentRole,
  type SupportedDurationSec,
} from "@/lib/duration/segment-planner";
import type { AspectRatio, ClipPlacementPlan, BrandPackagingPlan, BrandEndingMode } from "@/types/video-generation";

export interface UnifiedSegmentSlot extends SegmentSlot {
  source: "ai" | "uploaded" | "brand_end_card";
  uploadedAssetId?: string | null;
}

export interface PlanUnifiedSegmentsArgs {
  targetDurationSec: SupportedDurationSec;
  clipPlacement?: ClipPlacementPlan | null;
  brandPackaging?: BrandPackagingPlan | null;
}

/**
 * 输出最终段序列（AI 段 + 上传 clip 段 + brand end card 段）。
 *
 * 规则：
 * 1. 先用 segment-planner 拿到基础 AI 段。
 * 2. 对 clipPlacement.decisions 按位置插入或替换。
 * 3. 末尾追加 brand end card（如果 brandPackaging.endCardDurationSeconds > 0）。
 *
 * 不在这里做总时长强制对齐；assembly-plan 负责最终归一化。
 */
export function planUnifiedSegments(
  args: PlanUnifiedSegmentsArgs,
): UnifiedSegmentSlot[] {
  const { targetDurationSec, clipPlacement, brandPackaging } = args;

  const aiSlots: UnifiedSegmentSlot[] = planRawSegments(targetDurationSec).map(
    (s) => ({ ...s, source: "ai" }),
  );

  /// Apply clip placement: replace 或 insert
  const slots = [...aiSlots];
  const decisions = clipPlacement?.decisions ?? [];

  // 先处理 "replacesAISegment=true" — 用上传 clip 直接换掉某个 AI 段
  for (const d of decisions.filter((x) => x.replacesAISegment)) {
    const target = slots.find((s) => s.segmentIndex === d.targetSegmentOrder);
    if (target) {
      target.source = "uploaded";
      target.uploadedAssetId = d.uploadedAssetId;
    }
  }

  // 再处理 "insert" — 在 targetSegmentOrder 位置插入新段（不改 segmentIndex 一致性，
  // 因为 video-service 里 multi-segment 只关心 plan 顺序，segmentIndex 用于 Seedance job 索引）
  for (const d of decisions.filter((x) => !x.replacesAISegment)) {
    const insertAt = slots.findIndex((s) => s.segmentIndex === d.targetSegmentOrder);
    const idx = insertAt < 0 ? slots.length : insertAt;
    slots.splice(idx, 0, {
      segmentIndex: slots.length,
      durationSec: 0, // 真实时长由 video-assembly-plan 从上传 asset metadata 推断
      role: clipRoleForPosition(d.position),
      source: "uploaded",
      uploadedAssetId: d.uploadedAssetId,
    });
  }

  // brand end card
  if (
    brandPackaging &&
    brandPackaging.mode !== "none" &&
    brandPackaging.endCardDurationSeconds > 0 &&
    brandPackaging.renderStrategy !== "use_uploaded_clip"
  ) {
    // 注意：use_uploaded_clip 已通过 clipPlacement(outro_clip → end) 加进去了，这里就不再追加
    slots.push({
      segmentIndex: slots.length,
      durationSec: brandPackaging.endCardDurationSeconds,
      role: "cta",
      source: "brand_end_card",
    });
  }

  return slots.map((s, i) => ({ ...s, segmentIndex: i }));
}

function clipRoleForPosition(
  position: "beginning" | "middle" | "before_cta" | "end",
): DurationSegmentRole {
  switch (position) {
    case "beginning":
      return "intro";
    case "middle":
      return "demo";
    case "before_cta":
      return "benefit";
    case "end":
      return "cta";
  }
}

/** 把 aspect ratio 映射到 Seedance 真实分辨率（与 director-service 保持一致） */
export function resolutionForAspectRatio(aspectRatio: AspectRatio): string {
  switch (aspectRatio) {
    case "9:16":
      return "1080x1920";
    case "16:9":
      return "1920x1080";
    case "1:1":
      return "1080x1080";
  }
}

/** Re-exports for convenience */
export { planRawSegments };
export type { SupportedDurationSec, SegmentSlot, BrandEndingMode };
