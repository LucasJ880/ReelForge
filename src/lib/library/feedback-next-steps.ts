import type { VideoFeedbackReason } from "@/lib/contracts/video-feedback";

/**
 * 不满意之后的下一步（2026-11-10）：按原因把商家指到能解决它的那个动作上，先便宜的、后贵的——
 * 能只重新合成的不重拍，能只重拍一段的不整条重来。原来只有一句固定的话，让商家自己在页面上找。
 *
 *   口播或字幕有问题      → 换字幕 / 配乐 / 落款（只重新合成，不扣额度）
 *   商品不像 / 动作不自然 → 重做这一段（扣 1 段），不行再整条重做
 *   没按我说的拍 / 其他   → 带着素材回创作页改描述再做一条
 *
 * 纯函数：客户端组件与测试共用。页面上没有的动作（例如这条成片不能重拼）不出现。
 */
export const FEEDBACK_NEXT_STEPS = ["restitch", "redo_segment", "make_another"] as const;
export type FeedbackNextStep = (typeof FEEDBACK_NEXT_STEPS)[number];

const STEPS_BY_REASON: Record<VideoFeedbackReason, readonly FeedbackNextStep[]> = {
  voice_caption: ["restitch"],
  product_mismatch: ["redo_segment", "make_another"],
  unnatural_motion: ["redo_segment", "make_another"],
  off_brief: ["make_another"],
  other: ["make_another"],
};

export function feedbackNextSteps(
  reasons: ReadonlyArray<VideoFeedbackReason>,
  available: Readonly<Record<FeedbackNextStep, boolean>>,
): FeedbackNextStep[] {
  const wanted = new Set(reasons.flatMap((reason) => STEPS_BY_REASON[reason] ?? []));
  /// 固定顺序（便宜的在前），不跟着商家点原因的先后变
  return FEEDBACK_NEXT_STEPS.filter((step) => wanted.has(step) && available[step]);
}
