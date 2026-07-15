import { isMockVideoRuntime } from "@/lib/config/env";
import {
  resolveSeedanceRuntimeProfile,
  seedanceApiKey,
} from "@/lib/config/seedance-runtime";
import {
  createVideoRouteSnapshot,
  type VideoRouteSnapshot,
} from "./video-route-registry";

export const STAFF_SELECTABLE_VIDEO_ROUTE_IDS = [
  "byteplus_international",
  "volcengine_cn_legacy",
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

/**
 * Resolve one immutable route snapshot before idempotency/quota work begins.
 *
 * Customers cannot influence routing. In explicit mock rehearsal mode the
 * mock route is forced and a requested paid route is rejected, so a test
 * deployment cannot accidentally escape into a real provider.
 */
export function selectVideoRouteSnapshot(args: {
  requestedRouteId?: unknown;
  isInternalStaff: boolean;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): VideoRouteSnapshot {
  const env = args.env ?? process.env;
  const hasOverride = args.requestedRouteId !== undefined;

  if (hasOverride && !args.isInternalStaff) {
    throw new VideoRouteSelectionError(
      "FORBIDDEN",
      "Only OPERATOR or SUPER_ADMIN may override the video route",
    );
  }

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
        "videoRouteId is not in the audited Seedance route allowlist",
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
  return Boolean(seedanceApiKey(snapshot.videoRouteSnapshot, env));
}
