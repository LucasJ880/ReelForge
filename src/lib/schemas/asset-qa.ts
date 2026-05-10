import { z } from "zod";

/**
 * Asset QA 结果 schema —— 规则引擎 + (可选) AI vision 输出统一格式。
 *
 * 规则引擎默认实现见 src/lib/services/asset-qa-service.ts，覆盖：
 *  - mime / size / duration / resolution / orientation / aspect_ratio
 *  - 必拍镜头是否齐全（缺则在 missing-shot 维度上报）
 * 后续可在 vision 字段挂 AI 评分（清晰度/抖动/曝光/音频质量），不破坏 schema。
 */

export const QA_CHECK_RULES = [
  "mime_supported",
  "size_within_limit",
  "duration_within_range",
  "resolution_acceptable",
  "orientation_matches_target",
  "aspect_ratio_matches_target",
  "audio_present",
  "vision_clarity",
  "vision_shake",
  "vision_brightness",
  "matched_to_required_shot",
] as const;
export type QACheckRule = (typeof QA_CHECK_RULES)[number];

export const qaCheckSchema = z.object({
  rule: z.enum(QA_CHECK_RULES),
  passed: z.boolean(),
  severity: z.enum(["info", "warning", "error"]).default("info"),
  message: z.string().min(1).max(400),
  /// 可选的指标值，便于前端展示（如 fileSize=120MB / aspectRatio=9:16）
  measuredValue: z.union([z.string(), z.number(), z.null()]).optional(),
});

export const qaResultSchema = z.object({
  /// 整体结论；与 Prisma 的 AssetQAStatus 对齐
  status: z.enum([
    "PENDING",
    "USABLE",
    "BARELY_USABLE",
    "RETAKE_RECOMMENDED",
  ]),
  /// 0-100 综合分（>=80 USABLE，60-79 BARELY，<60 RETAKE）
  score: z.number().int().min(0).max(100),
  orientation: z.enum(["portrait", "landscape", "square", "unknown"]),
  aspectRatio: z.string().min(1).max(20),
  checks: z.array(qaCheckSchema).min(1),
  /// 总结性原因（中文，1-3 条），适合直接展示给商家
  reasons: z.array(z.string().min(1).max(280)).default([]),
  /// 重拍/补拍建议（中文，1-3 条）
  retakeSuggestions: z.array(z.string().min(1).max(280)).default([]),
});

export type QAResult = z.infer<typeof qaResultSchema>;
export type QACheck = z.infer<typeof qaCheckSchema>;

/** Missing-shot 检测结果（针对一个 DeliveryOrder 的整体素材清单） */
export const missingShotSchema = z.object({
  scenePlanId: z.string().min(1),
  sceneIndex: z.number().int().positive(),
  visualIntent: z.string().min(1).max(400),
  required: z.boolean(),
  /// 是否已经有素材匹配上
  matched: z.boolean(),
  reason: z.string().max(280).optional(),
});

export const missingShotReportSchema = z.object({
  total: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  missingRequired: z.number().int().nonnegative(),
  shots: z.array(missingShotSchema).default([]),
});

export type MissingShotReport = z.infer<typeof missingShotReportSchema>;
export type MissingShotRow = z.infer<typeof missingShotSchema>;

export function parseQAResult(value: unknown): QAResult {
  const parsed = qaResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `QAResult 校验失败：${formatIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}

export function parseMissingShotReport(value: unknown): MissingShotReport {
  const parsed = missingShotReportSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `MissingShotReport 校验失败：${formatIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}

function formatIssues(issues: z.ZodIssue[]) {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}
