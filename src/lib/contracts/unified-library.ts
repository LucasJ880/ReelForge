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
  /// 行来源：order = 单条创作（DeliveryOrder），batch = 批量生产（VideoJob）。
  source: z.enum(["order", "batch"]).default("order"),
  /// batch 行的 VideoJob id（品牌封装用）；order 行为 null。
  videoJobId: z.string().min(1).nullable().default(null),
  /// batch 行所属批次 id（详情跳转用）；order 行为 null。
  batchId: z.string().min(1).nullable().default(null),
  /// 品牌封装成片（logo + 尾卡）。null = 未封装。
  brandedVideoUrl: z.string().url().nullable().default(null),
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
