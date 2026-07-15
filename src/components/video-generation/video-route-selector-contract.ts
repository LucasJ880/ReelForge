export type BuddyRouteDiscoverySummary =
  | { state: "available"; modelCount: number }
  | { state: "unavailable" };

/**
 * Reduce the internal discovery response to the only datum the selector needs.
 * Raw upstream fields (including the API base URL) never reach rendered copy.
 */
export function buddyRouteDiscoverySummary(
  payload: unknown,
): BuddyRouteDiscoverySummary {
  if (!isRecord(payload) || payload.ok !== true || !Array.isArray(payload.routes)) {
    return { state: "unavailable" };
  }
  const route = payload.routes.find(
    (candidate) => isRecord(candidate) && candidate.id === "buddy",
  );
  if (
    !isRecord(route) ||
    route.availability !== "available" ||
    !Array.isArray(route.models)
  ) {
    return { state: "unavailable" };
  }
  const modelCount = route.models.filter(
    (model) => isRecord(model) && typeof model.id === "string" && model.id.length > 0,
  ).length;
  return { state: "available", modelCount };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
