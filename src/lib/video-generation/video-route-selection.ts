import { isMockVideoRuntime } from "@/lib/config/env";
import { shuyuApiKey } from "@/lib/providers/shuyu";
import { getShuyuRouteRuntimeAvailability } from "./shuyu-runtime";
import {
  createVideoRouteSnapshot,
  type VideoRouteSnapshot,
} from "./video-route-registry";

/// 内部可点名的线路：只有 buddy。runway（2026-11-16）与两条直连 Seedance 线路（2026-11-17）已下线，
/// 只剩读旧记录用的线路定义（见 video-route-registry），点名它们按 INVALID_ROUTE 拒绝。
export const STAFF_SELECTABLE_VIDEO_ROUTE_IDS = ["buddy"] as const;

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
 * 客户的视频线路只有 buddy（Shuyu 的 Seedance）一条：不点名就是它，点名也只能点它。
 * 点名别的（直连线路、已下线的 runway、任何认不得的值）一律 FORBIDDEN。
 */
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
  if (args.requestedRouteId === undefined || args.requestedRouteId === "buddy") {
    return createVideoRouteSnapshot("buddy");
  }
  throw new VideoRouteSelectionError(
    "FORBIDDEN",
    "Customers may only use the platform's customer video route",
  );
}

/**
 * Resolve one immutable route snapshot before idempotency/quota work begins.
 * Shuyu (buddy) is the only real route for customers and internal staff alike;
 * the retired direct profiles stay readable on historical snapshots only.
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

  return createVideoRouteSnapshot("buddy");
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
  /// 已下线的线路（只剩读旧记录用的定义）永远不算就绪
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

export type VideoRouteRuntimeAvailability = Awaited<
  ReturnType<typeof getVideoRouteSnapshotRuntimeAvailability>
>;
