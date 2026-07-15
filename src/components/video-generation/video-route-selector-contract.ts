export type BuddyRouteDiscoverySummary =
  | { state: "available"; modelCount: number }
  | {
      state: "unavailable";
      reason:
        | "not_configured"
        | "authentication_rejected"
        | "models_endpoint_unavailable"
        | "rate_limited"
        | "timeout"
        | "upstream_unavailable"
        | "invalid_response"
        | "unknown";
    };

const UNAVAILABLE_REASONS = new Set([
  "not_configured",
  "authentication_rejected",
  "models_endpoint_unavailable",
  "rate_limited",
  "timeout",
  "upstream_unavailable",
  "invalid_response",
]);

function unavailableReason(value: unknown): BuddyRouteDiscoverySummary {
  return {
    state: "unavailable",
    reason:
      typeof value === "string" && UNAVAILABLE_REASONS.has(value)
        ? (value as Exclude<BuddyRouteDiscoverySummary, { state: "available" }>["reason"])
        : "unknown",
  };
}

/**
 * Reduce the internal discovery response to the only datum the selector needs.
 * Raw upstream fields (including the API base URL) never reach rendered copy.
 */
export function buddyRouteDiscoverySummary(
  payload: unknown,
): BuddyRouteDiscoverySummary {
  if (!isRecord(payload) || payload.ok !== true || !Array.isArray(payload.routes)) {
    return unavailableReason(null);
  }
  const route = payload.routes.find(
    (candidate) => isRecord(candidate) && candidate.id === "buddy",
  );
  if (
    !isRecord(route) ||
    route.availability !== "available" ||
    !Array.isArray(route.models)
  ) {
    return unavailableReason(isRecord(route) ? route.unavailableReason : null);
  }
  const modelCount = route.models.filter(
    (model) => isRecord(model) && typeof model.id === "string" && model.id.length > 0,
  ).length;
  return { state: "available", modelCount };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
