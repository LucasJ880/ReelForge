import { headers } from "next/headers";
import { isProductionRuntime } from "@/lib/config/env";
import type { CustomerRouteId } from "@/components/platform/customer-route-state";

export const CUSTOMER_ROUTE_STATE_HEADER = "x-aivora-qa-route-state";

export type CustomerRouteRehearsalState = "live" | "slow" | "empty" | "error";

type RehearsalEnv = Record<string, string | undefined>;

/**
 * Browser-level route-state injection for preview/rehearsal verification only.
 * Customer production runtimes ignore the header even when a caller sends it.
 */
export function resolveCustomerRouteRehearsalState({
  headerValue,
  route,
  env,
}: {
  headerValue: string | null;
  route: CustomerRouteId;
  env: RehearsalEnv;
}): CustomerRouteRehearsalState {
  if (
    !headerValue
    || isProductionRuntime(env)
    || env.VERCEL_ENV?.trim().toLowerCase() !== "preview"
    || env.FINAL_ACCEPTANCE_REQUIRE_REHEARSAL !== "true"
    || !/^(1|true|yes|on)$/i.test(env.AIVORA_DRY_RUN?.trim() ?? "")
    || env.VIDEO_PROVIDER?.trim().toLowerCase() !== "mock"
  ) {
    return "live";
  }

  const [target, requestedState, extra] = headerValue.split(":");
  if (extra || target !== route) return "live";
  if (requestedState === "slow" || requestedState === "empty" || requestedState === "error") {
    return requestedState;
  }
  return "live";
}

export async function getCustomerRouteRehearsalState(
  route: CustomerRouteId,
): Promise<Exclude<CustomerRouteRehearsalState, "slow">> {
  const requestHeaders = await headers();
  const state = resolveCustomerRouteRehearsalState({
    headerValue: requestHeaders.get(CUSTOMER_ROUTE_STATE_HEADER),
    route,
    env: process.env,
  });

  if (state === "slow") {
    await new Promise<void>((resolve) => setTimeout(resolve, 900));
    return "live";
  }
  if (state === "error") {
    throw new Error(`[route-state-rehearsal] ${route} service failure`);
  }
  return state;
}
