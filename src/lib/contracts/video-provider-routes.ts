import { z } from "zod";

export const shuyuRouteUnavailableReasons = [
  "not_configured",
  "authentication_rejected",
  "insufficient_balance",
  "rate_limited",
  "timeout",
  "upstream_unavailable",
  "invalid_response",
  "price_contract_mismatch",
] as const;

export const shuyuVideoPlanSchema = z
  .object({
    planId: z.literal("video-plan-02"),
    kind: z.literal("video"),
    model: z.literal("studio-video"),
    unit: z.literal("generation"),
    resolution: z.literal("720P"),
    salePoints: z.literal(900),
  })
  .strict();

export const shuyuApiContractSchema = z
  .object({
    submitPath: z.literal("/videos/generations"),
    statusPath: z.literal("/tasks/{task_id}"),
    balancePath: z.literal("/account/balance"),
    requestFields: z.tuple([
      z.literal("plan_id"),
      z.literal("model"),
      z.literal("mode"),
      z.literal("prompt"),
      z.literal("duration"),
      z.literal("aspect_ratio"),
      z.literal("input_images"),
    ]),
    statuses: z.tuple([
      z.literal("queued"),
      z.literal("processing"),
      z.literal("completed"),
      z.literal("failed"),
      z.literal("refund_pending"),
      z.literal("refund_error"),
      z.literal("refunded"),
    ]),
  })
  .strict();

export const shuyuVideoProviderRouteSchema = z
  .object({
    id: z.literal("buddy"),
    provider: z.literal("shuyu"),
    displayName: z.literal("Shuyu API"),
    apiBaseUrl: z.literal("https://shuyu-tiktok-tool.pages.dev/api/v1"),
    discoveryMode: z.literal(
      "health_prices_and_balance_read_only_non_billing",
    ),
    availability: z.enum(["available", "unavailable"]),
    configured: z.boolean(),
    funded: z.boolean(),
    unavailableReason: z.enum(shuyuRouteUnavailableReasons).nullable(),
    plans: z.array(shuyuVideoPlanSchema).max(1),
    contract: shuyuApiContractSchema,
  })
  .strict();

export const internalVideoProviderRoutesResponseSchema = z
  .object({
    ok: z.literal(true),
    routes: z.array(shuyuVideoProviderRouteSchema).length(1),
  })
  .strict();

export type ShuyuVideoPlan = z.infer<typeof shuyuVideoPlanSchema>;
export type ShuyuApiContract = z.infer<typeof shuyuApiContractSchema>;
export type ShuyuVideoProviderRoute = z.infer<
  typeof shuyuVideoProviderRouteSchema
>;
export type InternalVideoProviderRoutesResponse = z.infer<
  typeof internalVideoProviderRoutesResponseSchema
>;

// Compatibility type aliases for existing internal imports during the route
// rename. They contain only the new sanitized /prices contract.
export type BuddyApiContract = ShuyuApiContract;
export type BuddyVideoProviderRoute = ShuyuVideoProviderRoute;
