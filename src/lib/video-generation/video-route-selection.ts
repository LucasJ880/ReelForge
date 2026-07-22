import {
  isMockVideoRuntime,
  type VideoGenerationRuntimeUnavailableReason,
} from "@/lib/config/env";
import {
  resolveSeedanceArkBaseUrl,
  resolveSeedanceRuntimeProfile,
  seedanceApiKey,
} from "@/lib/config/seedance-runtime";
import { shuyuApiKey } from "@/lib/providers/shuyu";
import { getShuyuRouteRuntimeAvailability } from "./shuyu-runtime";
import {
  createVideoRouteSnapshot,
  type VideoRouteSnapshot,
} from "./video-route-registry";

export const STAFF_SELECTABLE_VIDEO_ROUTE_IDS = [
  "byteplus_international",
  "volcengine_cn_legacy",
  "buddy",
] as const;

export type StaffSelectableVideoRouteId =
  (typeof STAFF_SELECTABLE_VIDEO_ROUTE_IDS)[number];

export class VideoRouteSelectionError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "INVALID_ROUTE" | "MOCK_ROUTE_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "VideoRouteSelectionError";
  }
}

function isStaffSelectableRouteId(
  value: string,
): value is StaffSelectableVideoRouteId {
  return STAFF_SELECTABLE_VIDEO_ROUTE_IDS.some((routeId) => routeId === value);
}

export function selectCustomerVideoRouteSnapshot(args: {
  requestedRouteId?: unknown;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): VideoRouteSnapshot {
  const env = args.env ?? process.env;
  if (isMockVideoRuntime(env)) {
    if (args.requestedRouteId !== undefined) {
      throw new VideoRouteSelectionError(
        "MOCK_ROUTE_CONFLICT",
        "Mock rehearsal mode does not permit a real provider route override",
      );
    }
    return createVideoRouteSnapshot("mock");
  }
  if (args.requestedRouteId !== undefined && args.requestedRouteId !== "buddy") {
    throw new VideoRouteSelectionError(
      "FORBIDDEN",
      "Customers may only use the audited Shuyu partner route",
    );
  }
  return createVideoRouteSnapshot("buddy");
}

/**
 * Resolve one immutable route snapshot before idempotency/quota work begins.
 * Customer requests are Shuyu-only; legacy direct profiles remain available to
 * internal staff and historical snapshot readers.
 */
export function selectVideoRouteSnapshot(args: {
  requestedRouteId?: unknown;
  isInternalStaff: boolean;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): VideoRouteSnapshot {
  const env = args.env ?? process.env;
  if (!args.isInternalStaff) {
    return selectCustomerVideoRouteSnapshot({
      ...(args.requestedRouteId !== undefined
        ? { requestedRouteId: args.requestedRouteId }
        : {}),
      env,
    });
  }
  const hasOverride = args.requestedRouteId !== undefined;

  if (isMockVideoRuntime(env)) {
    if (hasOverride) {
      throw new VideoRouteSelectionError(
        "MOCK_ROUTE_CONFLICT",
        "Mock rehearsal mode does not permit a real provider route override",
      );
    }
    return createVideoRouteSnapshot("mock");
  }

  if (hasOverride) {
    if (
      typeof args.requestedRouteId !== "string" ||
      !isStaffSelectableRouteId(args.requestedRouteId)
    ) {
      throw new VideoRouteSelectionError(
        "INVALID_ROUTE",
        "videoRouteId is not in the audited public video route allowlist",
      );
    }
    return createVideoRouteSnapshot(args.requestedRouteId);
  }

  return createVideoRouteSnapshot(
    resolveSeedanceRuntimeProfile(env.SEEDANCE_RUNTIME_PROFILE),
  );
}

export function isVideoRouteSnapshotRuntimeReady(
  snapshot: VideoRouteSnapshot,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  if (snapshot.videoRouteSnapshot === "mock") {
    return isMockVideoRuntime(env);
  }
  if (snapshot.videoRouteSnapshot === "buddy") {
    return Boolean(shuyuApiKey(env));
  }
  if (!seedanceApiKey(snapshot.videoRouteSnapshot, env)) return false;
  try {
    resolveSeedanceArkBaseUrl(
      env.ARK_BASE_URL,
      snapshot.videoRouteSnapshot,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * An explicit route may bypass readiness only when the reported failure
 * belongs to a different provider/profile. Content-review and mock seals are
 * intentionally never bypassable.
 */
export function canVideoRouteOverrideDefaultRuntimeFailure(
  snapshot: VideoRouteSnapshot,
  reason: VideoGenerationRuntimeUnavailableReason,
): boolean {
  const byteplusFailure = [
    "byteplus_key_missing",
    "byteplus_endpoint_invalid",
  ].some((candidate) => candidate === reason);
  const volcengineFailure = [
    "volcengine_legacy_key_missing",
    "volcengine_legacy_endpoint_invalid",
  ].some((candidate) => candidate === reason);

  if (snapshot.videoRouteSnapshot === "buddy") {
    return byteplusFailure || volcengineFailure;
  }
  if (snapshot.videoRouteSnapshot === "byteplus_international") {
    return reason === "shuyu_key_missing" || volcengineFailure;
  }
  if (snapshot.videoRouteSnapshot === "volcengine_cn_legacy") {
    return reason === "shuyu_key_missing" || byteplusFailure;
  }
  return false;
}

export async function getVideoRouteSnapshotRuntimeAvailability(args: {
  snapshot: VideoRouteSnapshot;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  shuyuRequiredPoints?: number;
  fetchImpl?: typeof fetch;
}): Promise<{
  available: boolean;
  funded: boolean | null;
  reason:
    | "not_configured"
    | "insufficient_balance"
    | "authentication_rejected"
    | "rate_limited"
    | "timeout"
    | "upstream_unavailable"
    | "invalid_response"
    | "price_contract_mismatch"
    | null;
}> {
  const env = args.env ?? process.env;
  if (args.snapshot.videoRouteSnapshot === "buddy") {
    const shuyu = await getShuyuRouteRuntimeAvailability({
      ...(args.env ? { env } : {}),
      ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
      requiredPoints: args.shuyuRequiredPoints,
    });
    return {
      available: shuyu.available,
      funded: shuyu.funded,
      reason: shuyu.reason,
    };
  }
  const available = isVideoRouteSnapshotRuntimeReady(args.snapshot, env);
  return {
    available,
    funded: null,
    reason: available ? null : "not_configured",
  };
}
