import { z } from "zod";

/**
 * Internal-only ops credits snapshot. Raw Shuyu balance is allowed here and
 * ONLY here — the customer-facing routes API deliberately never exposes it
 * (see src/app/api/video-generation/routes/route.ts).
 */
export const opsCreditsResponseSchema = z.object({
  ok: z.literal(true),
  availablePoints: z.number().int().nonnegative(),
  todaySpentPoints: z.number().int().nonnegative(),
  videoPlan: z.object({
    model: z.string().min(1),
    resolution: z.string().min(1),
    salePoints: z.number().int().positive(),
  }),
  fetchedAt: z.string().datetime(),
});

export type OpsCreditsResponse = z.infer<typeof opsCreditsResponseSchema>;
