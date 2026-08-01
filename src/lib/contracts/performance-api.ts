import { z } from "zod";

/**
 * R2 · 表现回流契约（PRD §4 / M2）。
 *
 * 青砚发布之后把渠道指标回灌给我们。方向与 `/api/videos` 相反：
 * 那条是它拉我们的成片，这条是它推表现数据回来。
 *
 * 为什么是推不是拉：指标在**它**手里（它持有平台 OAuth），
 * 我们没有账号授权，拉不到。
 */

/// 我们只接受能对上 subject 的回流。对不上的数据进来也没法归因，只会污染统计。
export const performanceSubjectTypeSchema = z.enum(["video", "post"]);

/**
 * 观测窗口。与青砚已有的 12/24/48h 快照节奏对齐。
 * 允许其他值，但要显式传 —— 不给默认值，避免「不知道这是几小时的数据」。
 */
export const performanceWindowSchema = z.number().int().positive().max(24 * 90);

const counter = z.number().int().nonnegative().nullish();

export const performanceSampleSchema = z.object({
  subjectType: performanceSubjectTypeSchema,
  /// 我方的 id：video 用 VideoJob.id，post 用 ContentPost.id。
  /// 与 `/api/videos` 给出的 `id` 去掉 `batch-` / `brief-` 前缀后一致。
  subjectId: z.string().min(1),
  platform: z.string().min(1).max(50),
  externalPostId: z.string().min(1).max(200).nullish(),
  windowHours: performanceWindowSchema,
  observedAt: z.coerce.date(),

  /// 分母。两者都可缺 —— 不同平台口径不同，缺就是缺，**我们不换算**。
  impressions: counter,
  views: counter,

  likes: counter,
  comments: counter,
  shares: counter,
  saves: counter,
  clicks: counter,
  conversions: counter,
});

export type PerformanceSample = z.infer<typeof performanceSampleSchema>;

export const performanceIngestRequestSchema = z.object({
  /// 一次最多 500 条：青砚的量级是 200 条/天，批量回灌不该超过这个数量级。
  samples: z.array(performanceSampleSchema).min(1).max(500),
});

export const performanceIngestResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  /// 对不上 subject 的条数。持续大于 0 说明两边 id 对不齐，要查而不是忽略。
  unmatched: z.number().int().nonnegative(),
  /// 对上了但该内容没有配方（历史成片）。这些数据存下来，但进不了配方统计。
  withoutRecipe: z.number().int().nonnegative(),
});

export type PerformanceIngestResponse = z.infer<
  typeof performanceIngestResponseSchema
>;
