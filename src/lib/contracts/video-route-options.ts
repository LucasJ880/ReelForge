import { z } from "zod";

export const publicVideoRouteOptionSchema = z
  .object({
    id: z.literal("buddy"),
    provider: z.literal("shuyu"),
    displayName: z.string().min(1).max(120),
    model: z.string().min(1).max(120),
    resolution: z.string().min(1).max(20).nullable(),
    configured: z.boolean(),
    funded: z.boolean().nullable(),
    available: z.boolean(),
    unavailableReason: z
      .enum([
        "not_configured",
        "authentication_rejected",
        "insufficient_balance",
        "rate_limited",
        "timeout",
        "upstream_unavailable",
        "invalid_response",
        "price_contract_mismatch",
      ])
      .nullable(),
  })
  .strict();

export const publicVideoRouteOptionsResponseSchema = z
  .object({
    ok: z.literal(true),
    defaultRouteId: z.literal("buddy"),
    routes: z.array(publicVideoRouteOptionSchema).length(1),
  })
  .strict()
  .superRefine((value, context) => {
    const routeIds = value.routes.map((route) => route.id);
    if (new Set(routeIds).size !== routeIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["routes"],
        message: "Video route identifiers must be unique",
      });
    }
    if (!routeIds.includes(value.defaultRouteId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["routes"],
        message: "The Shuyu route is required",
      });
    }
  });

export type PublicVideoRouteOption = z.infer<
  typeof publicVideoRouteOptionSchema
>;
