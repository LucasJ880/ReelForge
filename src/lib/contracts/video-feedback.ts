import { z } from "zod";

/**
 * 商家对成片的评价（2026-11-10）。纯契约：客户端组件、接口与测试共用，不引服务端模块。
 *
 * 原因的取法：今天两轮盲评里真人指出的问题只有这几类——商品不像 / 画面动作不合理（往杯子外倒水、
 * 背着包却从身后把包打开）/ 没按描述拍 / 口播字幕。再多的分类商家不会选，统计也散。
 */
export const VIDEO_FEEDBACK_REASONS = [
  "product_mismatch",
  "unnatural_motion",
  "off_brief",
  "voice_caption",
  "other",
] as const;

export type VideoFeedbackReason = (typeof VIDEO_FEEDBACK_REASONS)[number];
export type VideoFeedbackRating = "up" | "down";

export const VIDEO_FEEDBACK_NOTE_MAX = 500;

export const videoFeedbackInputSchema = z
  .object({
    rating: z.enum(["up", "down"]),
    reasons: z.array(z.enum(VIDEO_FEEDBACK_REASONS)).max(VIDEO_FEEDBACK_REASONS.length).default([]),
    note: z.string().trim().max(VIDEO_FEEDBACK_NOTE_MAX).optional(),
  })
  .strict()
  /// 满意不带原因；不满意的原因去重
  .transform((input) => ({
    rating: input.rating,
    reasons: input.rating === "up" ? [] : [...new Set(input.reasons)],
    note: input.rating === "up" ? null : input.note || null,
  }));

export type VideoFeedbackInput = z.infer<typeof videoFeedbackInputSchema>;

export type VideoFeedbackView = {
  rating: VideoFeedbackRating;
  reasons: VideoFeedbackReason[];
  note: string | null;
};

const REASON_SET: ReadonlySet<string> = new Set(VIDEO_FEEDBACK_REASONS);

/** 库里读回来的一行 → 视图；认不出的评分当作没评，认不出的原因丢掉（旧值 / 手改数据不让页面崩）。 */
export function toVideoFeedbackView(
  row: { rating: string; reasons: string[]; note: string | null } | null | undefined,
): VideoFeedbackView | null {
  if (!row || (row.rating !== "up" && row.rating !== "down")) return null;
  return {
    rating: row.rating,
    reasons: row.reasons.filter((reason): reason is VideoFeedbackReason => REASON_SET.has(reason)),
    note: row.note,
  };
}

export type VideoFeedbackSummary = {
  total: number;
  up: number;
  down: number;
  /** 满意率 0–100；一条评价都没有时为 null（不写 0% 也不写 100%）。 */
  satisfactionRate: number | null;
  reasons: Record<VideoFeedbackReason, number>;
};

/** 汇总一批评价：满意率与各原因出现次数（一条不满意可以带多个原因）。 */
export function summarizeVideoFeedback(
  rows: ReadonlyArray<{ rating: string; reasons: readonly string[] }>,
): VideoFeedbackSummary {
  const reasons = Object.fromEntries(VIDEO_FEEDBACK_REASONS.map((reason) => [reason, 0])) as Record<VideoFeedbackReason, number>;
  let up = 0;
  let down = 0;
  for (const row of rows) {
    if (row.rating === "up") up += 1;
    else if (row.rating === "down") {
      down += 1;
      for (const reason of new Set(row.reasons)) {
        if (REASON_SET.has(reason)) reasons[reason as VideoFeedbackReason] += 1;
      }
    }
  }
  const total = up + down;
  return { total, up, down, satisfactionRate: total > 0 ? Math.round((up / total) * 100) : null, reasons };
}
