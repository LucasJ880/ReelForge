import { z } from "zod";

export const unifiedLibraryStatusSchema = z.enum([
  "planning",
  "generating",
  "assembling",
  "ready",
  "failed",
]);

/**
 * Server Component DTO contract. Dates intentionally remain Date instances;
 * this service is consumed directly by SSR pages rather than serialized over
 * an HTTP boundary.
 */
export const unifiedLibraryRowSchema = z.object({
  id: z.string().min(1),
  briefId: z.string().min(1).nullable(),
  /// 行来源：order = 单条创作（DeliveryOrder），batch = 批量生产（VideoJob），
  /// post = 图文帖与轮播（ContentPost，PRD §4.3 要求素材库收纳它们）。
  source: z.enum(["order", "batch", "post"]).default("order"),
  /// batch 行的 VideoJob id（品牌封装用）；order 行为 null。
  videoJobId: z.string().min(1).nullable().default(null),
  /// batch 行所属批次 id（详情跳转用）；order 行为 null。
  batchId: z.string().min(1).nullable().default(null),
  /// post 行所属内容计划 id（跳回本周内容用）；其他来源为 null。
  planId: z.string().min(1).nullable().default(null),
  /// 图文帖的全部配图（轮播是多张）；视频行为空数组。
  imageUrls: z.array(z.string().url()).default([]),
  /// 品牌封装成片（logo + 尾卡）。null = 未封装。
  brandedVideoUrl: z.string().url().nullable().default(null),
  /// true = 他人（样片账号）的只读客户样片，非访问者本人成片。
  isShowcase: z.boolean().default(false),
  title: z.string().min(1),
  updatedAt: z.date(),
  status: unifiedLibraryStatusSchema,
  label: z.string().min(1),
  progress: z.number().min(0).max(100),
  videoUrl: z.string().url().nullable(),
  thumbnailUrl: z.string().url().nullable(),
  durationSec: z.number().int().positive().nullable(),
  aspectRatio: z.string().min(1).nullable(),
  failedSceneCount: z.number().int().nonnegative(),
  canRetry: z.boolean(),
});

export type UnifiedLibraryRow = z.infer<typeof unifiedLibraryRowSchema>;
