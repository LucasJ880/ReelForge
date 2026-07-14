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
