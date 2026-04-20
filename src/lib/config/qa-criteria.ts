/**
 * QA 八维打分标准。
 *
 * 每个维度打 0-10 分；加权合成 0-100 的 overall_score。
 */

export const QA_CRITERIA = [
  { key: "hook_quality", label: "Hook 质量", weight: 0.18 },
  { key: "topic_alignment", label: "话题契合", weight: 0.1 },
  { key: "angle_alignment", label: "Angle 对齐", weight: 0.12 },
  { key: "format_alignment", label: "格式/节奏", weight: 0.12 },
  { key: "cta_quality", label: "CTA 质量", weight: 0.1 },
  { key: "duration_fitness", label: "时长适配", weight: 0.08 },
  { key: "brief_alignment", label: "Brief 吻合", weight: 0.15 },
  { key: "technical_completeness", label: "技术完整性", weight: 0.15 },
] as const;

export type QACriterionKey = (typeof QA_CRITERIA)[number]["key"];

export type QAScoreBreakdown = Record<QACriterionKey, number>;

/**
 * 基于各维度分数计算总分（0-100）。
 */
export function calcOverallScore(breakdown: QAScoreBreakdown): number {
  const total = QA_CRITERIA.reduce((sum, c) => {
    const s = breakdown[c.key] ?? 0;
    return sum + s * c.weight * 10;
  }, 0);
  return Math.round(total * 10) / 10;
}

/**
 * 决定审核路由：auto_pass / needs_review / reject
 */
export function deriveReviewRoute(score: number): string {
  if (score >= 80) return "auto_pass";
  if (score >= 55) return "needs_review";
  return "reject";
}
