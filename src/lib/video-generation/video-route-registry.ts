/**
 * Pure, environment-independent contract for persisted video routing evidence.
 *
 * This registry describes route identity only. It does not select a provider,
 * read credentials, call an adapter, or bypass runtime/cost gates. In
 * particular, a registered route is not proof that its production account is
 * configured.
 */

export const VIDEO_ROUTE_IDS = [
  "byteplus_international",
  "volcengine_cn_legacy",
  "mock",
  "buddy",
] as const;

export type VideoRouteId = (typeof VIDEO_ROUTE_IDS)[number];
export type EnabledVideoRouteId = VideoRouteId;

export type VideoProviderAdapterSnapshot = "byteplus" | "shuyu" | "mock";

export interface VideoRouteContract {
  readonly id: VideoRouteId;
  readonly enabled: boolean;
  /** Stable adapter identity persisted for reconciliation, not a class name. */
  readonly providerAdapter: VideoProviderAdapterSnapshot;
  /** Null means the provider contract/model is still unknown and unusable. */
  readonly model: string | null;
  readonly processingRegion: "ap-southeast" | "cn-beijing" | "local" | null;
}

const ROUTES = {
  byteplus_international: {
    id: "byteplus_international",
    enabled: true,
    providerAdapter: "byteplus",
    model: "dreamina-seedance-2-0-260128",
    processingRegion: "ap-southeast",
  },
  volcengine_cn_legacy: {
    id: "volcengine_cn_legacy",
    enabled: true,
    // The current audited adapter is shared; the route snapshot distinguishes
    // the explicit legacy account/endpoint/model profile.
    providerAdapter: "byteplus",
    model: "doubao-seedance-2-0-260128",
    processingRegion: "cn-beijing",
  },
  mock: {
    id: "mock",
    enabled: true,
    providerAdapter: "mock",
    model: "aivora-deterministic-mock-v1",
    processingRegion: "local",
  },
  buddy: {
    id: "buddy",
    enabled: true,
    providerAdapter: "shuyu",
    // The public /prices contract currently exposes exactly this one video
    // plan. The upstream request selects it by model; plan_id is metadata only
    // and must never be sent in POST /videos/generations.
    model: "studio-video",
    processingRegion: null,
  },
} as const satisfies Record<VideoRouteId, VideoRouteContract>;

export const VIDEO_ROUTE_REGISTRY: Readonly<
  Record<VideoRouteId, VideoRouteContract>
> = Object.freeze(ROUTES);

export interface VideoRouteSnapshot {
  readonly videoRouteSnapshot: EnabledVideoRouteId;
  readonly videoModelSnapshot: string;
  readonly videoProviderAdapterSnapshot: VideoProviderAdapterSnapshot;
}

export interface PersistedVideoRouteSnapshotInput {
  readonly videoRouteSnapshot?: string | null;
  readonly videoModelSnapshot?: string | null;
  readonly videoProviderAdapterSnapshot?: string | null;
}

export type ReadVideoRouteSnapshot =
  | {
      readonly state: "historical_unknown";
      readonly route: null;
      readonly videoRouteSnapshot: null;
      readonly videoModelSnapshot: null;
      readonly videoProviderAdapterSnapshot: null;
    }
  | {
      readonly state: "persisted";
      readonly route: VideoRouteContract;
      readonly videoRouteSnapshot: VideoRouteId;
      readonly videoModelSnapshot: string;
      readonly videoProviderAdapterSnapshot: VideoProviderAdapterSnapshot;
    };

function isVideoRouteId(value: string): value is VideoRouteId {
  return Object.prototype.hasOwnProperty.call(ROUTES, value);
}

function isProviderAdapterSnapshot(
  value: string,
): value is VideoProviderAdapterSnapshot {
  return value === "byteplus" || value === "shuyu" || value === "mock";
}

export function getVideoRouteContract(routeId: VideoRouteId): VideoRouteContract {
  return VIDEO_ROUTE_REGISTRY[routeId];
}

export function isEnabledVideoRouteId(
  routeId: VideoRouteId,
): routeId is EnabledVideoRouteId {
  const route = getVideoRouteContract(routeId);
  return route.enabled && route.model !== null;
}

export function createVideoRouteSnapshot(
  routeId: VideoRouteId,
): VideoRouteSnapshot {
  const route = getVideoRouteContract(routeId);
  if (!isEnabledVideoRouteId(routeId) || route.model === null) {
    throw new Error(
      `Video route ${routeId} is registered but disabled until its provider model contract is confirmed`,
    );
  }
  return Object.freeze({
    videoRouteSnapshot: routeId,
    videoModelSnapshot: route.model,
    videoProviderAdapterSnapshot: route.providerAdapter,
  });
}

/**
 * Read persisted evidence without borrowing today's default.
 *
 * Only the all-null shape is valid historical unknown. A partial snapshot is a
 * data-integrity error because it cannot safely determine the billed route.
 */
export function readVideoRouteSnapshot(
  input: PersistedVideoRouteSnapshotInput,
): ReadVideoRouteSnapshot {
  const routeId = input.videoRouteSnapshot ?? null;
  const model = input.videoModelSnapshot ?? null;
  const adapter = input.videoProviderAdapterSnapshot ?? null;

  if (routeId === null && model === null && adapter === null) {
    return {
      state: "historical_unknown",
      route: null,
      videoRouteSnapshot: null,
      videoModelSnapshot: null,
      videoProviderAdapterSnapshot: null,
    };
  }

  if (routeId === null || model === null || adapter === null) {
    throw new Error("Incomplete persisted video route snapshot");
  }
  if (!isVideoRouteId(routeId)) {
    throw new Error(`Unknown persisted video route snapshot: ${routeId}`);
  }
  if (!isProviderAdapterSnapshot(adapter)) {
    throw new Error(`Unknown persisted video provider adapter snapshot: ${adapter}`);
  }

  return {
    state: "persisted",
    route: getVideoRouteContract(routeId),
    videoRouteSnapshot: routeId,
    // Preserve exact historical evidence. Model upgrades must create a new
    // snapshot; readers must not replace it with the registry's current model.
    videoModelSnapshot: model,
    videoProviderAdapterSnapshot: adapter,
  };
}
