import { z } from "zod";

/**
 * 客户可选的视频套餐(买断制线路;来自 /prices 实时审计,2026-08-03 起)。
 * 只暴露展示与计价必需字段;不暴露供应商余额或原始价目结构。
 */
export const publicVideoPlanOptionSchema = z
  .object({
    planId: z.string().min(1).max(200),
    displayName: z.string().min(1).max(500),
    resolution: z.enum(["480P", "720P"]),
    billingUnit: z.enum(["generation", "second"]),
    unitSalePoints: z.number().int().positive(),
    /** 15s 一条的有效积分成本,便于前端直接展示比较。 */
    pointsPer15s: z.number().int().positive(),
    isDefault: z.boolean(),
  })
  .strict();

export type PublicVideoPlanOption = z.infer<typeof publicVideoPlanOptionSchema>;

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
    /// 审计通过的可选套餐,默认套餐排首位;线路不可用时为空数组。
    plans: z.array(publicVideoPlanOptionSchema).max(20).default([]),
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
