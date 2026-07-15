import {
  getShuyuBalance,
  getShuyuPrices,
  isAuditedShuyuVideoPlan,
  shuyuApiKey,
  ShuyuApiError,
  type ShuyuFetchOptions,
} from "@/lib/providers/shuyu";

export type ShuyuRouteUnavailableReason =
  | "not_configured"
  | "authentication_rejected"
  | "insufficient_balance"
  | "rate_limited"
  | "timeout"
  | "upstream_unavailable"
  | "invalid_response"
  | "price_contract_mismatch";

export interface ShuyuRouteRuntimeAvailability {
  configured: boolean;
  funded: boolean;
  available: boolean;
  reason: ShuyuRouteUnavailableReason | null;
}

interface CachedProbe {
  expiresAt: number;
  contractReady: boolean;
  availablePoints: number;
  failure: ShuyuRouteUnavailableReason | null;
}

const CACHE_TTL_MS = 30_000;
let cachedProbe: CachedProbe | null = null;

function mapFailure(error: unknown): ShuyuRouteUnavailableReason {
  if (error instanceof ShuyuApiError) {
    if (error.code === "not_found") return "upstream_unavailable";
    if (error.code === "insufficient_balance") return "insufficient_balance";
    return error.code;
  }
  return "upstream_unavailable";
}

async function runProbe(options: ShuyuFetchOptions): Promise<CachedProbe> {
  try {
    const [prices, balance] = await Promise.all([
      getShuyuPrices(options),
      getShuyuBalance(options),
    ]);
    const videoPlans = prices.data.filter((plan) => plan.kind === "video");
    const contractReady =
      videoPlans.length === 1 && isAuditedShuyuVideoPlan(videoPlans[0]);
    return {
      expiresAt: Date.now() + CACHE_TTL_MS,
      contractReady,
      availablePoints: balance.available_points,
      failure: contractReady ? null : "price_contract_mismatch",
    };
  } catch (error) {
    return {
      expiresAt: Date.now() + CACHE_TTL_MS,
      contractReady: false,
      availablePoints: 0,
      failure: mapFailure(error),
    };
  }
}

/**
 * Read-only provider readiness. The return value intentionally contains only
 * configured/funded booleans; raw supplier balance never crosses this API.
 */
export async function getShuyuRouteRuntimeAvailability(
  args: ShuyuFetchOptions & {
    requiredPoints?: number;
    useCache?: boolean;
  } = {},
): Promise<ShuyuRouteRuntimeAvailability> {
  const configured = Boolean(shuyuApiKey(args.env));
  if (!configured) {
    return {
      configured: false,
      funded: false,
      available: false,
      reason: "not_configured",
    };
  }

  const useCache = args.useCache !== false && !args.fetchImpl && !args.env;
  const probe =
    useCache && cachedProbe && cachedProbe.expiresAt > Date.now()
      ? cachedProbe
      : await runProbe(args);
  if (useCache) cachedProbe = probe;
  if (!probe.contractReady) {
    return {
      configured: true,
      funded: probe.availablePoints > 0,
      available: false,
      reason: probe.failure ?? "price_contract_mismatch",
    };
  }

  const requiredPoints = Math.max(1, Math.floor(args.requiredPoints ?? 1));
  const funded = probe.availablePoints > 0;
  if (probe.availablePoints < requiredPoints) {
    return {
      configured: true,
      funded,
      available: false,
      reason: "insufficient_balance",
    };
  }
  return { configured: true, funded: true, available: true, reason: null };
}

export function __resetShuyuRuntimeProbeForTests(): void {
  cachedProbe = null;
}
