/**
 * Server-only, non-billing Shuyu route discovery.
 *
 * The upstream contract documents GET /health, GET /prices and GET
 * /account/balance. No model/OpenAPI guessing is performed. Only the audited
 * video plan list (truncated to the contract cap) and a funded boolean cross
 * this module boundary; raw balance and responses do not.
 *
 * 可用性(contractMatches)只看 draft 档:价目表只剩 1080P(final)时与 0803/0804 的
 * 整体轮换一样报 price_contract_mismatch,因为默认解析在 draft 档内取不到套餐。
 */

import {
  defaultAuditedShuyuVideoPlan,
  getShuyuBalance,
  getShuyuHealth,
  getShuyuPrices,
  listAuditedShuyuVideoPlans,
  SHUYU_API_BASE_URL,
  SHUYU_VIDEO_PLAN_LIST_MAX,
  type AuditedShuyuVideoPlan,
  SHUYU_TASK_STATUSES,
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

/// 0803 起套餐从 /prices 实时审计,不再有固定的单一 AUDITED_PLAN;
/// discovery 返回实时审计清单映射后的套餐列表(输出前截断到契约上限)。
function auditedPlanList(
  audited: ReadonlyArray<AuditedShuyuVideoPlan>,
): ShuyuVideoPlan[] {
  return audited.slice(0, SHUYU_VIDEO_PLAN_LIST_MAX).map((plan) => ({
    planId: plan.planId,
    kind: "video" as const,
    model: plan.model,
    unit: plan.billingUnit,
    resolution: plan.resolution,
    salePoints: plan.unitSalePoints,
  }));
}

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
    const audited = listAuditedShuyuVideoPlans(videoPlans);
    const plans = auditedPlanList(audited);
    /// 只剩 final 档(1080P)不算契约就位——默认档(draft)必须在。
    const contractMatches = defaultAuditedShuyuVideoPlan(audited) !== undefined;
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
