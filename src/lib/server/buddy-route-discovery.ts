/**
 * Server-only, non-billing Shuyu route discovery.
 *
 * The upstream contract documents GET /health, GET /prices and GET
 * /account/balance. No model/OpenAPI guessing is performed. Only the single
 * audited video plan and a funded boolean cross this module boundary; raw
 * balance and responses do not.
 */

import {
  findAuditedShuyuVideoPlan,
  getShuyuBalance,
  getShuyuHealth,
  getShuyuPrices,
  SHUYU_API_BASE_URL,
  SHUYU_TASK_STATUSES,
  SHUYU_VIDEO_BILLING_UNIT,
  SHUYU_VIDEO_MODEL,
  SHUYU_VIDEO_PLAN_ID,
  SHUYU_VIDEO_POINTS_PER_GENERATION,
  SHUYU_VIDEO_RESOLUTION,
  shuyuApiKey,
  ShuyuApiError,
  type ShuyuFetchOptions,
} from "@/lib/providers/shuyu";
import type {
  ShuyuVideoPlan,
  ShuyuVideoProviderRoute,
} from "@/lib/contracts/video-provider-routes";

export const BUDDY_API_BASE_URL = SHUYU_API_BASE_URL;
export const SHUYU_PRICES_PATH = "/prices" as const;

const CONTRACT: ShuyuVideoProviderRoute["contract"] = {
  submitPath: "/videos/generations",
  statusPath: "/tasks/{task_id}",
  balancePath: "/account/balance",
  requestFields: [
    "plan_id",
    "model",
    "mode",
    "prompt",
    "duration",
    "aspect_ratio",
    "input_images",
  ],
  statuses: [...SHUYU_TASK_STATUSES],
};

const AUDITED_PLAN: ShuyuVideoPlan = Object.freeze({
  planId: SHUYU_VIDEO_PLAN_ID,
  kind: "video",
  model: SHUYU_VIDEO_MODEL,
  unit: SHUYU_VIDEO_BILLING_UNIT,
  resolution: SHUYU_VIDEO_RESOLUTION,
  salePoints: SHUYU_VIDEO_POINTS_PER_GENERATION,
});

type UnavailableReason = NonNullable<
  ShuyuVideoProviderRoute["unavailableReason"]
>;

function mapFailure(error: unknown): UnavailableReason {
  if (error instanceof ShuyuApiError) {
    if (error.code === "not_found") return "upstream_unavailable";
    return error.code;
  }
  return "upstream_unavailable";
}

function route(args: {
  configured: boolean;
  funded: boolean;
  plans: ShuyuVideoPlan[];
  reason: UnavailableReason | null;
}): ShuyuVideoProviderRoute {
  return {
    id: "buddy",
    provider: "shuyu",
    displayName: "Shuyu API",
    apiBaseUrl: SHUYU_API_BASE_URL,
    discoveryMode: "health_prices_and_balance_read_only_non_billing",
    availability: args.reason === null ? "available" : "unavailable",
    configured: args.configured,
    funded: args.funded,
    unavailableReason: args.reason,
    plans: args.plans,
    contract: CONTRACT,
  };
}

export async function discoverShuyuVideoRoute(
  options: ShuyuFetchOptions = {},
): Promise<ShuyuVideoProviderRoute> {
  if (typeof window !== "undefined") {
    throw new Error("Shuyu route discovery is server-only");
  }
  if (!shuyuApiKey(options.env)) {
    return route({
      configured: false,
      funded: false,
      plans: [],
      reason: "not_configured",
    });
  }

  try {
    const [, prices, balance] = await Promise.all([
      getShuyuHealth(options),
      getShuyuPrices(options),
      getShuyuBalance(options),
    ]);
    const videoPlans = prices.data.filter((item) => item.kind === "video");
    const contractMatches = Boolean(findAuditedShuyuVideoPlan(videoPlans));
    const plans = contractMatches ? [AUDITED_PLAN] : [];
    const funded = balance.available_points > 0;
    return route({
      configured: true,
      funded,
      plans,
      reason: !contractMatches
        ? "price_contract_mismatch"
        : funded
          ? null
          : "insufficient_balance",
    });
  } catch (error) {
    return route({
      configured: true,
      funded: false,
      plans: [],
      reason: mapFailure(error),
    });
  }
}

/** Compatibility alias while internal call sites migrate from Buddy naming. */
export const discoverBuddyVideoRoute = discoverShuyuVideoRoute;
