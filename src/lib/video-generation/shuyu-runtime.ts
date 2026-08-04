import {
  findAuditedShuyuVideoPlan,
  getShuyuBalance,
  getShuyuPrices,
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
let inflightProbe: Promise<CachedProbe> | null = null;

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
    const contractReady = Boolean(findAuditedShuyuVideoPlan(videoPlans));
    return {
      expiresAt: Date.now() + CACHE_TTL_MS,
      contractReady,
      availablePoints: balance.available_points,
      failure: contractReady ? null : "price_contract_mismatch",
    };
  } catch (error) {
    return {
      /// 失败结果只缓存 5s:一次抖动若按满 TTL 缓存,会让同波后续提交
      /// 全部吃到陈旧的「not ready」直接终态失败(0804 真机)。
      expiresAt: Date.now() + 5_000,
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
  /// single-flight:批量一波并发提交时只跑一次探针(/prices + /balance),
  /// 冷缓存下 N 个并发首扑会被上游抖动/限流放大成终态失败(0804 真机)。
  let probe: CachedProbe;
  if (useCache && cachedProbe && cachedProbe.expiresAt > Date.now()) {
    probe = cachedProbe;
  } else if (useCache) {
    if (!inflightProbe) {
      inflightProbe = runProbe(args).finally(() => {
        inflightProbe = null;
      });
    }
    probe = await inflightProbe;
  } else {
    probe = await runProbe(args);
  }
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
